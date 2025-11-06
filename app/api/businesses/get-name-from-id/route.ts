// app/api/businesses/get-name-from-id/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across hot reloads; no eslint-disable, no `any`) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolGetBizNameFromId?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolGetBizNameFromId) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolGetBizNameFromId = new Pool({
      connectionString: cs,
      // Neon / managed PG often requires SSL
      ssl: { rejectUnauthorized: true },
      max: 5,
    });
  }
  return globalForPg._pgPoolGetBizNameFromId;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = {
  businessId?: string;
  // optional override if you already have it (RLS will still enforce ownership)
  userId?: string;
};

type NameRow = { display_name: string };

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await readJson<ReqBody>(req)) ?? {};

    // Resolve user id from body or session
    let userId = (body.userId ?? "").trim();
    if (!isNonEmpty(userId)) {
      try {
        const sess = await auth.api.getSession({ headers: req.headers });
        userId = sess?.user?.id ?? "";
      } catch {
        /* ignore */
      }
    }
    if (!isNonEmpty(userId)) {
      return NextResponse.json({ success: false, error: "MISSING_USER_ID" }, { status: 401 });
    }

    const businessId = (body.businessId ?? "").trim();
    if (!isNonEmpty(businessId)) {
      return NextResponse.json({ success: false, error: "MISSING_BUSINESS_ID" }, { status: 400 });
    }

    const pool = getPool();
    let client: PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query("BEGIN");
      // Ensure RLS applies for this user
      await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

      // Under RLS, this will only return a row if the requester owns the business
      const q = await client.query<NameRow>(
        `
          select display_name
          from public.businesses
          where id = $1
            and deleted_at is null
          limit 1
        `,
        [businessId]
      );

      await client.query("COMMIT");

      const row = q.rows[0];
      if (!row) {
        return NextResponse.json(
          { success: false, error: "NOT_FOUND", message: "Business not found or not accessible." },
          { status: 404, headers: { "Cache-Control": "no-store" } }
        );
      }

      return NextResponse.json(
        { success: true, id: businessId, display_name: row.display_name },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    } catch (err) {
      try {
        if (client) await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      if (client) client.release();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[/api/businesses/get-name-from-id] error:", msg);
    return NextResponse.json({ success: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
