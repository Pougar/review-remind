// app/api/business-actions/check-onboarding-stage/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG Pool (singleton, no `any`) ---------- */
const globalForPg = globalThis as unknown as { __pgPool?: Pool };
const pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
globalForPg.__pgPool = pool;

/** ---------- Types & helpers ---------- */
type Stage = "link_google" | "link-xero" | "onboarding" | "already_linked";

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

type Body = {
  businessId?: string;
  userId?: string;
};

type FlagsRow = {
  google_connected: boolean | null;
  xero_connected: boolean | null;
  onboarded: boolean | null;
};

/** ---------- Route ---------- */
export async function POST(req: NextRequest) {
  const body = await readJson<Body>(req);

  const businessId = body?.businessId?.trim();
  let userId = body?.userId?.trim();

  if (!isNonEmpty(businessId)) {
    return NextResponse.json(
      { error: "BAD_INPUT", message: "businessId is required." },
      { status: 400 }
    );
  }

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
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    const { rows } = await client.query<FlagsRow>(
      `
      SELECT
        BOOL_OR(action = 'google_connected') AS google_connected,
        BOOL_OR(action = 'xero_connected')    AS xero_connected,
        BOOL_OR(action = 'onboarded')         AS onboarded
      FROM public.business_actions
      WHERE business_id = $1
      `,
      [businessId]
    );

    await client.query("COMMIT");

    const a = rows[0] ?? { google_connected: null, xero_connected: null, onboarded: null };
    const google = a.google_connected === true;
    const xero = a.xero_connected === true;
    const onboarded = a.onboarded === true;

    let stage: Stage = "link_google";
    if (google && !xero) stage = "link-xero";
    else if (google && xero && !onboarded) stage = "onboarding";
    else if (google && xero && onboarded) stage = "already_linked";

    return NextResponse.json({ stage }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/business-actions/check-onboarding-stage] error:", msg);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not determine onboarding stage." },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
