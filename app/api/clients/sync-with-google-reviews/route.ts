// app/api/clients/sync-with-google-reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolSyncGoogle: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPoolSyncGoogle) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolSyncGoogle = new Pool({
      connectionString: cs,
      // Neon typically => SSL on; rejectUnauthorized=false plays nicely unless your URL has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolSyncGoogle;
}

/* ---------------- helpers ---------------- */
const isUUID = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-fA-F-]{36}$/.test(v);

function cleanText(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

type ReqBody = { businessId?: string; business_id?: string };

export async function POST(req: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const rawBusinessId = (body.businessId ?? body.business_id)?.trim();

    if (!isUUID(rawBusinessId)) {
      return NextResponse.json(
        { error: "MISSING_OR_INVALID_BUSINESS_ID" },
        { status: 400 }
      );
    }
    const businessId = rawBusinessId;

    // Authenticate user to satisfy RLS (we set app.user_id)
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    await client.query("BEGIN");
    // Use set_config(..., is_local=true) so it resets at tx end; parameters can't be used with SET
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // 1) Find unlinked Google reviews for this business and match to clients by name (case-insensitive)
    const { rows: matches } = await client.query<{
      g_id: string;
      g_name: string | null;
      g_text: string | null;
      g_stars: number | null;
      client_id: string;
      client_sentiment: "good" | "bad" | "unreviewed" | null;
      created_at: string | null;
    }>(
      `
      SELECT
        gr.id        AS g_id,
        gr.name      AS g_name,
        gr.review    AS g_text,
        gr.stars     AS g_stars,
        c.id         AS client_id,
        c.sentiment  AS client_sentiment,
        gr.created_at
      FROM public.google_reviews gr
      JOIN public.clients c
        ON c.business_id = gr.business_id
       AND LOWER(c.name) = LOWER(gr.name)
      WHERE gr.business_id = $1
        AND gr.linked = FALSE
      ORDER BY gr.created_at DESC NULLS LAST, gr.id
      `,
      [businessId]
    );

    let matched = matches.length;
    let inserted = 0;
    let updatedExisting = 0;
    let clientsSentimentUpdated = 0;
    let googleLinked = 0;

    // 2) For each matched review, update/create a row in public.reviews and adjust client sentiment if needed
    for (const m of matches) {
      const gId = m.g_id;
      const gText = cleanText(m.g_text);
      const gStars = m.g_stars;
      const clientId = m.client_id;

      // Fetch the most recent review row for this client (no user_id in new schema)
      const { rows: revRows } = await client.query<{
        id: string;
        review: string | null;
        google_review: string | null;
        is_primary: "google" | "internal";
      }>(
        `
        SELECT
          r.id,
          NULLIF(BTRIM(r.review), '')        AS review,
          NULLIF(BTRIM(r.google_review), '') AS google_review,
          r."isPrimary"                      AS is_primary
        FROM public.reviews r
        WHERE r.client_id = $1
        ORDER BY COALESCE(r.updated_at, r.created_at) DESC NULLS LAST, r.id DESC
        LIMIT 1
        `,
        [clientId]
      );

      if (revRows.length > 0) {
        // Existing review row: attach google fields and preserve 'internal' as primary if present
        const existing = revRows[0];
        const hasInternal = !!existing.review;

        const res = await client.query(
          `
          UPDATE public.reviews r
          SET
            google_review = COALESCE(NULLIF(BTRIM($1), ''), r.google_review),
            g_review_id   = $2,
            stars         = COALESCE($3, r.stars),
            "isPrimary"   = CASE WHEN $4 THEN 'internal'::review_primary_source ELSE r."isPrimary" END,
            updated_at    = NOW()
          WHERE r.id = $5
          `,
          [gText, gId, gStars, hasInternal, existing.id]
        );
        if (res.rowCount) updatedExisting++;

        // If client was unreviewed and we now have stars, infer sentiment
        if (m.client_sentiment === "unreviewed" && gStars != null) {
          const sres = await client.query(
            `
            UPDATE public.clients
            SET sentiment = CASE WHEN $1 > 2.5 THEN 'good' ELSE 'bad' END,
                updated_at = NOW()
            WHERE id = $2
            `,
            [gStars, clientId]
          );
          if (sres.rowCount) clientsSentimentUpdated++;
        }
      } else {
        // No review row: create with Google as primary
        const ins = await client.query(
          `
          INSERT INTO public.reviews
            (client_id, google_review, g_review_id, stars, "isPrimary", created_at, updated_at)
          VALUES
            ($1,        NULLIF(BTRIM($2), ''), $3,   $4,    'google'::review_primary_source, NOW(), NOW())
          `,
          [clientId, gText, gId, gStars]
        );
        if (ins.rowCount) inserted++;

        if (m.client_sentiment === "unreviewed" && gStars != null) {
          const sres = await client.query(
            `
            UPDATE public.clients
            SET sentiment = CASE WHEN $1 > 2.5 THEN 'good' ELSE 'bad' END,
                updated_at = NOW()
            WHERE id = $2
            `,
            [gStars, clientId]
          );
          if (sres.rowCount) clientsSentimentUpdated++;
        }
      }

      // Mark this Google review as linked (scope by business to be safe)
      const lres = await client.query(
        `
        UPDATE public.google_reviews
        SET linked = TRUE, updated_at = NOW()
        WHERE id = $1 AND business_id = $2 AND linked = FALSE
        `,
        [gId, businessId]
      );
      if (lres.rowCount) googleLinked++;
    }

    await client.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        businessId,
        matched,
        updatedExisting,
        inserted,
        clientsSentimentUpdated,
        googleLinked,
      },
      { status: 200 }
    );
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[/api/clients/sync-with-google-reviews] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  } finally {
    client.release();
  }
}
