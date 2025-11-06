// app/api/analytics/get-gbu-counts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** ---------- PG Pool (singleton across HMR, no `var`) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolAnalytics?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolAnalytics) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolAnalytics = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: true }, // set to false if your Neon certs aren't configured
      max: 5,
    });
  }
  return globalForPg._pgPoolAnalytics;
}

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

type Row = {
  good: string | number;
  bad: string | number;
  unreviewed: string | number;
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

    const { rows } = await db.query<Row>(
      `
      SELECT
        COUNT(*) FILTER (WHERE LOWER(c.sentiment::text) = 'good') AS good,
        COUNT(*) FILTER (WHERE LOWER(c.sentiment::text) = 'bad')  AS bad,
        COUNT(*) FILTER (
          WHERE LOWER(c.sentiment::text) = 'unreviewed' OR c.sentiment IS NULL
        ) AS unreviewed
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
  } catch (err: unknown) {
    if (db) {
      try {
        await db.query("ROLLBACK");
      } catch {
        // ignore rollback error
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/analytics/get-gbu-counts] error:", msg);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
