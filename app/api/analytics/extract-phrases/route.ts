// app/api/analytics/extract-phrases/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   PG Pool singleton
   ============================================================ */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolExtractPhrases: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolExtractPhrases) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolExtractPhrases = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolExtractPhrases;
}

/* ============================================================
   Helpers
   ============================================================ */
const isUUID = (v?: string | null) =>
  !!v && /^[0-9a-fA-F-]{36}$/.test(v);

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { success: false, error: "INVALID_INPUT", message, ...extra },
    { status: 400 }
  );
}

function serverError(message = "Phrase extraction failed.") {
  return NextResponse.json(
    { success: false, error: "SERVER_ERROR", message },
    { status: 500 }
  );
}

// keep tokens under control for Gemini
function truncate(s: string, max = 600): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max);
}

/* ============================================================
   Types
   ============================================================ */
type ReviewRow = {
  id: string;
  stars: number | null;
  updated_at: string | null;
  review: string | null;
  happy: boolean | null;
  source: "internal" | "google";
};

type GeminiReviewInput = {
  id: string;
  source: "internal" | "google";
  stars: number | null;
  happy: boolean | null;
  text: string;
};

type GeminiPhraseOnly = {
  phrase: string;
  mention_count?: number;
  sentiment?: "good" | "bad"; // we'll ask Gemini to classify
};

type GeminiOutput = {
  phrases: GeminiPhraseOnly[];
};

/* ============================================================
   Route
   ============================================================ */

