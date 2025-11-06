// app/api/analytics/statistics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolAnalytics: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPoolAnalytics) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolAnalytics = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: true }, // set to false if your Neon certs aren't configured
      max: 5,
    });
  }
  return global._pgPoolAnalytics;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

export async function POST(req: NextRequest) {
  const pool = getPool();
  const db = await pool.connect();

  try {
    const body = await req.json().catch(() => ({} as any));
    const businessId: string | undefined = body?.businessId?.trim();

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

    type Row = { good: string | number; bad: string | number; unreviewed: string | number };
    const { rows } = await db.query<Row>(
      `
      SELECT
        COUNT(*) FILTER (WHERE LOWER(c.sentiment::text) = 'good')        AS good,
        COUNT(*) FILTER (WHERE LOWER(c.sentiment::text) = 'bad')         AS bad,
        COUNT(*) FILTER (WHERE LOWER(c.sentiment::text) = 'unreviewed'
                         OR c.sentiment IS NULL)                         AS unreviewed
      FROM public.clients c
      WHERE c.business_id = $1
        AND c.deleted_at IS NULL
      `,
      [businessId]
    );

    await db.query("COMMIT");

    const row = rows[0] ?? { good: 0, bad: 0, unreviewed: 0 };

    return NextResponse.json(
      {
        success: true,
        businessId,
        good: Number(row.good) || 0,
        bad: Number(row.bad) || 0,
        unreviewed: Number(row.unreviewed) || 0,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    try { await db.query("ROLLBACK"); } catch {}
    console.error("[POST /api/analytics/statistics] error:", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  } finally {
    db.release();
  }
}
