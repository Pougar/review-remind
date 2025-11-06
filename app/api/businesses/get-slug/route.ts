// app/api/businesses/get-slug/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient, type QueryResult } from "pg";
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

const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

export async function POST(req: NextRequest) {
  const client: PoolClient = await pool.connect();
  try {
    const { businessId } = (await req.json().catch(() => ({}))) as { businessId?: string };
    if (!isUUID(businessId)) {
      return NextResponse.json({ error: "BAD_INPUT", message: "Valid businessId is required." }, { status: 400 });
    }

    // Use BetterAuth session for RLS
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHENTICATED", message: "Sign in required." }, { status: 401 });
    }

    await client.query("BEGIN");
    await client.query("SET LOCAL app.user_id = $1", [userId]);

    const result = (await client.query(
      `SELECT slug FROM public.businesses WHERE id = $1 LIMIT 1`,
      [businessId]
    )) as QueryResult<{ slug: string }>;

    await client.query("COMMIT");

    const slug = result.rows[0]?.slug;
    if (!slug) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Business not found." }, { status: 404 });
    }

    return NextResponse.json({ slug }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    try { await pool.query("ROLLBACK"); } catch {}
    console.error("[/api/businesses/get-slug] error:", e);
    return NextResponse.json({ error: "INTERNAL", message: "Could not fetch business slug." }, { status: 500 });
  } finally {
    client.release();
  }
}