export async function POST(req: NextRequest) {
  // 1. Auth gate
  const session = await auth.api.getSession({ headers: req.headers });
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "UNAUTHENTICATED", message: "Sign in required." },
      { status: 401 }
    );
  }

  // 2. Input
  const body = (await req.json().catch(() => ({}))) as {
    businessId?: string;
  };
  const businessId = (body.businessId || "").trim();
  if (!isUUID(businessId)) {
    return badRequest("Valid businessId is required.", {
      field: "businessId",
    });
  }

  const pool = getPool();
  let db: PoolClient | null = null;

  try {
    db = await pool.connect();

    // Attach BetterAuth user to connection for RLS
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    /**
     * 3. Gather reviews for this business.
     *
     * internal reviews:
     *   public.reviews r
     *   - not soft-deleted
     *
     * google reviews:
     *   public.google_reviews gr
     *   - not soft-deleted
     *   - only include if there's no internal review rr
     *     pointing at that google review via rr.g_review_id (and rr not deleted)
     */
    const reviewsQ = await db.query<ReviewRow>(
      `
      (
        SELECT
          r.id::text        AS id,
          r.stars::float8   AS stars,
          r.updated_at      AS updated_at,
          r.review          AS review,
          r.happy           AS happy,
          'internal'::text  AS source
        FROM public.reviews r
        WHERE r.business_id = $1::uuid
      )

      UNION ALL

      (
        SELECT
          gr.id::text       AS id,
          gr.stars::float8  AS stars,
          gr.updated_at     AS updated_at,
          gr.review         AS review,
          NULL::boolean     AS happy,
          'google'::text    AS source
        FROM public.google_reviews gr
        WHERE gr.business_id = $1::uuid
          AND NOT EXISTS (
            SELECT 1
            FROM public.reviews rr
            WHERE rr.g_review_id = gr.id
          )
      )

      ORDER BY updated_at DESC NULLS LAST
      LIMIT 200;
      `,
      [businessId]
    );

    const allReviews: ReviewRow[] = reviewsQ.rows ?? [];

    if (!allReviews.length) {
      return NextResponse.json(
        {
          success: true,
          businessId,
          input_count: 0,
          suggested_count: 0,
          existing_skipped: 0,
          new_phrases: [],
          message: "No reviews found to analyze.",
        },
        { status: 200 }
      );
    }

    /**
     * 4. Prepare payload for Gemini
     */
    const geminiInput: GeminiReviewInput[] = allReviews
      .slice(0, 100)
      .map((row) => ({
        id: row.id,
        source: row.source,
        stars: row.stars,
        happy: row.happy,
        text: truncate(row.review ?? "", 600),
      }))
      .filter((r) => r.text.length > 0);

    if (!geminiInput.length) {
      return NextResponse.json(
        {
          success: true,
          businessId,
          input_count: 0,
          suggested_count: 0,
          existing_skipped: 0,
          new_phrases: [],
          message: "No usable review text found.",
        },
        { status: 200 }
      );
    }

    /**
     * 5. Ask Gemini for ~10 short “themes”/phrases.
     *    We ALSO ask Gemini to classify sentiment:
     *    - "good" (something you'd want to advertise to happy customers)
     *    - "bad" (a complaint / pain point)
     *
     * We force strict JSON.
     */
    const instructions = `
Task: From the provided reviews, extract about 10 short, human-readable phrases that customers repeatedly mention.

Requirements:
- Each phrase should be a concise theme like "friendly staff", "long wait time", "clear pricing", "great communication".
- Include both praise and complaints.
- For each phrase:
  - "mention_count": integer approx how many times that topic appears across all reviews (case-insensitive).
  - "sentiment": "good" if it's generally positive / brag-worthy, "bad" if it's generally negative / complaint / needs improvement.
- DO NOT include direct quotes from customers or PII.
- DO NOT include extremely generic words like "service" alone with no qualifier.
- Output MUST be valid JSON, no markdown fences.

STRICT OUTPUT SHAPE:
{
  "phrases": [
    { "phrase": "<short phrase>", "mention_count": 7, "sentiment": "good" }
  ]
}
    `.trim();

    const modelInput = {
      business_id: businessId,
      reviews: geminiInput,
    };

    const prompt = `
You are extracting recurring themes from customer reviews.

INPUT:
${JSON.stringify(modelInput, null, 2)}

GUIDANCE:
${instructions}
`.trim();

    const result = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
      temperature: 0.2,
    });

    // Parse Gemini JSON safely
    const raw = result.text.trim();
    const jsonStr = (() => {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      return start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw;
    })();

    let parsed: GeminiOutput;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "MODEL_PARSE_ERROR",
          raw: raw.slice(0, 2000),
        },
        { status: 502 }
      );
    }

    if (!parsed || !Array.isArray(parsed.phrases)) {
      return NextResponse.json(
        {
          success: false,
          error: "BAD_MODEL_SHAPE",
        },
        { status: 502 }
      );
    }

    /**
     * 6. Clean/dedupe Gemini output.
     *    We'll keep the highest mention_count we saw per lowercased phrase.
     *    We'll carry sentiment through if provided, default to "good".
     */
    const merged = new Map<
      string,
      { phrase: string; counts: number; sentiment: "good" | "bad" }
    >();

    for (const p of parsed.phrases.slice(0, 14)) {
      const phrase = String(p?.phrase ?? "")
        .trim()
        .slice(0, 120);
      if (!phrase) continue;

      // mention_count → counts
      let counts = Number.isFinite(p?.mention_count)
        ? Number(p?.mention_count)
        : parseInt(String(p?.mention_count ?? ""), 10);
      if (!Number.isFinite(counts) || counts < 0) counts = 0;

      // classify sentiment
      const sentRaw = (p as any)?.sentiment;
      const sentiment: "good" | "bad" =
        sentRaw === "bad" ? "bad" : "good";

      const key = phrase.toLowerCase();
      const prev = merged.get(key);
      if (!prev || counts > prev.counts) {
        merged.set(key, { phrase, counts, sentiment });
      }
    }

    const deduped = Array.from(merged.values()); // [{ phrase, counts, sentiment }]

    // If Gemini somehow gave nothing usable
    if (!deduped.length) {
      return NextResponse.json(
        {
          success: true,
          businessId,
          input_count: geminiInput.length,
          suggested_count: 0,
          existing_skipped: 0,
          new_phrases: [],
          message: "No usable phrases found.",
          usage: result.usage ?? null,
        },
        { status: 200 }
      );
    }

    /**
     * 7. Filter out phrases we ALREADY have in DB for this business
     *    (case-insensitive). We're only *previewing* new candidates.
     *
     *    public.phrases:
     *      - business_id uuid
     *      - phrase text
     *      - counts int ...
     *
     *    NOTE: If you soft-delete phrases later, include `deleted_at IS NULL`
     *    in that WHERE. For now we assume active rows only.
     */
    const existingQ = await db.query<{ phrase_lower: string }>(
      `
      SELECT LOWER(p.phrase) AS phrase_lower
      FROM public.phrases p
      WHERE p.business_id = $1::uuid
      `,
      [businessId]
    );
    const existingSet = new Set(
      existingQ.rows.map((r) => r.phrase_lower.trim())
    );

    const filtered = deduped.filter(
      (x) => !existingSet.has(x.phrase.toLowerCase())
    );

    const suggested_count = deduped.length;
    const new_phrases = filtered.map((x) => ({
      phrase: x.phrase,
      counts: x.counts,
      sentiment: x.sentiment, // "good" | "bad"
    }));

    // 8. Return PREVIEW ONLY (no DB writes here)
    return NextResponse.json(
      {
        success: true,
        businessId,
        input_count: geminiInput.length,
        suggested_count,
        existing_skipped: suggested_count - new_phrases.length,
        new_phrases,
        usage: result.usage ?? null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error(
      "[/api/analytics/extract-phrases] error:",
      err?.stack || err
    );
    return serverError();
  } finally {
    if (db) {
      db.release();
    }
  }
}
