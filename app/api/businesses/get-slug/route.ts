// app/api/businesses/get-slug/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG pool singleton (no `any`) ---------- */
const globalForPg = globalThis as unknown as { __pgPool?: Pool };
const pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
globalForPg.__pgPool = pool;

/** ---------- Helpers ---------- */
const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

type Body = { businessId?: string };
type SlugRow = { slug: string };

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

/** ---------- Route ---------- */
export async function POST(req: NextRequest) {
  let client: PoolClient | null = null;

  try {
    const body = (await readJson<Body>(req)) ?? {};
    const businessId = body.businessId?.trim();

    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "BAD_INPUT", message: "Valid businessId is required." },
        { status: 400 }
      );
    }

    // Use BetterAuth session for RLS
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHENTICATED", message: "Sign in required." },
        { status: 401 }
      );
    }

    client = await pool.connect();
    await client.query("BEGIN");
    // Parameterized, RLS-friendly
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

    const { rows } = await client.query<SlugRow>(
      `select slug from public.businesses where id = $1 limit 1`,
      [businessId]
    );

    await client.query("COMMIT");

    const slug = rows[0]?.slug;
    if (!slug) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { slug },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: unknown) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/businesses/get-slug] error:", msg);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not fetch business slug." },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
