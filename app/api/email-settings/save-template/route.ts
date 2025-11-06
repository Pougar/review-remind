// app/api/email-settings/save-template/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========= PG Pool (singleton across hot reloads) ========= */
const globalForPg = globalThis as unknown as { _pgPoolEmailTemplateSave?: Pool };

function getPool(): Pool {
  if (!globalForPg._pgPoolEmailTemplateSave) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolEmailTemplateSave = new Pool({
      connectionString: cs,
      // Neon/hosted PG often needs SSL; `rejectUnauthorized: false` is common
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolEmailTemplateSave;
}

/* ========= Helpers ========= */
const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);
const capLen = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n));

const MAX_SUBJECT = 200;
const MAX_BODY = 8000;

type ReqBody = {
  businessId?: string;
  email_subject?: string | null;
  email_body?: string | null;
};

export async function POST(req: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    /* ---------- Auth (BetterAuth session) ---------- */
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    /* ---------- Parse / validate input ---------- */
    const bodyJson = ((await req.json().catch(() => ({}))) || {}) as ReqBody;
    const businessId = (bodyJson.businessId || "").trim();
    const rawSubject = bodyJson.email_subject ?? "";
    const rawBody = bodyJson.email_body ?? "";

    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid businessId (uuid) is required." },
        { status: 400 }
      );
    }

    // Trim + cap lengths
    const subject =
      typeof rawSubject === "string" ? capLen(rawSubject.trim(), MAX_SUBJECT) : "";
    const templateBody =
      typeof rawBody === "string" ? capLen(rawBody.trim(), MAX_BODY) : "";

    /* ---------- Set RLS context ---------- */
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    /* ---------- Upsert into email_templates ---------- */
    // Assumes UNIQUE(business_id) on public.email_templates
    const q = await client.query<{
      id: string;
      business_id: string;
      email_subject: string | null;
      email_body: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
      INSERT INTO public.email_templates (
        business_id,
        email_subject,
        email_body,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        $2::text,
        $3::text,
        NOW(),
        NOW()
      )
      ON CONFLICT (business_id)
      DO UPDATE
      SET email_subject = EXCLUDED.email_subject,
          email_body    = EXCLUDED.email_body,
          updated_at    = NOW()
      RETURNING
        id,
        business_id,
        email_subject,
        email_body,
        created_at,
        updated_at
      `,
      [businessId, subject, templateBody]
    );

    if (q.rowCount === 0) {
      return NextResponse.json({ error: "NOT_ALLOWED_OR_NOT_FOUND" }, { status: 403 });
    }

    const row = q.rows[0];

    /* ---------- Respond ---------- */
    return NextResponse.json(
      {
        success: true,
        businessId: row.business_id,
        email_subject: row.email_subject ?? "",
        email_body: row.email_body ?? "",
        updated_at: row.updated_at,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("row-level security")) {
      return NextResponse.json(
        { error: "RLS_DENIED", message: "Permission denied by row-level security." },
        { status: 403 }
      );
    }

    const log = err instanceof Error ? err.stack || err.message : String(err);
    console.error("[/api/email-settings/save-template] error:", log);
    return NextResponse.json(
      { error: "SERVER_ERROR", message: "Failed to save template." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
