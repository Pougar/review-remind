// app/api/analytics/make-excerpts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { auth } from "@/app/lib/auth";

/* ============================================================
   PG Pool (singleton across HMR)
   ============================================================ */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolMakeExcerpts: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPoolMakeExcerpts) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolMakeExcerpts = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolMakeExcerpts;
}

/* ============================================================
   Helpers / Types
   ============================================================ */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReqBody = { businessId?: string };

const isUUID = (v?: string | null) =>
  !!v && /^[0-9a-fA-F-]{36}$/.test(v || "");

function truncate(s: string, max = 600): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * InputItem = review text we feed to Gemini
 * - source "reviews": came from our internal reviews table
 * - source "google_reviews": came from google_reviews table and is not linked to an internal review
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
  phrase: string;
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
    const { businessId } = (await req.json().catch(() => ({}))) as ReqBody;
    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "MISSING_OR_INVALID_BUSINESS_ID" },
        { status: 400 }
      );
    }

    // RLS user
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Sign in required." },
        { status: 401 }
      );
    }

    db = await pool.connect();

    // Start tx and set RLS context
    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // ----- 1. Load phrases for this business
    // Only consider active phrases (not soft-deleted)
    // We use these phrases to ask Gemini for excerpts.
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
        p.counts DESC NULLS LAST,
        p.id DESC
      LIMIT 20
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

    // Map lower(phrase) -> { id, phrase }
    const phraseMap = new Map<
      string,
      { id: string; phrase: string }
    >();
    const phraseList = phrasesQ.rows.map((p) => {
      phraseMap.set(p.phrase.toLowerCase(), {
        id: p.id,
        phrase: p.phrase,
      });
      return p.phrase;
    });

    // ----- 2. Collect review text for this business

    /**
     * Internal reviews:
     *  - Take rows from public.reviews
     *  - Must not be soft-deleted
     *  - Use r.review as the text (single canonical field in your schema)
     *
     * Google reviews:
     *  - Take rows from public.google_reviews
     *  - Must not be soft-deleted
     *  - EXCLUDE any google_reviews row that is already "claimed"
     *    by a public.reviews row via reviews.g_review_id = google_reviews.id
     *    (and that internal review isn't soft-deleted).
     *
     * That "claimed" logic means: internal reviews always take precedence.
     */

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

    // Unclaimed Google reviews
    // (we assume google_reviews has: id, business_id, review, stars, updated_at, created_at, deleted_at)
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

    // Merge + sort recency
    const inputsWithTs = [
      ...internalQ.rows.map((r) => ({
        id: r.id,
        source: "reviews" as const,
        is_unlinked_google: false,
        stars: r.stars,
        text: truncate(r.review ?? ""),
        ts: new Date(
          r.updated_at ?? r.created_at ?? "1970-01-01"
        ).getTime(),
      })),
      ...googleQ.rows.map((g) => ({
        id: g.id,
        source: "google_reviews" as const,
        is_unlinked_google: true,
        stars: g.stars,
        text: truncate(g.review ?? ""),
        ts: new Date(
          g.updated_at ?? g.created_at ?? "1970-01-01"
        ).getTime(),
      })),
    ].filter((row) => row.text.length > 0);

    const inputs: InputItem[] = inputsWithTs
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 100)
      .map(({ ts, ...rest }) => rest);

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

    // Track which review IDs are valid and what type they are.
    // We'll use this to validate Gemini output.
    const allowedReviewIds = new Set(
      inputs
        .filter((i) => i.source === "reviews")
        .map((i) => i.id)
    );
    const allowedGoogleIds = new Set(
      inputs
        .filter((i) => i.source === "google_reviews")
        .map((i) => i.id)
    );

    // ----- 3. Build Gemini prompt

    const modelInput = {
      business_id: businessId,
      phrases: phraseList, // phrases we already have in DB
      reviews: inputs.map((i) => ({
        id: i.id,
        source: i.source,
        is_unlinked_google: i.is_unlinked_google,
        stars: i.stars,
        text: i.text,
      })),
    };

    const instructions = `
Task: For each provided phrase, return 3–6 short excerpts (≈1 sentence) directly pulled from the reviews where that phrase is clearly mentioned.

Rules:
- ONLY use the phrases provided in "phrases" (do not invent new phrases).
- Each excerpt object MUST include:
  - "excerpt": short snippet of review text (no PII, keep it ~1 sentence).
  - "sentiment": "good" | "bad".
    - "good" means positive feedback, praise, something we'd proudly show.
    - "bad" means a complaint, pain point, or clearly negative experience.
  - "review_id": MUST match an "id" from the provided reviews list.
  - "is_unlinked_google": true iff that review came from source "google_reviews".
- If sentiment is ambiguous, skip that excerpt.
- Use star ratings as a hint (5★ is rarely "bad"; ≤2★ is rarely "good").
- Output MUST be valid JSON. No markdown fences.

STRICT OUTPUT SHAPE:
{
  "phrases": [
    {
      "phrase": "<MUST MATCH one of the provided phrases exactly>",
      "excerpts": [
        {
          "excerpt": "<short sentence excerpt>",
          "sentiment": "good" | "bad",
          "review_id": "<id from input.reviews[i].id>",
          "is_unlinked_google": true | false
        }
      ]
    }
  ]
}
    `.trim();

    const prompt = `
You are extracting example excerpts for marketing / QA dashboards.

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
      return start !== -1 && end !== -1
        ? raw.slice(start, end + 1)
        : raw;
    })();

    let parsed: GeminiOutput;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "MODEL_PARSE_ERROR",
          raw: raw.slice(0, 2000),
        },
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

    // ----- 6. Sanitize Gemini output
    //
    // We'll:
    // - ignore any phrase we didn't give it
    // - limit to 6 excerpts per phrase
    // - validate review_id against allowed sets
    // - clip excerpt length to ~350 chars so we don't bloat DB
    //
    // After this step we have cleanGroups = [
    //   { phrase_id, phrase, excerpts: [{ excerpt, sentiment, review_id, is_unlinked_google }, ...] }
    // ]
    //
    const cleanGroups: {
      phrase_id: string;
      phrase: string;
      excerpts: {
        excerpt: string;
        sentiment: "good" | "bad";
        review_id: string;
        is_unlinked_google: boolean;
      }[];
    }[] = [];

    for (const group of parsed.phrases) {
      const phraseRaw = String(group?.phrase ?? "")
        .trim()
        .slice(0, 120);
      if (!phraseRaw) continue;

      // match to an existing phrase for this business
      const match = phraseMap.get(phraseRaw.toLowerCase());
      if (!match) continue;

      // normalize excerpts
      const normalized =
        Array.isArray(group.excerpts) ? group.excerpts : [];

      const cleanedForPhrase: {
        excerpt: string;
        sentiment: "good" | "bad";
        review_id: string;
        is_unlinked_google: boolean;
      }[] = [];

      for (const ex of normalized.slice(0, 6)) {
        const rid = String(ex?.review_id ?? "").trim();
        if (!rid) continue;

        const fromGoogle = !!ex?.is_unlinked_google;

        // Validate review_id against what we loaded
        if (fromGoogle) {
          if (!allowedGoogleIds.has(rid)) continue;
        } else {
          if (!allowedReviewIds.has(rid)) continue;
        }

        const sentiment: "good" | "bad" =
          ex?.sentiment === "bad" ? "bad" : "good";

        const excerptText = String(ex?.excerpt ?? "")
          .trim()
          .slice(0, 350);
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
          phrase_id: match.id,
          phrase: match.phrase,
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

    // ----- 7. Persist excerpts
    //
    // For each phrase:
    //   - wipe existing excerpts for that phrase (hard delete is fine here)
    //   - insert fresh excerpts
    //
    // Then recompute good_count / bad_count for those phrases in `public.phrases`.
    //
    // NOTE: Your schema for `public.excerpts`:
    //   id uuid PK DEFAULT gen_random_uuid(),
    //   business_id uuid NOT NULL,
    //   phrase_id uuid,
    //   happy boolean,
    //   excerpt text,
    //   review_id uuid,
    //   g_review_id uuid,
    //   linked boolean NOT NULL DEFAULT false,
    //   created_by text REFERENCES public.myusers(betterauth_id),
    //   created_at timestamptz DEFAULT now(),
    //   updated_at timestamptz DEFAULT now(),
    //   deleted_at timestamptz
    //
    // We'll:
    //   happy = sentiment === "good"
    //   if is_unlinked_google === true -> goes in g_review_id, NOT review_id
    //   else -> goes in review_id, NOT g_review_id
    //   linked stays false
    //   created_by = userId

    let phrasesTouched = 0;
    let insertedExcerpts = 0;

    for (const group of cleanGroups) {
      // delete old excerpts for this phrase (hard delete);
      // if you prefer soft-delete, change this to an UPDATE setting deleted_at.
      await db.query(
        `DELETE FROM public.excerpts WHERE phrase_id = $1`,
        [group.phrase_id]
      );

      // insert new excerpts
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
          [
            businessId,
            group.phrase_id,
            happy,
            ex.excerpt,
            reviewId,
            gReviewId,
            userId,
          ]
        );

        insertedExcerpts++;
      }

      phrasesTouched++;
    }

    // recompute good_count / bad_count in phrases for just the affected phrases
    const affectedPhraseIds = cleanGroups.map((g) => g.phrase_id);

    await db.query(
      `
      WITH sums AS (
        SELECT
          phrase_id,
          SUM(CASE WHEN e.happy IS TRUE  THEN 1 ELSE 0 END)::int AS good_count,
          SUM(CASE WHEN e.happy IS FALSE THEN 1 ELSE 0 END)::int AS bad_count
        FROM public.excerpts e
        WHERE e.phrase_id = ANY($1)
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

    // ----- 8. Respond with summary
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
  } catch (err: any) {
    // attempt rollback if tx started
    try {
      if (db) {
        await db.query("ROLLBACK");
      }
    } catch {
      /* ignore rollback error */
    }

    console.error(
      "[/api/analytics/make-excerpts] error:",
      err?.stack || err
    );

    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("row-level security")) {
      return NextResponse.json(
        {
          error:
            "Permission denied by row-level security. Check RLS for excerpts/phrases/reviews/google_reviews.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "SERVER_ERROR" },
      { status: 500 }
    );
  } finally {
    if (db) {
      db.release();
    }
  }
}
