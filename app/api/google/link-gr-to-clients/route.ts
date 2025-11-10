// app/api/google/link-gr-to-clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolLinkGrToClients?: Pool };

function getPool(): Pool {
  if (!globalForPg._pgPoolLinkGrToClients) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolLinkGrToClients = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolLinkGrToClients;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

/** ---------- Types ---------- */

type LinkMatchInput = {
  google_review_id: string;
  client_id: string;
  author_name?: string | null;
  display_name?: string | null;
};

type GoogleReviewRow = {
  id: string;
  review: string | null;
  stars: string | null; // numeric comes back as string from pg
  published_at: string | null;
  linked: boolean;
};

type ClientRow = {
  id: string;
};

type LinkedResult = {
  google_review_id: string;
  client_id: string;
  review_id: string;
  author_name: string | null;
  display_name: string | null;
};

/**
 * POST /api/google/link-gr-to-clients
 *
 * Body:
 * {
 *   businessId: string,
 *   matches: [
 *     {
 *       google_review_id: string,
 *       client_id: string,
 *       author_name?: string,
 *       display_name?: string
 *     },
 *     ...
 *   ]
 * }
 *
 * For each (google_review_id, client_id):
 *  - Ensure both are valid + visible via RLS
 *  - Create an internal review in public.reviews mirroring google_reviews.* fields
 *  - Set happy:
 *        stars >= 3  → happy = true  (good)
 *        stars <  3  → happy = false (bad)
 *        no stars    → happy = null
 *  - Update public.clients.sentiment based on stars:
 *        >= 3 → 'good'
 *        <  3 → 'bad'
 *    (only if sentiment is NULL or 'unreviewed')
 *  - Insert client_actions row with action = 'review_submitted'
 *  - Mark google_reviews.linked = TRUE
 */
export async function POST(req: NextRequest) {
  const pool = getPool();
  const db = await pool.connect();

  try {
    const body = (await req.json().catch(() => ({}))) as {
      businessId?: string;
      matches?: LinkMatchInput[];
      success?: boolean;
      matchCount?: number;
    };

    const businessId = body.businessId?.trim();
    if (!isUUID(businessId)) {
      return NextResponse.json(
        {
          error: "INVALID_INPUT",
          message: "Valid businessId is required.",
        },
        { status: 400 }
      );
    }

    const matches = Array.isArray(body.matches) ? body.matches : [];
    if (!matches.length) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "No matches provided." },
        { status: 400 }
      );
    }

    // Auth → RLS via app.user_id
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Collect & validate IDs from input
    const grIds = Array.from(
      new Set(matches.map((m) => m.google_review_id).filter((id) => isUUID(id)))
    );
    const clientIds = Array.from(
      new Set(matches.map((m) => m.client_id).filter((id) => isUUID(id)))
    );

    if (!grIds.length || !clientIds.length) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "INVALID_INPUT",
          message:
            "At least one valid google_review_id and client_id is required.",
        },
        { status: 400 }
      );
    }

    // Load relevant Google reviews (RLS will restrict visibility)
    const grRes = await db.query<GoogleReviewRow>(
      `
      SELECT id, review, stars, published_at, linked
      FROM public.google_reviews
      WHERE id = ANY($1::uuid[])
      `,
      [grIds]
    );

    const grById = new Map<string, GoogleReviewRow>();
    for (const row of grRes.rows) {
      grById.set(row.id, row);
    }

    // Ensure clients belong to this business
    const cRes = await db.query<ClientRow>(
      `
      SELECT id
      FROM public.clients
      WHERE business_id = $1
        AND id = ANY($2::uuid[])
        AND deleted_at IS NULL
      `,
      [businessId, clientIds]
    );

    const validClientIds = new Set(cRes.rows.map((r) => r.id));

    const results: LinkedResult[] = [];
    let linkedCount = 0;

    for (const m of matches) {
      if (!isUUID(m.google_review_id) || !isUUID(m.client_id)) continue;
      if (!validClientIds.has(m.client_id)) continue;

      const gr = grById.get(m.google_review_id);
      if (!gr) continue;
      if (gr.linked) continue; // already linked, skip

      const reviewText = gr.review ?? "";
      const starsNumber =
        gr.stars !== null && gr.stars !== undefined
          ? Number(gr.stars)
          : null;

      let happy: boolean | null = null;
      let sentimentFromStars: "good" | "bad" | null = null;

      if (starsNumber !== null && !Number.isNaN(starsNumber)) {
        if (starsNumber >= 3) {
          happy = true;
          sentimentFromStars = "good";
        } else {
          happy = false;
          sentimentFromStars = "bad";
        }
      }

      // Insert internal review mirroring the Google review
      const reviewInsert = await db.query<{ id: string }>(
        `
        INSERT INTO public.reviews (
          business_id,
          client_id,
          created_by,
          review,
          stars,
          happy,
          g_review_id,
          created_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          COALESCE($8::timestamptz, now())
        )
        RETURNING id
        `,
        [
          businessId,
          m.client_id,
          userId,
          reviewText,
          starsNumber,
          happy,
          gr.id,
          gr.published_at,
        ]
      );

      const reviewId = reviewInsert.rows[0]?.id;
      if (!reviewId) continue;

      // Update client sentiment based on stars:
      //  stars >= 3 → 'good'
      //  stars <  3 → 'bad'
      // Only update if currently NULL or 'unreviewed' to avoid clobbering.
      if (sentimentFromStars) {
        await db.query(
          `
          UPDATE public.clients
          SET sentiment = $3
          WHERE id = $1
            AND business_id = $2
            AND (sentiment IS NULL OR sentiment = 'unreviewed')
          `,
          [m.client_id, businessId, sentimentFromStars]
        );
      }

      // Log action in client_actions
      await db.query(
        `
        INSERT INTO public.client_actions (
          business_id,
          client_id,
          actor_id,
          action,
          meta
        )
        VALUES (
          $1,
          $2,
          NULL,
          'review_submitted',
          $3::jsonb
        )
        `,
        [
          businessId,
          m.client_id,
          JSON.stringify({
            source: "google_review",
            google_review_id: gr.id,
            review_id: reviewId,
            stars: starsNumber,
          }),
        ]
      );

      // Mark google review as linked
      await db.query(
        `
        UPDATE public.google_reviews
        SET linked = TRUE
        WHERE id = $1
        `,
        [gr.id]
      );

      linkedCount += 1;
      results.push({
        google_review_id: gr.id,
        client_id: m.client_id,
        review_id: reviewId,
        author_name: m.author_name ?? null,
        display_name: m.display_name ?? null,
      });
    }

    await db.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        businessId,
        linkedCount,
        results,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[POST /api/google/link-gr-to-clients] Error:", msg);

    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
      { status: 500 }
    );
  } finally {
    db.release();
  }
}
