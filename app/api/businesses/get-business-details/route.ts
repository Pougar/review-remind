// app/api/businesses/get-business-details/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reuse pool across HMR
const pool =
  (globalThis as any).__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
(globalThis as any).__pgPool = pool;

const isNonEmpty = (v?: string | null) => !!v && v.trim().length > 0;

const SQL_GET_BUSINESS = `
  SELECT
    id,
    slug,
    display_name,
    business_email,
    description,
    google_review_link
  FROM public.businesses
  WHERE id = $1 AND deleted_at IS NULL
  LIMIT 1
` as const;

// Shared handler so we can support both POST and GET
async function handle(req: NextRequest, businessId?: string, userIdFromBody?: string) {
  const bid = (businessId ?? "").trim();
  if (!isNonEmpty(bid)) {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "businessId is required." },
      { status: 400 }
    );
  }

  // Session (or explicit userId) is required to satisfy RLS
  let userId = (userIdFromBody ?? "").trim();
  if (!isNonEmpty(userId)) {
    try {
      const session = await auth.api.getSession({ headers: req.headers });
      userId = session?.user?.id ?? "";
    } catch {
      // ignore
    }
  }
  if (!isNonEmpty(userId)) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Sign in required." },
      { status: 401 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Use set_config (parameterized) instead of SET LOCAL with $1
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    const { rows } = await client.query(SQL_GET_BUSINESS, [bid]);
    await client.query("COMMIT");

    const row = rows[0];
    if (!row) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        id: row.id,
        slug: row.slug,
        display_name: row.display_name,
        business_email: row.business_email,
        description: row.description,
        google_review_link: row.google_review_link,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[GET /api/businesses/get-business-details] error:", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not load business details." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// Your page currently calls POST with { businessId }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    businessId?: string;
    userId?: string; // optional: you can pass this to avoid session lookup
  };
  return handle(req, body.businessId, body.userId);
}

// Optional GET support (handy for manual testing via URL):
// /api/businesses/get-business-details?bid=... or ?businessId=...&userId=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") ?? url.searchParams.get("businessId") ?? undefined;
  const uid = url.searchParams.get("userId") ?? undefined;
  return handle(req, bid, uid);
}
