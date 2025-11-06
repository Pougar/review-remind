// app/api/email-settings/get-template/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG Pool (singleton across HMR) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolEmailTemplateGet?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolEmailTemplateGet) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolEmailTemplateGet = new Pool({
      connectionString: cs,
      // Neon typically needs SSL; set false if your URL already includes sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolEmailTemplateGet;
}

type ReqBody = { businessId?: string };

type TemplateRow = {
  email_subject: string | null;
  email_body: string | null;
};

const isUUID = (v?: string | null) =>
  !!v &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
    v
  );

export async function POST(req: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const { businessId } = (await req.json().catch(() => ({}))) as ReqBody;

    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "MISSING_OR_INVALID_BUSINESS_ID" },
        { status: 400 }
      );
    }

    // Auth (BetterAuth): set RLS context
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // Set app.user_id so RLS can enforce ownership via businesses.user_id
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    const q = await client.query<TemplateRow>(
      `
        SELECT email_subject, email_body
        FROM public.email_templates
        WHERE business_id = $1
        LIMIT 1
      `,
      [businessId]
    );

    const row = q.rows[0] || null;

    return NextResponse.json(
      {
        success: true,
        businessId,
        found: !!row,
        email_subject: row?.email_subject ?? null,
        email_body: row?.email_body ?? null,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const log = err instanceof Error ? err.stack || err.message : String(err);
    console.error("[/api/email-settings/get-template] error:", log);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  } finally {
    client.release();
  }
}
