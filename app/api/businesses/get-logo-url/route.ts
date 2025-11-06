// app/api/businesses/get-logo-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool =
  (globalThis as any).__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
(globalThis as any).__pgPool = pool;

type Body = {
  userId?: string;
  businessId?: string;
  businessSlug?: string;
};

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

// Keep a small TTL so the client refreshes periodically.
// If your URLs are static, feel free to bump this up.
const DEFAULT_EXPIRES_IN_SECONDS = 300; // 5 minutes

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;

  let userId = body.userId?.trim();
  const businessId = body.businessId?.trim();
  const businessSlug = body.businessSlug?.trim();

  // Fallback to session if userId not provided
  if (!isNonEmpty(userId)) {
    try {
      const sess = await auth.api.getSession({ headers: req.headers });
      userId = sess?.user?.id;
    } catch {}
  }
  if (!isNonEmpty(userId)) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Provide userId or sign in." },
      { status: 401 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

    // Resolve business id (RLS enforced by policies)
    let bid: string | null = null;

    if (isNonEmpty(businessId)) {
      const res = await client.query(
        `select id from public.businesses where id = $1 and deleted_at is null limit 1`,
        [businessId]
      );
      const row = res.rows[0] as { id: string } | undefined;
      bid = row?.id ?? null;
    } else if (isNonEmpty(businessSlug)) {
      const res = await client.query(
        `select id from public.businesses where slug = $1 and deleted_at is null limit 1`,
        [businessSlug]
      );
      const row = res.rows[0] as { id: string } | undefined;
      bid = row?.id ?? null;
    } else {
      // Fallback: use last_active_business_id, then default_business_id, then most recent
      const res = await client.query(
        `
        with pref as (
          select coalesce(last_active_business_id, default_business_id) as bid
          from public.myusers
          where betterauth_id = $1
          limit 1
        )
        select
          case
            when pref.bid is not null then pref.bid
            else (
              select b.id
              from public.businesses b
              where b.user_id = $1 and b.deleted_at is null
              order by b.updated_at desc
              limit 1
            )
          end as bid
        from pref
        `,
        [userId]
      );
      const row = res.rows[0] as { bid: string | null } | undefined;
      bid = row?.bid ?? null;
    }

    if (!bid) {
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found or not accessible." },
        { status: 404 }
      );
    }

    // Fetch the logo URL
    const logoRes = await client.query(
      `select company_logo_url as url from public.businesses where id = $1 limit 1`,
      [bid]
    );
    await client.query("COMMIT");

    const logoRow = logoRes.rows[0] as { url: string | null } | undefined;
    const url = logoRow?.url ?? null;

    return NextResponse.json(
      { url, expiresIn: DEFAULT_EXPIRES_IN_SECONDS, expiresAt: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[/api/retrieve-logo-url] error:", err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not retrieve logo URL." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
