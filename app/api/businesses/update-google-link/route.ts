// app/api/businesses/update-google-link/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG Pool (singleton across hot reloads; no eslint-disable, no `any`) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolUpdateGoogleLink?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolUpdateGoogleLink) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolUpdateGoogleLink = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolUpdateGoogleLink;
}

/* ---------- Helpers ---------- */

const MAX_URL_LEN = 2048;
const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

/**
 * Light validation so you don't accidentally paste a non-Google URL.
 * Accept common Google Maps / Google Business / g.page styles.
 */
function looksLikeGoogleReviewLink(urlStr?: string | null): boolean {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();

    return (
      host.includes("google.com") ||
      host.includes("business.google.com") ||
      host.includes("maps.google.com") ||
      host.includes("maps.app.goo.gl") ||
      host === "g.page" ||
      host.endsWith(".g.page") ||
      host.endsWith("goo.gl")
    );
  } catch {
    return false;
  }
}

type ReqBody = {
  businessId?: string;
  googleBusinessLink?: string | null; // frontend still calls it this
};

export async function POST(req: NextRequest) {
  const pool = getPool();
  const db = await pool.connect();

  try {
    const { businessId, googleBusinessLink } =
      ((await req.json().catch(() => ({}))) as ReqBody);

    // 1. Validate businessId
    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "MISSING_OR_INVALID_BUSINESS_ID" },
        { status: 400 }
      );
    }

    // 2. Auth (BetterAuth) -> used for RLS
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    await db.query("BEGIN");
    // attach RLS identity
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // 3. Normalise and validate link
    let normalizedLink: string | null = null;

    if (typeof googleBusinessLink === "string") {
      const trimmed = googleBusinessLink.trim().slice(0, MAX_URL_LEN);
      normalizedLink = trimmed.length ? trimmed : null;
    } else if (googleBusinessLink === null) {
      normalizedLink = null;
    } else {
      normalizedLink = null; // undefined => clear
    }

    if (normalizedLink && !looksLikeGoogleReviewLink(normalizedLink)) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "INVALID_GOOGLE_URL",
          message: "Provide a valid Google review / Google Maps link.",
        },
        { status: 400 }
      );
    }

    /**
     * 4. Update businesses.google_review_link
     */
    const updateQ = await db.query<{
      id: string;
      slug: string;
      display_name: string;
      google_review_link: string | null;
      updated_at: string;
    }>(
      `
      UPDATE public.businesses
      SET
        google_review_link = $2,
        updated_at          = NOW()
      WHERE id = $1
      RETURNING
        id,
        slug,
        display_name,
        google_review_link,
        updated_at
      `,
      [businessId, normalizedLink]
    );

    if (updateQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "NOT_FOUND",
          message: "Business not found or not accessible.",
        },
        { status: 404 }
      );
    }

    await db.query("COMMIT");

    const row = updateQ.rows[0];

    return NextResponse.json(
      {
        success: true,
        business: {
          id: row.id,
          slug: row.slug,
          display_name: row.display_name,
          google_review_link: row.google_review_link,
          updated_at: row.updated_at,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg =
      err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[update-google-link] error:", msg);

    // common dev footgun: RLS not granting UPDATE on businesses to owner
    const lower = msg.toLowerCase();
    if (lower.includes("row-level security")) {
      return NextResponse.json(
        {
          error: "RLS_BLOCKED",
          message:
            "Row-level security blocked this update. Check that the RLS policy on businesses allows the owner (app.user_id) to UPDATE google_review_link.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    db.release();
  }
}
