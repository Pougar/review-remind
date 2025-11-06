// app/api/business-actions/check-onboarding-stage/route.ts
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

type Stage = "link_google" | "link-xero" | "onboarding" | "already_linked";
const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    businessId?: string;
    userId?: string;
  };

  const businessId = body.businessId?.trim();
  let userId = body.userId?.trim();

  if (!isNonEmpty(businessId)) {
    return NextResponse.json(
      { error: "BAD_INPUT", message: "businessId is required." },
      { status: 400 }
    );
  }

  if (!isNonEmpty(userId)) {
    try {
      const sess = await auth.api.getSession({ headers: req.headers });
      userId = sess?.user?.id;
    } catch {}
  }

  if (!isNonEmpty(userId)) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Provide userId in body or sign in." },
      { status: 401 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // ✅ Use set_config(..., is_local=true) instead of SET LOCAL ... = $1
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    const { rows } = await client.query(
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

    const a = rows[0] || {};
    const google = a.google_connected === true;
    const xero = a.xero_connected === true;
    const onboarded = a.onboarded === true;

    let stage: Stage = "link_google";
    if (google && !xero) stage = "link-xero";
    else if (google && xero && !onboarded) stage = "onboarding";
    else if (google && xero && onboarded) stage = "already_linked";

    return NextResponse.json({ stage }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[/api/business-actions/check-onboarding-stage] error:", err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not determine onboarding stage." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
