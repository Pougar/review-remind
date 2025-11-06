// app/api/analytics/get-review/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

/* ============================================================
   PG Pool (singleton across HMR) — no eslint-disable, no `var`
============================================================ */
const globalForPg = globalThis as unknown as { _pgPoolGetReview?: Pool };

function getPool(): Pool {
  if (!globalForPg._pgPoolGetReview) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolGetReview = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolGetReview;
}

/* ============================================================
   Helpers
============================================================ */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = {
  businessId?: string;
  excerpt_id?: string;
  excerptId?: string; // allow either
};

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v || "");

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

/* ============================================================
   Route
============================================================ */
export async function POST(req: NextRequest) {
  const pool = getPool();
  let db: PoolClient | null = null;

  try {
    db = await pool.connect();

    // ----- 1. Parse input
    const body = await readJson<ReqBody>(req);
    const businessId = (body?.businessId ?? "").trim();
    const excerptId = ((body?.excerpt_id ?? body?.excerptId) ?? "").trim();

    if (!isUUID(businessId)) {
      return NextResponse.json({ error: "MISSING_OR_INVALID_BUSINESS_ID" }, { status: 400 });
    }
    if (!isUUID(excerptId)) {
      return NextResponse.json({ error: "MISSING_OR_INVALID_EXCERPT_ID" }, { status: 400 });
    }

    // ----- 2. Auth / RLS
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Sign in required." },
        { status: 401 }
      );
    }

    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // ----- 3. Fetch the excerpt (must match business, not soft-deleted)
    const exQ = await db.query<{
      id: string;
      review_id: string | null;
      g_review_id: string | null;
    }>(
      `
      SELECT
        e.id,
        e.review_id,
        e.g_review_id
      FROM public.excerpts e
      WHERE e.id = $1::uuid
        AND e.business_id = $2::uuid
      LIMIT 1
      `,
      [excerptId, businessId]
    );

    if (exQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return NextResponse.json({ error: "EXCERPT_NOT_FOUND" }, { status: 404 });
    }

    const ex = exQ.rows[0];

    // ----- 4a. If excerpt refers to an internal review (public.reviews)
    if (ex.review_id) {
      const rQ = await db.query<{
        id: string;
        review: string | null;
        stars: number | null;
        client_id: string | null;
        created_at: string | null;
        reviewer_name: string | null;
      }>(
        `
        SELECT
          r.id,
          r.review,
          r.stars::float8 AS stars,
          r.client_id,
          r.created_at,
          c.display_name AS reviewer_name
        FROM public.reviews r
        LEFT JOIN public.clients c ON c.id = r.client_id
        WHERE r.id = $1::uuid
          AND r.business_id = $2::uuid
        LIMIT 1
        `,
        [ex.review_id, businessId]
      );

      if (rQ.rowCount === 0) {
        await db.query("ROLLBACK");
        return NextResponse.json({ error: "REVIEW_NOT_FOUND" }, { status: 404 });
      }

      const r = rQ.rows[0];
      const text = r.review ? r.review.trim() : null;

      await db.query("COMMIT");
      return NextResponse.json(
        {
          success: true,
          source: "reviews",
          review: {
            id: r.id,
            text,
            stars: r.stars ?? null,
            reviewer_name: r.reviewer_name ?? null,
            created_at: r.created_at ?? null,
          },
        },
        { status: 200 }
      );
    }

    // ----- 4b. Otherwise, excerpt refers to a Google review
    if (!ex.g_review_id) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        { error: "MISSING_REVIEW_REFERENCE" },
        { status: 422 }
      );
    }

    const gQ = await db.query<{
      id: string;
      review: string | null;
      stars: number | null;
      name: string | null;
      created_at: string | null;
    }>(
      `
      SELECT
        gr.id,
        gr.review,
        gr.stars::float8 AS stars,
        gr.author_name AS name,
        gr.created_at
      FROM public.google_reviews gr
      WHERE gr.id = $1::uuid
        AND gr.business_id = $2::uuid
      LIMIT 1
      `,
      [ex.g_review_id, businessId]
    );

    if (gQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return NextResponse.json({ error: "GOOGLE_REVIEW_NOT_FOUND" }, { status: 404 });
    }

    const g = gQ.rows[0];

    await db.query("COMMIT");
    return NextResponse.json(
      {
        success: true,
        source: "google_reviews",
        review: {
          id: g.id,
          text: g.review ?? null,
          stars: g.stars ?? null,
          reviewer_name: g.name ?? null,
          created_at: g.created_at ?? null,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (db) {
      try {
        await db.query("ROLLBACK");
      } catch {
        /* ignore rollback error */
      }
    }
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[/api/analytics/get-review] error:", msg);

    const lower = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (lower.includes("row-level security")) {
      return NextResponse.json(
        {
          error:
            "Permission denied by row-level security. Check RLS for excerpts/reviews/google_reviews.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
