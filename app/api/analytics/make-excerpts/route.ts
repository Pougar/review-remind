// app/api/analytics/make-excerpts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { auth } from "@/app/lib/auth";

/* ============================================================
   Config
============================================================ */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   PG Pool (singleton across HMR)
============================================================ */
const globalForPg = globalThis as unknown as {
  _pgPoolMakeExcerpts?: Pool;
};

function getPool(): Pool {
  if (!globalForPg._pgPoolMakeExcerpts) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolMakeExcerpts = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolMakeExcerpts;
}

/* ============================================================
   Types & Helpers
============================================================ */

type ReqBody = { businessId?: string };

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

function truncate(s: string, max = 600): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max);
}

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

/**
 * InputItem = review text we feed to Gemini
 * - source "reviews": internal reviews table
 * - source "google_reviews": unlinked google_reviews rows
 */
type InputItem = {
  id: string;
  source: "reviews" | "google_reviews";
  is_unlinked_google: boolean;
  stars: number | null;
  text: string;
};

type GeminiExcerpt = {
  excerpt: string;
  sentiment: "good" | "bad";
  review_id: string;
  is_unlinked_google: boolean;
};

type GeminiPhraseGroup = {
  phrase_id: string; // MUST match one of the provided phrase IDs
  excerpts: GeminiExcerpt[];
};

type GeminiOutput = {
  phrases: GeminiPhraseGroup[];
};

/* ============================================================
   Route
============================================================ */

