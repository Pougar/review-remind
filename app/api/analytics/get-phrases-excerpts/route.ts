// app/api/analytics/get-phrases-excerpts/route.ts
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
      ssl: { rejectUnauthorized: true }, // set to false only if your Neon certs aren't configured
      max: 5,
    });
  }
  return globalForPg._pgPoolPhrasesExcerpts;
}

/* ============================================================
   Helpers
============================================================ */
type ReqBody = {
  userId?: string;
  businessId?: string;
  businessSlug?: string;
  limit?: number;     // number of phrases to return
  minCount?: number;  // min counts threshold for phrases
};

type IdRow = { id: string };

type PhraseRow = {
  phrase_id: string;
  phrase: string;
  counts: number | string;
  sentiment: "good" | "bad" | null;
};

type ExcerptRow = {
  phrase_id: string;
  excerpt_id: string;
  excerpt: string | null;
  review_id: string | null;
  source: "internal" | "google" | null;
  stars: number | string | null;
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
  // Parse input
  const body = await readJson<ReqBody>(req);

  // Prefer explicit userId; fallback to session (for RLS)
  let userId = (body?.userId ?? "").trim();
  if (!isNonEmpty(userId)) {
    const sess = await auth.api.getSession({ headers: req.headers }).catch(() => null);
    userId = sess?.user?.id ?? "";
  }
  if (!isNonEmpty(userId)) {
    return NextResponse.json({ success: false, error: "MISSING_USER_ID" }, { status: 401 });
  }

  const businessIdIn = (body?.businessId ?? "").trim();
  const businessSlugIn = (body?.businessSlug ?? "").trim();
  const limit = Number.isFinite(body?.limit) && (body?.limit ?? 0) > 0 ? Math.min(body!.limit!, 50) : 12;
  const minCount = Number.isFinite(body?.minCount) && (body?.minCount ?? 0) >= 0 ? body!.minCount! : 0;

  const pool = getPool();
  let client: PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

    // Resolve business id under RLS
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

    // 1) Top phrases for this business (respect optional minCount & limit)
    const phrasesQ = await client.query<PhraseRow>(
      `
      select
        p.id::text                          as phrase_id,
        p.phrase::text                      as phrase,
        coalesce(p.counts, 0)::int          as counts,
        nullif(p.sentiment::text, '')::text as sentiment
      from public.phrases p
      where p.business_id = $1
        and p.deleted_at is null
        and coalesce(p.counts, 0) >= $2
      order by coalesce(p.counts, 0) desc, p.phrase asc
      limit $3
      `,
      [businessId, minCount, limit]
    );

    const phrases = phrasesQ.rows.map((r) => ({
      phraseId: r.phrase_id,
      phrase: r.phrase,
      counts: Number(r.counts) || 0,
      sentiment: (r.sentiment === "bad" ? "bad" : "good") as "good" | "bad",
    }));

    if (phrases.length === 0) {
      await client.query("COMMIT");
      return NextResponse.json(
        { success: true, businessId, phrases: [], excerpts: [], message: "No phrases found." },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Use const (not let) — addresses prefer-const
    const candidates: string[] = phrases.map((p) => p.phraseId);

    // 2) Excerpts for those phrases (bounded)
    // If your schema differs, adjust columns accordingly.
    const excerptsQ = await client.query<ExcerptRow>(
      `
      select
        e.phrase_id::text                                    as phrase_id,
        e.id::text                                           as excerpt_id,
        e.text::text                                         as excerpt,
        e.review_id::text                                    as review_id,
        nullif(e.source::text, '')::text                     as source,
        e.stars::float8                                      as stars,
        e.updated_at::timestamptz                            as updated_at
      from public.excerpts e
      where e.business_id = $1
        and e.deleted_at is null
        and e.phrase_id::text = any($2::text[])
      order by e.updated_at desc nulls last
      limit 500
      `,
      [businessId, candidates]
    );

    // Group excerpts by phrase_id
    const byPhrase = new Map<string, Array<{
      excerptId: string;
      excerpt: string;
      reviewId: string | null;
      source: "internal" | "google" | null;
      stars: number | null;
      updatedAt: string | null;
    }>>();

    for (const r of excerptsQ.rows) {
      const list = byPhrase.get(r.phrase_id) ?? [];
      list.push({
        excerptId: r.excerpt_id,
        excerpt: r.excerpt ?? "",
        reviewId: r.review_id,
        source: r.source,
        stars: r.stars == null ? null : Number(r.stars),
        updatedAt: r.updated_at,
      });
      byPhrase.set(r.phrase_id, list);
    }

    // Shape final payload
    const payload = {
      success: true as const,
      businessId,
      phrases: phrases.map((p) => ({
        phraseId: p.phraseId,
        phrase: p.phrase,
        counts: p.counts,
        sentiment: p.sentiment, // "good" | "bad"
        excerpts: byPhrase.get(p.phraseId) ?? [],
      })),
    };

    await client.query("COMMIT");
    return NextResponse.json(payload, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[/api/analytics/get-phrases-excerpts] error:", msg);
    return NextResponse.json({ success: false, error: "SERVER_ERROR" }, { status: 500 });
  } finally {
    // release outside the try-catch where it's defined
    try {
      const pool = getPool();
      // no-op if not connected
    } catch {
      /* ignore */
    }
  }
}
