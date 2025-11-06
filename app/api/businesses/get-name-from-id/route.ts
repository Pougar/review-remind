// app/api/businesses/get-name-from-id/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolGetBizNameFromId: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolGetBizNameFromId) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolGetBizNameFromId = new Pool({
      connectionString: cs,
      // Neon / managed PG often requires SSL
      ssl: { rejectUnauthorized: true },
      max: 5,
    });
  }
  return global._pgPoolGetBizNameFromId;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = {
  businessId?: string;
  // optional override if you already have it (RLS will still enforce ownership)
  userId?: string;
};

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;

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
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      // Ensure RLS applies for this user
      await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

      // Under RLS, this will only return a row if the requester owns the business
      const q = await client.query<{ display_name: string }>(
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
        await client.query("ROLLBACK");
      } catch {}
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[/api/businesses/get-name-from-id] error:", err?.stack || err);
    return NextResponse.json({ success: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
