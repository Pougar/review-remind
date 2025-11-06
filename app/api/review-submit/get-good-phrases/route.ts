// app/api/public/get-good-phrases/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { verifyMagicToken } from "@/app/lib/magic-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   PG Pool (singleton across HMR)
   ============================================================ */
declare global {
  var _pgPoolGetGoodPhrasesPublic: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolGetGoodPhrasesPublic) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolGetGoodPhrasesPublic = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false }, // match your other routes
      max: 5,
    });
  }
  return global._pgPoolGetGoodPhrasesPublic;
}

/* ============================================================
   Helpers
   ============================================================ */
const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

const isClientIdPublicValid = (cid?: string | null) => {
  if (!cid) return false;
  if (cid === "test") return true;
  return isUUID(cid);
};

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: "INVALID_INPUT", message, ...extra },
    { status: 400 }
  );
}

function forbidden(message: string) {
  return NextResponse.json({ error: "INVALID_TOKEN", message }, { status: 403 });
}

function serverError(message = "Could not load good phrases.") {
  return NextResponse.json({ error: "SERVER_ERROR", message }, { status: 500 });
}

/* ============================================================
   Types
   ============================================================ */
type ReqBody = {
  businessId?: string;
  clientId?: string;
  token?: string;
  limit?: number;
};

type PhraseRow = {
  id: string;
  phrase: string;
  counts: number;
  good_count: number;
  bad_count: number;
  sentiment: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type RespSuccess = {
  success: true;
  businessId: string;
  count: number;
  phrases: {
    phrase_id: string;
    phrase: string;
    counts: number;
    good_count: number;
    bad_count: number;
    sentiment: "good";
    created_at: string | null;
    updated_at: string | null;
  }[];
};

/* ============================================================
   Route
   ============================================================ */
export async function POST(req: NextRequest) {
  const pool = getPool();
  const db: PoolClient = await pool.connect();

  try {
    // --- Parse request ---
    const body = (await req.json().catch(() => ({}))) as ReqBody;

    const businessId = (body?.businessId || "").trim();
    const clientId = (body?.clientId || "").trim();
    const token = (body?.token || "").trim();

    // Limit clamp
    const rawLimit = body?.limit;
    const limit =
      typeof rawLimit === "number" && rawLimit > 0 && rawLimit <= 1000
        ? rawLimit
        : 200;

    // --- Basic validation ---
    if (!isUUID(businessId)) {
      return badRequest("Valid businessId is required.", {
        field: "businessId",
      });
    }
    if (!isClientIdPublicValid(clientId)) {
      return badRequest("Valid clientId is required.", {
        field: "clientId",
      });
    }
    if (!token) {
      return badRequest("token is required.", { field: "token" });
    }

    // --- Token validation ---
    const check = verifyMagicToken({
      token,
      businessId,
      clientId,
    });

    if (!check.ok) {
      // Token invalid / expired / mismatched
      return forbidden(check.error);
    }

    // NOTE:
    // Past this point we're in public mode:
    // - No BetterAuth session.
    // - No set_config('app.user_id', ...).
    // - DB RLS for phrases/businesses must explicitly allow SELECT
    //   when it's the same businessId from a valid token.
    //
    // We do NOT begin a transaction here because it's read-only.

    // --- Fetch ONLY 'good' phrases for this business ---
    // We exclude soft-deleted phrases (deleted_at IS NULL).
    // We sort by:
    //   1) highest total mentions (counts DESC),
    //   2) most recently updated,
    //   3) newest id last.
    const phrasesQ = await db.query<PhraseRow>(
      `
      SELECT
        p.id,
        p.phrase,
        p.counts,
        p.good_count,
        p.bad_count,
        p.sentiment::text AS sentiment,
        p.created_at,
        p.updated_at
      FROM public.phrases p
      WHERE p.business_id = $1
        AND p.deleted_at IS NULL
        AND p.sentiment = 'good'::public.sentiment_enum
      ORDER BY
        p.counts DESC,
        p.updated_at DESC NULLS LAST,
        p.id DESC
      LIMIT $2
      `,
      [businessId, limit]
    );

    // Shape for the client
    const items = phrasesQ.rows.map((row) => ({
      phrase_id: row.id,
      phrase: row.phrase,
      counts: row.counts ?? 0,
      good_count: row.good_count ?? 0,
      bad_count: row.bad_count ?? 0,
      sentiment: "good" as const,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
    }));

    const resp: RespSuccess = {
      success: true,
      businessId,
      count: items.length,
      phrases: items,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("[/api/public/get-good-phrases] error:", e.stack ?? e);

    const msg = (e.message || "").toLowerCase();
    if (msg.includes("row-level security")) {
      return serverError(
        "Permission denied by row-level security. Public phrase access likely needs an RLS policy allowing reads for valid tokens."
      );
    }

    return serverError();
  } finally {
    db.release();
  }
}
