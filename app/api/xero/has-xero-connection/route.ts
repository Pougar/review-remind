// app/api/xero/has-xero-connection/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool =
  (globalThis as any).__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
(globalThis as any).__pgPool = pool;

const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

export async function POST(req: NextRequest) {
  const client: PoolClient = await pool.connect(); // always defined
  try {
    const { userId, businessId } = (await req.json()) as {
      userId?: string;
      businessId?: string;
    };

    if (!isUUID(userId) || !isUUID(businessId)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid userId and businessId are required." },
        { status: 400 }
      );
    }

    await client.query("BEGIN");
    // satisfy RLS: your policies check ownership via app.user_id
    await client.query("SET LOCAL app.user_id = $1", [userId]);

    const result = await client.query(
      `
      SELECT
        (COUNT(*) FILTER (WHERE is_connected IS TRUE)) > 0 AS connected,
        COUNT(*)::int AS tenant_count
      FROM integrations.xero_details
      WHERE business_id = $1
      `,
      [businessId]
    );

    await client.query("COMMIT");

    const row = (result.rows[0] ?? {}) as { connected?: boolean; tenant_count?: number };
    const connected = row.connected === true;
    const tenantCount = row.tenant_count ?? 0;

    return NextResponse.json(
      { connected, tenantCount },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[/api/xero/has-xero-connection] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
