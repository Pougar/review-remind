// app/api/dashboard/check-new-user/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
declare global {
  var _pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPool = new Pool({
      connectionString: cs,
      // Adjust SSL to your environment; many managed PGs require SSL in prod
      ssl: { rejectUnauthorized: true },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = { user_id?: string; userId?: string };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const userId = (body.user_id || body.userId || "").trim();

    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      // Set transaction-local GUC so RLS policies apply
      await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

      const res = await client.query(
        `
        select
          created_at,
          (created_at <= now() - interval '7 days') as older_than_week
        from public.myusers
        where betterauth_id = $1
        limit 1
        `,
        [userId]
      );

      await client.query("COMMIT");

      if (res.rowCount === 0) {
        // Either no profile row or blocked by RLS (not the same user)
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      }

      const row = res.rows[0] as { created_at: string | null; older_than_week: boolean | null };
      const olderThanWeek = row.older_than_week === true;

      return NextResponse.json(
        {
          success: true,
          userId,
          older_than_week: olderThanWeek,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("[/api/dashboard/check-new-user] error:", e.stack ?? e);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
