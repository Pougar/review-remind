// app/api/businesses/get-logo-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const globalForPg = globalThis as unknown as { __pgPool?: Pool };
const pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
globalForPg.__pgPool = pool;

const BUCKET = "company-logos";
const SIGNED_TTL = 60 * 60 * 24; // 24h, tune as needed

type Body = {
  userId?: string;
  businessId?: string;
  businessSlug?: string;
};

type IdRow = { id: string };
type PrefRow = { bid: string | null };
type LogoRow = { url: string | null };

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await readJson<Body>(req);

  let userId = body?.userId?.trim();
  const businessId = body?.businessId?.trim();
  const businessSlug = body?.businessSlug?.trim();

  if (!isNonEmpty(userId)) {
    try {
      const sess = await auth.api.getSession({ headers: req.headers });
      userId = sess?.user?.id ?? undefined;
    } catch {
      /* ignore */
    }
  }
  if (!isNonEmpty(userId)) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Provide userId or sign in." },
      { status: 401 }
    );
  }

  let client: PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

    // Resolve business id (same as before)
    let bid: string | null = null;

    if (isNonEmpty(businessId)) {
      const res = await client.query<IdRow>(
        `select id from public.businesses where id = $1 and deleted_at is null limit 1`,
        [businessId]
      );
      bid = res.rows[0]?.id ?? null;
    } else if (isNonEmpty(businessSlug)) {
      const res = await client.query<IdRow>(
        `select id from public.businesses where slug = $1 and deleted_at is null limit 1`,
        [businessSlug]
      );
      bid = res.rows[0]?.id ?? null;
    } else {
      const res = await client.query<PrefRow>(
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
      bid = res.rows[0]?.bid ?? null;
    }

    if (!bid) {
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found or not accessible." },
        { status: 404 }
      );
    }

    const logoRes = await client.query<LogoRow>(
      `select company_logo_url as url from public.businesses where id = $1 limit 1`,
      [bid]
    );
    await client.query("COMMIT");

    const path = logoRes.rows[0]?.url; // 🔑 stored path like `bid/logo.png`
    if (!path) {
      return NextResponse.json(
        { url: null, message: "No logo configured." },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Generate signed URL for private bucket
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_TTL);

    if (error || !data?.signedUrl) {
      console.error("[get-logo-url] createSignedUrl error:", error);
      return NextResponse.json(
        { error: "SIGNED_URL_FAILED" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        url: data.signedUrl,
        expiresIn: SIGNED_TTL,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/businesses/get-logo-url] error:", msg);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not retrieve logo URL." },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
