// app/api/businesses/get-id-by-slug/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
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

/** ---------- Types & helpers ---------- */
type Body = {
  businessSlug?: string;
  userId?: string;
};

type IdRow = { id: string };

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

/** ---------- Route ---------- */
export async function POST(req: NextRequest) {
  const body = await readJson<Body>(req);

  const businessSlug = body?.businessSlug?.trim();
  let userId = body?.userId?.trim();

  if (!isNonEmpty(businessSlug)) {
    return NextResponse.json(
      { error: "BAD_INPUT", message: "businessSlug is required." },
      { status: 400 }
    );
  }

  // Fallback to session if userId not provided
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
      { error: "UNAUTHENTICATED", message: "Provide userId in body or sign in." },
      { status: 401 }
    );
  }

  let client: PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

    const { rows } = await client.query<IdRow>(
      `
      select id
      from public.businesses
      where slug = $1 and deleted_at is null
      limit 1
      `,
      [businessSlug]
    );

    await client.query("COMMIT");

    const id = rows[0]?.id;
    if (!id) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { id },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/businesses/get-id-by-slug] error:", msg);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not resolve business id." },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