export async function POST(req: NextRequest) {
  const pool = getPool();
  let db: PoolClient | null = null;

  try {
    // ----- 0. Parse input and auth
    const body = await readJson<ReqBody>(req);
    const businessId = (body?.businessId ?? "").trim();
    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "MISSING_OR_INVALID_BUSINESS_ID" },
        { status: 400 }
      );
    }

    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Sign in required." },
        { status: 401 }
      );
    }

    db = await pool.connect();
    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // ----- 1. Load phrases for this business (these are the ONLY allowed anchors)
    const phrasesQ = await db.query<{
      id: string;
      phrase: string;
    }>(
      `
      SELECT p.id, p.phrase
      FROM public.phrases p
      WHERE p.business_id = $1::uuid
      ORDER BY
        p.updated_at DESC NULLS LAST,
        p.counts    DESC NULLS LAST,
        p.id        DESC
      LIMIT 50
      `,
      [businessId]
    );

    if (phrasesQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "NO_PHRASES",
          message:
            "Create or extract phrases first for this business before generating excerpts.",
        },
        { status: 400 }
      );
    }

    const phrases = phrasesQ.rows;
    const phraseIdSet = new Set(phrases.map((p) => p.id));

    // ----- 2. Collect review text for this business

    // Internal reviews
    const internalQ = await db.query<{
      id: string;
      stars: number | null;
      updated_at: string | null;
      created_at: string | null;
      review: string | null;
    }>(
      `
      SELECT
        r.id,
        r.stars::float8 AS stars,
        r.updated_at,
        r.created_at,
        NULLIF(BTRIM(r.review), '') AS review
      FROM public.reviews r
      WHERE r.business_id = $1::uuid
        AND NULLIF(BTRIM(r.review), '') IS NOT NULL
      `,
      [businessId]
    );

    // Unlinked Google reviews
    const googleQ = await db.query<{
      id: string;
      stars: number | null;
      updated_at: string | null;
      created_at: string | null;
      review: string | null;
    }>(
      `
      SELECT
        gr.id,
        gr.stars::float8 AS stars,
        gr.updated_at,
        gr.created_at,
        NULLIF(BTRIM(gr.review), '') AS review
      FROM public.google_reviews gr
      WHERE gr.business_id = $1::uuid
        AND NULLIF(BTRIM(gr.review), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.reviews rr
          WHERE rr.g_review_id = gr.id
        )
      `,
      [businessId]
    );

    const inputsWithTs = [
      ...internalQ.rows.map((r) => ({
        id: r.id,
        source: "reviews" as const,
        is_unlinked_google: false,
        stars: r.stars,
        text: truncate(r.review ?? ""),
        ts: new Date(r.updated_at ?? r.created_at ?? "1970-01-01").getTime(),
      })),
      ...googleQ.rows.map((g) => ({
        id: g.id,
        source: "google_reviews" as const,
        is_unlinked_google: true,
        stars: g.stars,
        text: truncate(g.review ?? ""),
        ts: new Date(g.updated_at ?? g.created_at ?? "1970-01-01").getTime(),
      })),
    ].filter((row) => row.text.length > 0);

    const inputs: InputItem[] = inputsWithTs
      .sort((a, b) => b.ts - a.ts)
      .map((o) => ({
        id: o.id,
        source: o.source,
        is_unlinked_google: o.is_unlinked_google,
        stars: o.stars,
        text: o.text,
      }));

    if (!inputs.length) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          success: true,
          message:
            "No usable reviews found for this business to generate excerpts.",
          phrases: [],
        },
        { status: 200 }
      );
    }

    // Allowed review IDs for validation
    const allowedReviewIds = new Set(
      inputs.filter((i) => i.source === "reviews").map((i) => i.id)
    );
    const allowedGoogleIds = new Set(
      inputs.filter((i) => i.source === "google_reviews").map((i) => i.id)
    );

    /* ============================================================
       3. Build Gemini prompt (phrase_id-based, exhaustive excerpts)
    ============================================================ */

    const modelInput = {
      business_id: businessId,
      phrases: phrases.map((p) => ({
        id: p.id,
        phrase: p.phrase,
      })),
      reviews: inputs.map((i) => ({
        id: i.id,
        source: i.source,
        is_unlinked_google: i.is_unlinked_google,
        stars: i.stars,
        text: i.text,
      })),
    };

    const instructions = `
Task:
You are given:
- A list of phrases, each with a stable "id" and "phrase" text.
- A list of reviews (some internal, some Google, all pre-filtered).

For EACH phrase:
1. Use BOTH the phrase text AND the reviews to determine where that phrase (or a clear close variant) is actually expressed.
2. Determine the phrase's DOMINANT sentiment ("good" or "bad") based on ALL relevant, unambiguous mentions:
   - Use text semantics plus star rating hints (5★ usually good; 1–2★ usually bad; 3★ neutral).
   - If clearly more positive mentions → dominant = "good".
   - If clearly more negative mentions → dominant = "bad".
   - If tied or ambiguous, prefer "good".
3. For that phrase, return an excerpt for EVERY CLEAR MENTION you can reliably detect:
   - Do NOT arbitrarily cap the number of excerpts.
   - If there are N distinct mentions across the provided reviews, aim to return N excerpts (or as many as clearly identifiable).
   - Multiple excerpts from the same review are allowed if they reflect distinct mentions.
   - Excerpts must:
     - Be short (about one sentence).
     - Be a VERBATIM substring of the corresponding review text.
     - Contain NO PII.
     - Match the phrase's DOMINANT sentiment. If an excerpt is neutral/ambiguous, skip it.

Hard constraints:
- You MUST use the provided phrase "id" to link excerpts.
- DO NOT invent new phrase IDs.
- DO NOT include phrases that are not in the "phrases" list.
- For each returned phrase group:
  - "phrase_id" MUST be one of the input phrase IDs.
  - Every excerpt's "review_id" MUST be one of the provided reviews' IDs.
  - "is_unlinked_google" MUST be true if and only if that review's source is "google_reviews".
  - "sentiment" MUST be exactly the dominant sentiment for that phrase ("good" or "bad").
- If a phrase has no clear mentions, return it either with an empty "excerpts" array or omit it.

STRICT OUTPUT SHAPE (no markdown fences, exactly this JSON structure):
{
  "phrases": [
    {
      "phrase_id": "<id from input.phrases>",
      "excerpts": [
        {
          "excerpt": "<short verbatim snippet>",
          "sentiment": "good" | "bad",
          "review_id": "<id from input.reviews>",
          "is_unlinked_google": true | false
        }
      ]
    }
  ]
}
    `.trim();

    const prompt = `
You are generating tightly-linked excerpts for analytics dashboards.

INPUT:
${JSON.stringify(modelInput, null, 2)}

GUIDANCE:
${instructions}
`.trim();

    // ----- 4. Call Gemini
    const result = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
      temperature: 0.2,
    });

    // ----- 5. Parse Gemini output into JSON safely
    const raw = result.text.trim();
    const jsonStr = (() => {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      return start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw;
    })();

    let parsed: GeminiOutput;
    try {
      parsed = JSON.parse(jsonStr) as unknown as GeminiOutput;
    } catch {
      await db.query("ROLLBACK");
      return NextResponse.json(
        { error: "MODEL_PARSE_ERROR", raw: raw.slice(0, 2000) },
        { status: 502 }
      );
    }

    if (!parsed || !Array.isArray(parsed.phrases)) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        { error: "BAD_MODEL_SHAPE" },
        { status: 502 }
      );
    }

    /* ============================================================
       6. Validate & normalize (phrase_id-based, no text matching)
    ============================================================ */

    const cleanGroups: {
      phrase_id: string;
      excerpts: {
        excerpt: string;
        sentiment: "good" | "bad";
        review_id: string;
        is_unlinked_google: boolean;
      }[];
    }[] = [];

    for (const group of parsed.phrases) {
      const phraseId = String(group?.phrase_id ?? "").trim();
      if (!phraseId || !phraseIdSet.has(phraseId)) continue;

      const normalizedExcerpts = Array.isArray(group.excerpts)
        ? group.excerpts
        : [];

      const cleanedForPhrase: {
        excerpt: string;
        sentiment: "good" | "bad";
        review_id: string;
        is_unlinked_google: boolean;
      }[] = [];

      for (const ex of normalizedExcerpts) {
        const rid = String(ex?.review_id ?? "").trim();
        if (!rid) continue;

        const fromGoogle = !!ex?.is_unlinked_google;
        if (fromGoogle) {
          if (!allowedGoogleIds.has(rid)) continue;
        } else {
          if (!allowedReviewIds.has(rid)) continue;
        }

        const sentiment: "good" | "bad" =
          ex?.sentiment === "bad" ? "bad" : "good";

        const excerptText = String(ex?.excerpt ?? "").trim().slice(0, 350);
        if (!excerptText) continue;

        cleanedForPhrase.push({
          excerpt: excerptText,
          sentiment,
          review_id: rid,
          is_unlinked_google: fromGoogle,
        });
      }

      if (cleanedForPhrase.length > 0) {
        cleanGroups.push({
          phrase_id: phraseId,
          excerpts: cleanedForPhrase,
        });
      }
    }

    if (!cleanGroups.length) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          success: true,
          message: "Model returned no usable excerpts.",
          phrases: [],
        },
        { status: 200 }
      );
    }

    /* ============================================================
       7. Persist excerpts (replace per phrase_id)
    ============================================================ */

    let phrasesTouched = 0;
    let insertedExcerpts = 0;

    for (const group of cleanGroups) {
      // Clear old excerpts for this phrase to avoid stale links
      await db.query(
        `DELETE FROM public.excerpts WHERE phrase_id = $1::uuid`,
        [group.phrase_id]
      );

      for (const ex of group.excerpts) {
        const happy = ex.sentiment === "good";
        const reviewId = ex.is_unlinked_google ? null : ex.review_id;
        const gReviewId = ex.is_unlinked_google ? ex.review_id : null;

        await db.query(
          `
          INSERT INTO public.excerpts (
            business_id,
            phrase_id,
            happy,
            excerpt,
            review_id,
            g_review_id,
            linked,
            created_by,
            created_at,
            updated_at
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            $3,
            $4,
            $5::uuid,
            $6::uuid,
            false,
            $7,
            NOW(),
            NOW()
          )
          `,
          [businessId, group.phrase_id, happy, ex.excerpt, reviewId, gReviewId, userId]
        );

        insertedExcerpts++;
      }

      phrasesTouched++;
    }

    // ----- 8. Recompute per-phrase good/bad counts
    const affectedPhraseIds = cleanGroups.map((g) => g.phrase_id);

    await db.query(
      `
      WITH sums AS (
        SELECT
          phrase_id,
          SUM(CASE WHEN e.happy IS TRUE  THEN 1 ELSE 0 END)::int AS good_count,
          SUM(CASE WHEN e.happy IS FALSE THEN 1 ELSE 0 END)::int AS bad_count
        FROM public.excerpts e
        WHERE e.phrase_id = ANY($1::uuid[])
        GROUP BY phrase_id
      )
      UPDATE public.phrases p
      SET good_count = COALESCE(s.good_count, 0),
          bad_count  = COALESCE(s.bad_count, 0),
          updated_at = NOW()
      FROM sums s
      WHERE p.id = s.phrase_id
      `,
      [affectedPhraseIds]
    );

    await db.query("COMMIT");

    // ----- 9. Respond
    return NextResponse.json(
      {
        success: true,
        businessId,
        input_count: inputs.length,
        phrases_updated: phrasesTouched,
        excerpts_inserted: insertedExcerpts,
        usage: result.usage ?? null,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    try {
      if (db) await db.query("ROLLBACK");
    } catch {
      // ignore rollback error
    }

    const msg =
      err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[/api/analytics/make-excerpts] error:", msg);

    const lower =
      (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (lower.includes("row-level security")) {
      return NextResponse.json(
        {
          error:
            "Permission denied by row-level security. Check RLS for excerpts/phrases/reviews/google_reviews.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
