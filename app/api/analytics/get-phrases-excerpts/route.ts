import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   PG Pool singleton (no eslint-disable, no `var`)
============================================================ */
const globalForPg = globalThis as unknown as { _pgPoolPhrasesExcerpts?: Pool };

function getPool(): Pool {
  if (!globalForPg._pgPoolPhrasesExcerpts) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolPhrasesExcerpts = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: true }, // set to false only if local/neon certs not configured
      max: 5,
    });
  }
  return globalForPg._pgPoolPhrasesExcerpts;
}

/* ============================================================
   Helpers / Types
============================================================ */
type ReqBody = {
  userId?: string;
  businessId?: string;
  businessSlug?: string;
  limit?: number; // number of phrases to return
  minCount?: number; // min counts threshold for phrases
};

type IdRow = { id: string };

type PhraseRow = {
  phrase_id: string;
  phrase: string;
  counts: number | string;
  sentiment: "good" | "bad" | null;
  created_at: string | null;
  updated_at: string | null;
  good_count: number | string | null;
  bad_count: number | string | null;
};

type ExcerptRow = {
  phrase_id: string;
  excerpt_id: string;
  excerpt: string | null;
  review_id: string | null;
  g_review_id: string | null;
  updated_at: string | null;
};

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

// Safe JSON reader
async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

/* ============================================================
   Route
============================================================ */

export async function POST(req: NextRequest) {
  let client: PoolClient | null = null;

  try {
    const body = await readJson<ReqBody>(req);

    // ----- Resolve user (explicit or from session)
    let userId = (body?.userId ?? "").trim();
    if (!isNonEmpty(userId)) {
      const sess = await auth.api.getSession({ headers: req.headers }).catch(() => null);
      userId = sess?.user?.id ?? "";
    }
    if (!isNonEmpty(userId)) {
      return NextResponse.json(
        { success: false, error: "MISSING_USER_ID" },
        { status: 401 }
      );
    }

    const businessIdIn = (body?.businessId ?? "").trim();
    const businessSlugIn = (body?.businessSlug ?? "").trim();

    const limit =
      Number.isFinite(body?.limit) && (body?.limit ?? 0) > 0
        ? Math.min(body!.limit!, 50)
        : 12;

    const minCount =
      Number.isFinite(body?.minCount) && (body?.minCount ?? 0) >= 0
        ? body!.minCount!
        : 0;

    const pool = getPool();
    client = await pool.connect();

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // ----- Resolve business id under RLS
    let businessId: string | null = null;

    if (isNonEmpty(businessIdIn)) {
      const q = await client.query<IdRow>(
        `
        SELECT id
        FROM public.businesses
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [businessIdIn]
      );
      businessId = q.rows[0]?.id ?? null;
    } else if (isNonEmpty(businessSlugIn)) {
      const q = await client.query<IdRow>(
        `
        SELECT id
        FROM public.businesses
        WHERE slug = $1
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [businessSlugIn]
      );
      businessId = q.rows[0]?.id ?? null;
    }

    if (!businessId) {
      await client.query("COMMIT");
      return NextResponse.json(
        {
          success: false,
          error: "NOT_FOUND",
          message: "Business not found or not accessible.",
        },
        { status: 404 }
      );
    }

    // ----- 1) Top phrases for this business
    const phrasesQ = await client.query<PhraseRow>(
      `
      SELECT
        p.id::text                           AS phrase_id,
        p.phrase::text                       AS phrase,
        COALESCE(p.counts, 0)::int           AS counts,
        NULLIF(p.sentiment::text, '')::text  AS sentiment,
        p.created_at::timestamptz            AS created_at,
        p.updated_at::timestamptz            AS updated_at,
        COALESCE(p.good_count, 0)::int       AS good_count,
        COALESCE(p.bad_count, 0)::int        AS bad_count
      FROM public.phrases p
      WHERE p.business_id = $1
        AND p.deleted_at IS NULL
        AND COALESCE(p.counts, 0) >= $2
      ORDER BY
        COALESCE(p.counts, 0) DESC,
        p.phrase ASC
      LIMIT $3
      `,
      [businessId, minCount, limit]
    );

    const phrases = phrasesQ.rows.map((r) => ({
      phraseId: r.phrase_id,
      phrase: r.phrase,
      counts: Number(r.counts) || 0,
      sentiment: (r.sentiment === "bad" ? "bad" : "good") as "good" | "bad",
      created_at: r.created_at,
      updated_at: r.updated_at,
      good_count: Number(r.good_count) || 0,
      bad_count: Number(r.bad_count) || 0,
    }));

    if (phrases.length === 0) {
      await client.query("COMMIT");
      return NextResponse.json(
        {
          success: true,
          businessId,
          phrases: [],
          message: "No phrases found.",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    const phraseIds = phrases.map((p) => p.phraseId);

    // ----- 2) Excerpts for those phrases
    const excerptsQ = await client.query<ExcerptRow>(
      `
      SELECT
        e.phrase_id::text          AS phrase_id,
        e.id::text                 AS excerpt_id,
        e.excerpt::text            AS excerpt,
        e.review_id::text          AS review_id,
        e.g_review_id::text        AS g_review_id,
        e.updated_at::timestamptz  AS updated_at
      FROM public.excerpts e
      WHERE e.business_id = $1
        AND e.deleted_at IS NULL
        AND e.phrase_id::text = ANY($2::text[])
      ORDER BY e.updated_at DESC NULLS LAST
      LIMIT 500
      `,
      [businessId, phraseIds]
    );

    // Group excerpts by phrase_id
    const byPhrase = new Map<
      string,
      Array<{
        excerptId: string;
        excerpt: string;
        reviewId: string | null;
        gReviewId: string | null;
        source: "internal" | "google" | null;
        updatedAt: string | null;
      }>
    >();

    for (const r of excerptsQ.rows) {
      let source: "internal" | "google" | null = null;
      if (r.review_id) source = "internal";
      else if (r.g_review_id) source = "google";

      const list = byPhrase.get(r.phrase_id) ?? [];
      list.push({
        excerptId: r.excerpt_id,
        excerpt: r.excerpt ?? "",
        reviewId: r.review_id,
        gReviewId: r.g_review_id,
        source,
        updatedAt: r.updated_at,
      });
      byPhrase.set(r.phrase_id, list);
    }

    // ----- 3) Final payload (phrases + nested excerpts)
    const payload = {
      success: true as const,
      businessId,
      phrases: phrases.map((p) => ({
        phrase_id: p.phraseId,
        phrase: p.phrase,
        counts: p.counts,
        sentiment: p.sentiment,
        created_at: p.created_at ?? p.updated_at ?? null,
        good_count: p.good_count,
        bad_count: p.bad_count,
        excerpts: byPhrase.get(p.phraseId) ?? [],
      })),
    };

    await client.query("COMMIT");
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[/api/analytics/get-phrases-excerpts] error:", msg);
    return NextResponse.json(
      { success: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
