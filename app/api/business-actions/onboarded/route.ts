import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- DB pool (reused across HMR) ---------- */
const globalForPg = globalThis as unknown as { __pgPool?: Pool };
const pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
globalForPg.__pgPool = pool;

/* ---------- helpers ---------- */
const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const client: PoolClient = await pool.connect();
  try {
    const body = await readJson<{ businessId?: string }>(req);
    const businessId = body?.businessId;

    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid businessId is required." },
        { status: 400 }
      );
    }

    // Authenticate via BetterAuth to satisfy RLS (app.user_id)
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHENTICATED", message: "Sign in required." },
        { status: 401 }
      );
    }

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Idempotent insert (assumes UNIQUE (business_id, action))
    const result = await client.query(
      `
      INSERT INTO public.business_actions (business_id, action)
      VALUES ($1, 'onboarded')
      ON CONFLICT (business_id, action) DO NOTHING
      `,
      [businessId]
    );

    await client.query("COMMIT");
    return NextResponse.json({ success: true, inserted: result.rowCount === 1 });
  } catch (err: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/business-actions/onboarded] error:", msg);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not record business action." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
