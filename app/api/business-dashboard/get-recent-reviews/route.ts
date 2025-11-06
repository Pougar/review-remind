// app/api/get-recent-reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPool_recent: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPool_recent) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPool_recent = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: true },
      max: 5,
    });
  }
  return global._pgPool_recent;
}

/** ---------- Types ---------- */
type ReqBody = {
  userId?: string;
  businessId?: string;
  businessSlug?: string;
  limit?: number;
};

type RecentRow = {
  review_id: string;
  client_id: string | null;
  is_primary: "google" | "internal";
  client_name: string | null;
  sentiment: boolean | null;
  stars: number | null;
  review_text: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const userId = (body.userId || "").trim();
    const businessIdIn = (body.businessId || "").trim();
    const businessSlugIn = (body.businessSlug || "").trim();
    const rawLimit = Number(body.limit);
    const rowLimit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;

    if (!isNonEmpty(userId)) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      // Enforce RLS for this user
      await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

      // Resolve business id (under RLS):
      // - trust provided businessId only if it exists under RLS
      // - else resolve via businessSlug
      // - else 404 (we require a concrete business context in the new app)
      let businessId: string | null = null;

      if (isNonEmpty(businessIdIn)) {
        const res = await client.query(
          `select id from public.businesses where id = $1 and deleted_at is null limit 1`,
          [businessIdIn]
        );
        businessId = (res.rows[0] as { id: string } | undefined)?.id ?? null;
      } else if (isNonEmpty(businessSlugIn)) {
        const res = await client.query(
          `select id from public.businesses where slug = $1 and deleted_at is null limit 1`,
          [businessSlugIn]
        );
        businessId = (res.rows[0] as { id: string } | undefined)?.id ?? null;
      }

      if (!businessId) {
        await client.query("COMMIT");
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Business not found or not accessible." },
          { status: 404 }
        );
      }

      // Pull recent internal + unlinked Google reviews for this business.
      // Cast stars to float8 to get numbers (not strings) from node-postgres.
      const res = await client.query(
  `
      with internal_reviews as (
        select
          r.id::text                                as review_id,
          r.client_id::text                         as client_id,
          'internal'::text                          as is_primary,
          c.display_name::text                      as client_name,
          r.happy::boolean                          as sentiment,
          r.stars::float8                           as stars,
          nullif(btrim(r.review), '')::text         as review_text,
          r.created_at,
          r.updated_at
        from public.reviews r
        left join public.clients c on c.id = r.client_id
        where r.business_id = $1
          and r.deleted_at is null
          and nullif(btrim(r.review), '') is not null
      ),

      /* Google via VIEW (if present) */
      google_vw as (
        select
          vgr.id::text                              as review_id,
          null::text                                as client_id,
          'google'::text                            as is_primary,
          vgr.author_name::text                     as client_name,
          case
            when vgr.stars is null               then null
            when (vgr.stars::float8) >= 4       then true
            when (vgr.stars::float8) <= 2       then false
            when (vgr.stars::float8) between 2.5 and 3.5 then null
            else null
          end                                       as sentiment,
          vgr.stars::float8                         as stars,
          nullif(btrim(vgr.review), '')::text       as review_text,
          vgr.created_at,
          vgr.updated_at
        from public.v_google_reviews_with_business vgr
        where vgr.business_id = $1
          and coalesce(vgr.linked, false) = false
          and nullif(btrim(vgr.review), '') is not null
      ),

      /* Google via TABLE (direct read) */
      google_tbl as (
        select
          gr.id::text                                as review_id,
          null::text                                 as client_id,
          'google'::text                             as is_primary,
          gr.author_name::text                       as client_name,
          case
            when gr.stars is null                then null
            when (gr.stars::float8) >= 4        then true
            when (gr.stars::float8) <= 2        then false
            when (gr.stars::float8) between 2.5 and 3.5 then null
            else null
          end                                        as sentiment,
          gr.stars::float8                           as stars,
          nullif(btrim(gr.review), '')::text         as review_text,
          gr.created_at,
          gr.updated_at
        from public.google_reviews gr
        where gr.business_id = $1
          and coalesce(gr.linked, false) = false
          and nullif(btrim(gr.review), '') is not null
      ),

      /* Deduplicate google view + table */
      google_union as (
        select * from google_vw
        union               -- union removes exact duplicates safely
        select * from google_tbl
      )

      select *
      from (
        select * from internal_reviews
        union all
        select * from google_union
      ) u
      order by coalesce(u.updated_at, u.created_at) desc nulls last
      limit $2
      `,
      [businessId, rowLimit]
    );


      await client.query("COMMIT");

      const rows = res.rows as unknown as RecentRow[];

      return NextResponse.json(
        {
          success: true,
          count: rows.length,
          reviews: rows.map((r) => ({
            review_id: r.review_id,
            client_id: r.client_id,
            is_primary: r.is_primary,
            client_name: r.client_name ?? null,
            sentiment: r.sentiment,
            stars: typeof r.stars === "number" ? r.stars : null,
            review: r.review_text ?? "",
            created_at: r.created_at,
            updated_at: r.updated_at,
          })),
        },
        { headers: { "Cache-Control": "no-store" } }
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
    console.error("[/api/get-recent-reviews] error:", err?.stack || err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
