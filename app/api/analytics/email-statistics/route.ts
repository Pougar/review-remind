// app/api/analytics/email-analytics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR) ---------- */
// Avoid `var` and eslint-disable by using a globalThis slot.
const globalForPg = globalThis as unknown as {
  _pgPoolEmailAnalytics?: Pool;
};

function getPool(): Pool {
  if (!globalForPg._pgPoolEmailAnalytics) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolEmailAnalytics = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: true }, // set to false only if your Neon certs aren't configured
      max: 5,
    });
  }
  return globalForPg._pgPoolEmailAnalytics;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

type CountsRow = {
  total_clients: string | number;
  email_sent: string | number;
  review_clicked: string | number;
  review_submitted: string | number;
};

// Safe JSON reader (no `any`)
async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const pool = getPool();
  let db: PoolClient | null = null;

  try {
    db = await pool.connect();

    const body = await readJson<{ businessId?: string }>(req);
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : undefined;

    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid businessId is required." },
        { status: 400 }
      );
    }

    // Auth → set app.user_id for RLS
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Count unique clients by action type (email_sent, link_clicked, review_submitted)
    // within the given business.
    const { rows } = await db.query<CountsRow>(
      `
      WITH base AS (
        SELECT c.id
        FROM public.clients c
        WHERE c.business_id = $1
          AND c.deleted_at IS NULL
      ),
      actions AS (
        SELECT
          ca.client_id,
          BOOL_OR(ca.action::text = 'email_sent')       AS email_sent,
          BOOL_OR(ca.action::text = 'link_clicked')     AS review_clicked,
          BOOL_OR(ca.action::text = 'review_submitted') AS review_submitted
        FROM public.client_actions ca
        JOIN base b ON b.id = ca.client_id
        GROUP BY ca.client_id
      )
      SELECT
        (SELECT COUNT(*) FROM base)                                          AS total_clients,
        COUNT(*) FILTER (WHERE COALESCE(a.email_sent, false))               AS email_sent,
        COUNT(*) FILTER (WHERE COALESCE(a.review_clicked, false))           AS review_clicked,
        COUNT(*) FILTER (WHERE COALESCE(a.review_submitted, false))         AS review_submitted
      FROM base b
      LEFT JOIN actions a ON a.client_id = b.id
      `,
      [businessId]
    );

    await db.query("COMMIT");

    const r = rows[0] ?? {
      total_clients: 0,
      email_sent: 0,
      review_clicked: 0,
      review_submitted: 0,
    };

    return NextResponse.json(
      {
        success: true,
        businessId,
        totalClients: Number(r.total_clients) || 0,
        metrics: {
          emailSent: Number(r.email_sent) || 0,
          reviewClicked: Number(r.review_clicked) || 0,
          reviewSubmitted: Number(r.review_submitted) || 0,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    if (db) {
      try {
        await db.query("ROLLBACK");
      } catch {
        // ignore
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/analytics/email-analytics] error:", msg);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
