// app/api/clients/get-clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolClients?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolClients) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolClients = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolClients;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

/**
 * POST /api/clients/get-clients
 * Body: { businessId: string }
 * Returns clients for the given business (RLS via app.user_id).
 * - Timeline from client_actions
 * - Primary review selection rule:
 *    Prefer latest INTERNAL review text (public.reviews);
 *    if none, fallback to latest Google review text (public.google_reviews)
 *    **scoped by business_id**, not user_id.
 */
export async function POST(req: NextRequest) {
  const pool = getPool();
  const db = await pool.connect();

  try {
    const body = (await req.json().catch(() => ({}))) as { businessId?: string };
    const businessId = body.businessId?.trim();
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

    const sql = `
      WITH base AS (
        SELECT
          c.id,
          c.display_name AS name,
          c.email,
          c.phone_number,
          c.sentiment,
          c.invoice_status::text AS invoice_status,
          c.created_at           AS added_at
        FROM public.clients c
        WHERE c.business_id = $1
          AND c.deleted_at IS NULL
      ),
      actions AS (
        SELECT
          ca.client_id,
          MAX(CASE WHEN ca.action::text = 'email_sent'       THEN ca.created_at END) AS email_last_sent_at,
          MAX(CASE WHEN ca.action::text = 'link_clicked'     THEN ca.created_at END) AS click_at,
          MAX(CASE WHEN ca.action::text = 'review_submitted' THEN ca.created_at END) AS action_review_submitted_at
        FROM public.client_actions ca
        JOIN base b ON b.id = ca.client_id
        GROUP BY ca.client_id
      ),
      internal_latest AS (
        /* Latest non-empty INTERNAL review per client (business-scoped) */
        SELECT
          r.client_id,
          NULLIF(BTRIM(r.review), '') AS review_text,
          COALESCE(r.updated_at, r.created_at) AS review_time
        FROM public.reviews r
        JOIN base b ON b.id = r.client_id
        WHERE r.business_id = $1
          AND NULLIF(BTRIM(r.review), '') IS NOT NULL
      ),
      google_latest AS (
        /* Latest non-empty Google review per client, scoped by business_id.
           If you later add google_reviews.client_id, switch to gr.client_id = b.id. */
        SELECT
          b.id AS client_id,
          NULLIF(BTRIM(gr.review), '') AS review_text,
          COALESCE(gr.updated_at, gr.created_at) AS review_time
        FROM base b
        JOIN public.google_reviews gr
          ON gr.business_id = $1
         AND lower(gr.author_name) = lower(b.name)
        WHERE NULLIF(BTRIM(gr.review), '') IS NOT NULL
      )
      SELECT
        b.id,
        b.name,
        b.email,
        b.phone_number,
        b.sentiment,

        /* Prefer internal text; else Google; only if not 'unreviewed' */
        CASE WHEN b.sentiment <> 'unreviewed'
             THEN COALESCE(ir.review_text, gr.review_text)
             ELSE NULL
        END AS review,

        b.invoice_status,
        b.added_at,

        /* timeline */
        a.email_last_sent_at,
        a.click_at,

        /* If we surfaced a review, use its time (internal preferred) */
        CASE
          WHEN b.sentiment <> 'unreviewed'
          THEN COALESCE(ir.review_time, gr.review_time)
          ELSE NULL
        END AS review_submitted_at

      FROM base b
      LEFT JOIN actions a ON a.client_id = b.id
      LEFT JOIN LATERAL (
        SELECT il.review_text, il.review_time
        FROM internal_latest il
        WHERE il.client_id = b.id
        ORDER BY il.review_time DESC NULLS LAST
        LIMIT 1
      ) ir ON true
      LEFT JOIN LATERAL (
        SELECT gl.review_text, gl.review_time
          FROM google_latest gl
         WHERE gl.client_id = b.id
         ORDER BY gl.review_time DESC NULLS LAST
         LIMIT 1
      ) gr ON ir.review_text IS NULL
      ORDER BY b.added_at DESC, b.id DESC
    `;

    const { rows } = await db.query(sql, [businessId]);
    await db.query("COMMIT");

    return NextResponse.json(
      { clients: rows },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    try { await db.query("ROLLBACK"); } catch {}
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/clients/get-clients] Error:", msg);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  } finally {
    db.release();
  }
}
