// app/api/settings/review-settings/add-generated-phrases/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

/* ============================================================
   PG Pool (singleton across HMR)
   ============================================================ */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolAddGeneratedPhrases: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolAddGeneratedPhrases) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");

    global._pgPoolAddGeneratedPhrases = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false }, // keep consistent with other routes
      max: 5,
    });
  }
  return global._pgPoolAddGeneratedPhrases;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   Helpers
   ============================================================ */

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

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

function normalizeCounts(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/* ============================================================
   Types
   ============================================================ */

type ReqBody = {
  businessId?: string;
  phrases?: {
    phrase: string;
    counts?: number;
    sentiment?: string;
  }[];
};

type RowReturn = {
  id: string;
  phrase: string;
  counts: number | null;
  inserted: boolean;
};

type AddGeneratedResp = {
  success: boolean;
  businessId: string;
  inserted: { id: string; phrase: string; counts: number }[];
  updated: { id: string; phrase: string; counts: number }[];
  skipped_invalid: number;
  requested: number;
};

/* ============================================================
   Route handler
   ============================================================ */

export async function POST(req: NextRequest) {
  const pool = getPool();
  const client: PoolClient = await pool.connect();

  try {
    // ---- Auth / session ----
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // ---- Parse request body ----
    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const businessId = body?.businessId?.trim();
    const incoming = Array.isArray(body?.phrases) ? body.phrases : [];

    if (!isUUID(businessId)) {
      return NextResponse.json(
        {
          error: "INVALID_INPUT",
          message: "Valid businessId is required.",
        },
        { status: 400 }
      );
    }

    // After the guard above, we create non-optional locals for TS.
    const authedUserId: string = userId as string;
    const bid: string = businessId as string;

    // ---- Clean + dedupe incoming phrases ----
    const dedupeMap = new Map<
      string,
      { phrase: string; sentiment: "good" | "bad"; counts: number }
    >();

    for (const item of incoming) {
      const normPhrase = normalizePhrase(item?.phrase);
      if (!normPhrase) continue;

      const key = normPhrase.toLowerCase();
      const sent = normalizeSentiment(item?.sentiment);
      const cnt = normalizeCounts(item?.counts);

      if (!dedupeMap.has(key)) {
        dedupeMap.set(key, {
          phrase: normPhrase,
          sentiment: sent,
          counts: cnt,
        });
      } else {
        const prev = dedupeMap.get(key)!;
        const betterCounts = cnt > prev.counts ? cnt : prev.counts;
        const mergedSent =
          prev.sentiment === "bad" || sent === "bad" ? "bad" : "good";

        dedupeMap.set(key, {
          phrase: prev.phrase,
          sentiment: mergedSent,
          counts: betterCounts,
        });
      }
    }

    const cleaned = Array.from(dedupeMap.values());
    if (cleaned.length === 0) {
      return NextResponse.json(
        {
          error: "NO_VALID_PHRASES",
          message: "Please provide at least one valid phrase.",
        },
        { status: 400 }
      );
    }

    // ---- Begin transaction / set RLS ----
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [
      authedUserId,
    ]);

    // Confirm business is visible under RLS
    const bizCheck = await client.query(
      `
      SELECT id
      FROM public.businesses
      WHERE id = $1
      LIMIT 1
      `,
      [bid]
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

    // ---- Upsert phrases ----
    const inserted: { id: string; phrase: string; counts: number }[] = [];
    const updated: { id: string; phrase: string; counts: number }[] = [];

    for (const { phrase, sentiment, counts } of cleaned) {
      const q = await client.query<RowReturn>(
        `
        INSERT INTO public.phrases (
          business_id,
          phrase,
          created_by,
          sentiment,
          counts
        )
        VALUES (
          $1::uuid,
          $2::text,
          $3::text,
          $4::public.sentiment_enum,
          $5::integer
        )
        ON CONFLICT (business_id, phrase)
        DO UPDATE
        SET sentiment  = EXCLUDED.sentiment,
            counts     = EXCLUDED.counts,
            updated_at = now()
        RETURNING
          id,
          phrase,
          counts,
          (xmax = 0) AS inserted
        `,
        [bid, phrase, authedUserId, sentiment, counts]
      );

      if ((q.rowCount ?? 0) > 0) {
        const row = q.rows[0];
        const safeCounts = row.counts ?? 0;
        if (row.inserted) {
          inserted.push({
            id: row.id,
            phrase: row.phrase,
            counts: safeCounts,
          });
        } else {
          updated.push({
            id: row.id,
            phrase: row.phrase,
            counts: safeCounts,
          });
        }
      }
    }

    await client.query("COMMIT");

    // ---- Build response ----
    const resp: AddGeneratedResp = {
      success: true,
      businessId: bid,
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
      "[/api/settings/review-settings/add-generated-phrases] error:",
      err?.stack || err
    );

    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: "Could not add generated phrases.",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
