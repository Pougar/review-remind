// app/api/public/generate-good-reviews/route.ts
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { verifyMagicToken } from "@/app/lib/magic-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   PG Pool (singleton across HMR)
   ============================================================ */
declare global {
  var _pgPoolGenGoodReviewsPublic: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPoolGenGoodReviewsPublic) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolGenGoodReviewsPublic = new Pool({
      connectionString: cs,
      // Match the rest of your routes: Neon usually needs SSL
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolGenGoodReviewsPublic;
}

/* ============================================================
   Helpers
   ============================================================ */
function isUUID(v?: string | null) {
  return !!v && /^[0-9a-fA-F-]{36}$/.test(v);
}

// for error responses
function badRequest(message: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: "INVALID_INPUT", message, ...extra }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function forbidden(message: string) {
  return new Response(JSON.stringify({ error: "INVALID_TOKEN", message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

function serverError(message = "Failed to generate reviews.") {
  return new Response(JSON.stringify({ error: "SERVER_ERROR", message }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

// Split strings on common delimiters and normalise
function toStringArrayFlexible(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((s) => String(s));
  if (typeof input === "string") {
    return input
      .split(/[|,\n;\r]+/g)
      .map((s) => s.trim());
  }
  return [];
}

// Normalise invoice line items / services for grounding
function normaliseItems(input: unknown): string[] {
  const raw = toStringArrayFlexible(input);
  const trimmed = raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // de-dupe (case-insensitive, keep first spelling)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of trimmed) {
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }

  // cap count and per-item len for safety
  const MAX_ITEMS = 15;
  const MAX_LEN = 120;
  return deduped
    .slice(0, MAX_ITEMS)
    .map((s) => (s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s));
}

/* ============================================================
   Types
   ============================================================ */
type Body = {
  businessId?: string;   // required UUID
  clientId?: string;     // required UUID (or "test")
  token?: string;        // required unless clientId === "test"
  phrases?: string[];    // required (1..10)
};

type BizRow = {
  display_name: string | null;
  description: string | null;
};

type ClientRow = {
  item_description: string | null;
};

/* ============================================================
   Route
   ============================================================ */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const businessId = String(body?.businessId ?? "").trim();
  const clientId = String(body?.clientId ?? "").trim();
  const token = String(body?.token ?? "").trim();
  const phrasesRaw = Array.isArray(body?.phrases) ? body.phrases : [];

  // --- Basic validation ---
  if (!isUUID(businessId)) {
    return badRequest("Field 'businessId' must be a valid UUID.", {
      field: "businessId",
    });
  }
  if (!clientId) {
    return badRequest("Field 'clientId' is required.", {
      field: "clientId",
    });
  }
  if (clientId !== "test" && !isUUID(clientId)) {
    return badRequest("Field 'clientId' must be a valid UUID (or 'test').", {
      field: "clientId",
    });
  }

  // phrases 1..10 non-empty strings
  if (!phrasesRaw.length) {
    return badRequest("Field 'phrases' must have 1–10 items.", {
      field: "phrases",
    });
  }
  if (phrasesRaw.length > 10) {
    return badRequest("No more than 10 phrases allowed.", {
      field: "phrases",
    });
  }
  const phrases = phrasesRaw
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  if (!phrases.length) {
    return badRequest("All provided phrases were empty after trimming.", {
      field: "phrases",
    });
  }

  // --- Token validation (skip in tester mode) ---
  // Public endpoint, so we rely on the signed token you emailed out.
  // Anyone hitting this without a valid token shouldn't get to see business info.
  if (clientId !== "test") {
    if (!token) {
      return badRequest("Field 'token' is required.", {
        field: "token",
      });
    }
    const check = verifyMagicToken({
      token,
      businessId,
      clientId,
    });
    if (!check.ok) {
      return forbidden(check.error);
    }
  }

  const pool = getPool();

  // --- 1) Load business context
  // We no longer use myusers. We use businesses directly.
  // RLS NOTE:
  //  - Your RLS on businesses must allow SELECT
  //    for rows where id = provided businessId,
  //    if token is verified OR (clientId === "test").
  let businessDisplayName = "";
  let businessDescription = "";

  try {
    const bizQ = await pool.query<BizRow>(
      `
      SELECT
        display_name,
        description
      FROM public.businesses
      WHERE id = $1
      LIMIT 1
      `,
      [businessId]
    );

    if (bizQ.rowCount === 0) {
      return badRequest("BUSINESS_NOT_FOUND", { businessId });
    }

    businessDisplayName = (bizQ.rows[0].display_name || "").trim();
    businessDescription = (bizQ.rows[0].description || "").trim();

    if (!businessDisplayName) {
      return badRequest("DISPLAY_NAME_MISSING_FOR_BUSINESS", { businessId });
    }

    // keep description reasonable for the prompt
    if (businessDescription.length > 1200) {
      businessDescription = businessDescription.slice(0, 1200);
    }
  } catch (err) {
    console.error("[generate-good-reviews] business SELECT error:", err);
    return serverError("Could not fetch business context.");
  }

  // --- 2) Load client service line items, unless tester mode
  // RLS NOTE:
  //  - clients table must allow SELECT for this (businessId match + valid token).
  let itemDescriptions: string[] = [];
  if (clientId !== "test") {
    try {
      const clientQ = await pool.query<ClientRow>(
        `
        SELECT item_description
        FROM public.clients
        WHERE id = $1
          AND business_id = $2
        LIMIT 1
        `,
        [clientId, businessId]
      );

      if (clientQ.rowCount === 0) {
        return badRequest("CLIENT_NOT_FOUND", { clientId });
      }

      itemDescriptions = normaliseItems(
        clientQ.rows[0].item_description || ""
      );
    } catch (err) {
      console.error("[generate-good-reviews] client SELECT error:", err);
      return serverError("Could not fetch client context.");
    }
  } else {
    // tester mode: allow empty
    itemDescriptions = [];
  }

  // --- 3) Build LLM prompt
  const listBlock = phrases.map((p) => `- ${p}`).join("\n");

  const descBlock = businessDescription
    ? `
Business context (owner-provided — use naturally, don't copy verbatim):
"${businessDescription}"
`.trim()
    : "";

  const itemsBlock = itemDescriptions.length
    ? `
Items/services (from invoice):
${itemDescriptions.map((i) => `- ${i}`).join("\n")}
`.trim()
    : "";

  const prompt = `
You are writing realistic, positive Google reviews.

Business: "${businessDisplayName}"
${descBlock ? descBlock + "\n" : ""}${itemsBlock ? itemsBlock + "\n" : ""}Requested aspects to (naturally) highlight in at least one review:
${listBlock}

Guidelines:
- Produce two distinct reviews that feel human and specific, not generic or over-the-top.
- It's okay to use only some of the phrases—keep it natural.
- Use the items/services list to ground details where appropriate; do not invent specifics beyond what's implied.
- Keep tone sincere and credible; avoid marketing fluff.
- Each review should feel like something a real person would willingly post publicly.

Please make each review roughly 75 words.

STRICT OUTPUT FORMAT:
Return ONLY valid JSON (no markdown fences, no extra text) with this shape:
{
  "review_1": "<first review as a single string>",
  "review_2": "<second review as a single string>"
}
`.trim();

  // --- 4) Call Gemini
  try {
    const result = await generateText({
      model: google("gemini-2.5-flash"),
      prompt,
      temperature: 0.9,
    });

    // Try strict JSON parse first
    let review1 = "";
    let review2 = "";

    try {
      const raw = (result.text || "").trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const jsonStr =
        start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw;
      const parsed = JSON.parse(jsonStr);
      review1 = String(parsed.review_1 ?? "").trim();
      review2 = String(parsed.review_2 ?? "").trim();
    } catch {
      // fallback if model gives "review_1:" etc. outside valid JSON
      const raw = (result.text || "")
        .replace(/^```json|```/g, "")
        .replace(/review[_\s-]*1:\s*/i, "")
        .replace(/review[_\s-]*2:\s*/i, "");
      const parts = raw
        .split(/\n{2,}|(?:^|\n)---+(?:\n|$)/)
        .filter(Boolean);
      review1 = (parts[0] ?? "").trim();
      review2 = (parts[1] ?? "").trim();
    }

    if (!review1 || !review2) {
      return new Response(
        JSON.stringify({
          error: "MODEL_BAD_FORMAT",
          message: "Model returned an unexpected format.",
          raw: result.text,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // --- 5) Respond
    return new Response(
      JSON.stringify({
        businessId,
        clientId,
        businessDisplayName,
        businessDescription: businessDescription || null,
        phrases,
        itemDescriptions,
        reviews: [review1, review2],
        usage: result.usage ?? null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("[public/generate-good-reviews] Gemini error:", e);
    return serverError("AI generation failed.");
  }
}

export async function GET() {
  return badRequest(
    "Use POST with JSON: { businessId: string, clientId: string, token: string, phrases: string[1..10] }"
  );
}
