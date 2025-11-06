// app/api/settings/review-settings/add-phrases/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolAddPhrases: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolAddPhrases) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolAddPhrases = new Pool({
      connectionString: cs,
      // keep false to match the rest of your routes
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolAddPhrases;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- Helpers ---------- */
const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

// Light normaliser for phrases coming from UI
function normalizePhrase(raw: unknown, maxLen = 200): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  return trimmed;
}

function normalizeSentiment(raw: unknown): "good" | "bad" {
  return raw === "bad" ? "bad" : "good";
}

/* ---------- Types ---------- */
type ReqBody = {
  businessId?: string;
  phrases?: { phrase: string; sentiment?: string }[];
};

type RowReturn = {
  id: string;
  phrase: string;
  counts: number;
  inserted: boolean; // derived using xmax=0 trick
};

type AddPhrasesResp = {
  success: boolean;
  businessId: string;
  inserted: { id: string; phrase: string; counts: number }[];
  updated: { id: string; phrase: string; counts: number }[];
  skipped_invalid: number;
  requested: number;
};

export async function POST(req: NextRequest) {
  const pool = getPool();
  const client: PoolClient = await pool.connect();

  try {
    // --- Auth / session (BetterAuth) ---
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // --- Parse body ---
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const businessIdRaw = body?.businessId?.trim();
    const incoming = Array.isArray(body?.phrases) ? body.phrases : [];

    if (!isUUID(businessIdRaw)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid businessId is required." },
        { status: 400 }
      );
    }

    // ✅ after validation we narrow to definite string for TS
    const businessId = businessIdRaw as string;

    // Normalise + dedupe phrases
    //   - drop empty / invalid
    //   - dedupe by lowercase
    const seen = new Set<string>();
    const cleaned: { phrase: string; sentiment: "good" | "bad" }[] = [];

    for (const item of incoming) {
      const normPhrase = normalizePhrase(item?.phrase);
      if (!normPhrase) continue;
      const sig = normPhrase.toLowerCase();
      if (seen.has(sig)) continue;
      seen.add(sig);

      cleaned.push({
        phrase: normPhrase,
        sentiment: normalizeSentiment(item?.sentiment),
      });
    }

    if (cleaned.length === 0) {
      return NextResponse.json(
        {
          error: "NO_VALID_PHRASES",
          message: "Please provide at least one valid phrase.",
        },
        { status: 400 }
      );
    }

    // --- Begin transaction + satisfy RLS with app.user_id ---
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Optional: confirm this business is visible to the caller under RLS.
    const bizCheck = await client.query(
      `
      SELECT id
      FROM public.businesses
      WHERE id = $1
      LIMIT 1
      `,
      [businessId]
    );

    if ((bizCheck.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "NOT_ALLOWED_OR_NOT_FOUND",
          message:
            "You do not have access to this business or it does not exist.",
        },
        { status: 403 }
      );
    }

    // We'll upsert each phrase individually so we can classify
    // "inserted" vs "updated".
    //
    // Technique: RETURNING xmax = 0 AS inserted
    //  - In Postgres, a freshly inserted row has xmax=0
    //    (i.e. it hasn't been updated in-place).
    //
    // We also set created_by for new rows.
    //
    const inserted: { id: string; phrase: string; counts: number }[] = [];
    const updated: { id: string; phrase: string; counts: number }[] = [];

    for (const { phrase, sentiment } of cleaned) {
      const q = await client.query<RowReturn>(
        `
        INSERT INTO public.phrases (
          business_id,
          phrase,
          created_by,
          sentiment
        )
        VALUES ($1::uuid, $2::text, $3::text, $4::public.sentiment_enum)
        ON CONFLICT (business_id, phrase)
        DO UPDATE SET
          sentiment   = EXCLUDED.sentiment,
          updated_at  = now()
        RETURNING
          id,
          phrase,
          counts,
          (xmax = 0) AS inserted
        `,
        [businessId, phrase, userId, sentiment]
      );

      if ((q.rowCount ?? 0) > 0) {
        const row = q.rows[0];
        if (row.inserted) {
          inserted.push({
            id: row.id,
            phrase: row.phrase,
            counts: row.counts ?? 0,
          });
        } else {
          updated.push({
            id: row.id,
            phrase: row.phrase,
            counts: row.counts ?? 0,
          });
        }
      }
    }

    await client.query("COMMIT");

    const resp: AddPhrasesResp = {
      success: true,
      businessId,
      inserted,
      updated,
      skipped_invalid: incoming.length - cleaned.length,
      requested: incoming.length,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }

    const msg = String(err?.message || "");

    // Helpful RLS hint if blocked
    if (msg.toLowerCase().includes("row-level security")) {
      return NextResponse.json(
        {
          error: "RLS_DENIED",
          message: "Permission denied by row-level security.",
        },
        { status: 403 }
      );
    }

    console.error(
      "[/api/settings/review-settings/add-phrases] error:",
      err?.stack || err
    );

    return NextResponse.json(
      { error: "SERVER_ERROR", message: "Could not add phrases." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
