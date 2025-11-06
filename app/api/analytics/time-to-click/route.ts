// app/api/analytics/avg-email-to-click/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR, no `var`) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolAvgEmailToClick?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolAvgEmailToClick) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolAvgEmailToClick = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: true }, // set false only if your Neon certs aren't configured
      max: 5,
    });
  }
  return globalForPg._pgPoolAvgEmailToClick;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

type Row = {
  pair_count: string | null;   // numeric → string from pg
  avg_seconds: string | null;  // numeric → string from pg
};

// Safe JSON reader (avoid `any`)
async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const pool = getPool();
  let db: PoolClient | null = null;

  try {
    db = await pool.connect();

    const body = await readJson<{ businessId?: string }>(req);
    const businessId =
      typeof body?.businessId === "string" ? body.businessId.trim() : undefined;

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

    // For each client:
    // - most recent email_sent (sent_at)
    // - earliest link_clicked at/after sent_at (click_at)
    // - diff = click_at - sent_at; then average over clients with both
    const { rows } = await db.query<Row>(
      `
      WITH base AS (
        SELECT c.id
        FROM public.clients c
        WHERE c.business_id = $1
          AND c.deleted_at IS NULL
      ),
      last_sent AS (
        SELECT ca.client_id, MAX(ca.created_at) AS sent_at
        FROM public.client_actions ca
        JOIN base b ON b.id = ca.client_id
        WHERE ca.action::text = 'email_sent'
        GROUP BY ca.client_id
      ),
      first_click_after AS (
        SELECT ca.client_id, MIN(ca.created_at) AS click_at
        FROM public.client_actions ca
        JOIN last_sent s ON s.client_id = ca.client_id
        WHERE ca.action::text = 'link_clicked'
          AND ca.created_at >= s.sent_at
        GROUP BY ca.client_id
      ),
      pairs AS (
        SELECT
          s.client_id,
          s.sent_at,
          f.click_at,
          EXTRACT(EPOCH FROM (f.click_at - s.sent_at))::numeric AS diff_seconds
        FROM last_sent s
        JOIN first_click_after f ON f.client_id = s.client_id
      )
      SELECT
        COUNT(*)::numeric AS pair_count,
        AVG(diff_seconds) AS avg_seconds
      FROM pairs
      `,
      [businessId]
    );

    await db.query("COMMIT");

    const row = rows[0] ?? { pair_count: null, avg_seconds: null };
    const consideredClients = row.pair_count ? Number(row.pair_count) : 0;
    const avgSeconds = row.avg_seconds != null ? Number(row.avg_seconds) : null;

    return NextResponse.json(
      {
        success: true,
        businessId,
        consideredClients,
        avgSeconds,
        avgMinutes: avgSeconds == null ? null : avgSeconds / 60,
        avgHours: avgSeconds == null ? null : avgSeconds / 3600,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    if (db) {
      try {
        await db.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/analytics/avg-email-to-click] error:", msg);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
