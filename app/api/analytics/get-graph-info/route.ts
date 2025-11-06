// app/api/analytics/get-graph-info/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across hot reloads, no `var`) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolGraphInfo?: Pool };

function getPool(): Pool {
  if (!globalForPg._pgPoolGraphInfo) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolGraphInfo = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: true },
      max: 5,
    });
  }
  return globalForPg._pgPoolGraphInfo;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = {
  userId?: string;
  businessId?: string;
  businessSlug?: string;
};

type IdRow = { id: string };

type GraphRow = {
  date: string;                 // to_char(..., 'YYYY-MM-DD')
  good_count: number | string;  // COUNT(*) returns string in pg by default
  bad_count: number | string;
};

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

// Safe JSON reader (avoid `any`)
async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJson<ReqBody>(req);
    const providedUserId = (body?.userId ?? "").trim();

    // RLS user id: prefer provided, fall back to server session
    let userId = providedUserId;
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

    const businessIdIn = (body?.businessId ?? "").trim();
    const businessSlugIn = (body?.businessSlug ?? "").trim();

    const pool = getPool();
    let client: PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query("BEGIN");
      // Ensure RLS applies for this user
      await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

      // Resolve business id under RLS (owner-only tables)
      let businessId: string | null = null;

      if (isNonEmpty(businessIdIn)) {
        const q = await client.query<IdRow>(
          `select id from public.businesses where id = $1 and deleted_at is null limit 1`,
          [businessIdIn]
        );
        businessId = q.rows[0]?.id ?? null;
      } else if (isNonEmpty(businessSlugIn)) {
        const q = await client.query<IdRow>(
          `select id from public.businesses where slug = $1 and deleted_at is null limit 1`,
          [businessSlugIn]
        );
        businessId = q.rows[0]?.id ?? null;
      }

      if (!businessId) {
        await client.query("COMMIT");
        return NextResponse.json(
          { success: false, error: "NOT_FOUND", message: "Business not found or not accessible." },
          { status: 404 }
        );
      }

      // ✅ Include reviews (internal), v_google_reviews_with_business (unlinked), and google_reviews (unlinked) with thresholds
      const sql = `
        with r as (
          select
            timezone('UTC', r.created_at)::date as day,
            sum(case when r.happy is true  then 1 else 0 end)::int as good,
            sum(case when r.happy is false then 1 else 0 end)::int as bad
          from public.reviews r
          where r.business_id = $1
            and r.deleted_at is null
          group by 1
        ),
        g as (
          select
            timezone('UTC', coalesce(vgr.published_at, vgr.created_at))::date as day,
            sum(case when vgr.stars is not null and (vgr.stars::float8) >= 3 then 1 else 0 end)::int as good,
            sum(case when vgr.stars is not null and (vgr.stars::float8) <  3 then 1 else 0 end)::int as bad
          from public.v_google_reviews_with_business vgr
          where vgr.business_id = $1
            and coalesce(vgr.linked, false) = false
          group by 1
        ),
        gr as (
          select
            timezone('UTC', coalesce(gr.published_at, gr.created_at))::date as day,
            sum(case when gr.stars is not null and (gr.stars::float8) > 3    then 1 else 0 end)::int as good,
            sum(case when gr.stars is not null and (gr.stars::float8) < 2.5  then 1 else 0 end)::int as bad
          from public.google_reviews gr
          where gr.business_id = $1
            and coalesce(gr.linked, false) = false
          group by 1
        ),
        u as (
          select day, good, bad from r
          union all
          select day, good, bad from g
          union all
          select day, good, bad from gr
        )
        select
          to_char(day, 'YYYY-MM-DD') as date,
          sum(good)::int as good_count,
          sum(bad)::int  as bad_count
        from u
        group by 1
        order by 1;
      `;

      const res = await client.query<GraphRow>(sql, [businessId]);

      await client.query("COMMIT");

      const points: [string, number, number][] = res.rows.map((r) => {
        const date = r.date;
        const good = Number(r.good_count) || 0;
        const bad = Number(r.bad_count) || 0;
        return [date, good, bad];
      });

      return NextResponse.json(
        { success: true, businessId, points },
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
    console.error("[/api/analytics/get-graph-info] error:", msg);
    return NextResponse.json({ success: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
