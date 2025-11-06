// app/api/analytics/get-phrases-excerpts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolPhrases: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPoolPhrases) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolPhrases = new Pool({
      connectionString: cs,
      // Set to true if your Neon setup has proper certs. Keeping false to match your other routes.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolPhrases;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sentiment = "good" | "bad";

type PhraseRow = {
  id: string;
  phrase: string;
  total_count: number;
  is_bad_dominant: boolean;
  phrase_sentiment: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ExcerptRow = {
  id: string;
  phrase_id: string;
  happy: boolean | null;
  excerpt: string;
  review_id: string | null;
  g_review_id: string | null;
  created_at: string | null;
};

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

export async function POST(req: NextRequest) {
  const pool = getPool();
  const db = await pool.connect();

  try {
    const body = (await req.json().catch(() => ({}))) as { businessId?: string };
    const businessId = body?.businessId?.trim();
    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid businessId is required." },
        { status: 400 }
      );
    }

    // Auth → RLS
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // 1) Get candidate phrases for this business, order by total mentions
    const phrasesRes = await db.query<PhraseRow>(
      `
      SELECT
        p.id,
        p.phrase,
        COALESCE(p.counts, 0)                AS total_count,
        COALESCE(p.sentiment = 'bad', false) AS is_bad_dominant,
        p.sentiment::text                    AS phrase_sentiment,
        p.created_at,
        p.updated_at
      FROM public.phrases p
      WHERE p.business_id = $1
      ORDER BY COALESCE(p.counts, 0) DESC,
               p.updated_at DESC NULLS LAST,
               p.id DESC
      LIMIT 50
      `,
      [businessId]
    );

    let candidates = phrasesRes.rows || [];
    if (candidates.length === 0) {
      await db.query("COMMIT");
      return NextResponse.json(
        { success: true, businessId, count: 0, phrases: [] },
        { status: 200 }
      );
    }

    // 2) Pick top N; ensure at least one “bad” if available
    const TOP_N = 50;
    let chosen = candidates.slice(0, TOP_N);

    const hasBadDominant = chosen.some((p) => p.is_bad_dominant);
    if (!hasBadDominant) {
      const extraBad = candidates.find(
        (p) => p.is_bad_dominant && !chosen.some((c) => c.id === p.id)
      );
      if (extraBad) {
        const sortedAsc = [...chosen].sort((a, b) => a.total_count - b.total_count);
        const toDrop = sortedAsc[0];
        chosen = chosen.filter((p) => p.id !== toDrop.id);
        chosen.push(extraBad);
      }
    }

    // Keep deterministic order by total_count DESC
    chosen.sort((a, b) => b.total_count - a.total_count);

    const phraseIds = chosen.map((p) => p.id);

    // 3) Fetch excerpts for the chosen phrases, scoped by business via EXISTS
    const exRes = await db.query<ExcerptRow>(
      `
      SELECT
        e.id,
        e.phrase_id,
        e.happy,
        e.excerpt,
        e.review_id,
        e.g_review_id,
        e.created_at
      FROM public.excerpts e
      WHERE e.phrase_id = ANY($2)
        AND EXISTS (
          SELECT 1
          FROM public.phrases p2
          WHERE p2.id = e.phrase_id
            AND p2.business_id = $1
        )
      ORDER BY e.created_at DESC NULLS LAST, e.id DESC
      `,
      [businessId, phraseIds]
    );

    await db.query("COMMIT");

    // 4) Group excerpts and build payload
    const byPhrase = new Map<string, ExcerptRow[]>();
    for (const e of exRes.rows) {
      if (!byPhrase.has(e.phrase_id)) byPhrase.set(e.phrase_id, []);
      byPhrase.get(e.phrase_id)!.push(e);
    }

    const payload = chosen.map((p) => {
      const ex = byPhrase.get(p.id) || [];
      const excerpts = ex.map((row) => ({
        excerpt_id: row.id,
        excerpt: row.excerpt,
        sentiment: row.happy === true ? ("good" as Sentiment) : ("bad" as Sentiment),
        review_id: row.review_id,
        g_review_id: row.g_review_id,
        is_unlinked_google: row.g_review_id !== null,
        created_at: row.created_at,
      }));

      // Normalize phrase sentiment to "good" | "bad"
      const normalizedSentiment: Sentiment = p.phrase_sentiment === "bad" ? "bad" : "good";

      return {
        phrase_id: p.id,
        phrase: p.phrase,
        sentiment: normalizedSentiment,
        total_count: p.total_count,
        created_at: p.created_at,
        excerpts,
      };
    });

    return NextResponse.json(
      { success: true, businessId, count: payload.length, phrases: payload },
      { status: 200 }
    );
  } catch (err: any) {
    try { await db.query("ROLLBACK"); } catch {}
    console.error("[/api/analytics/get-phrases-excerpts] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  } finally {
    db.release();
  }
}
