// app/api/google/sync-gr-with-clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

/** ---------- PG Pool (singleton across HMR) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolSyncGrWithClients?: Pool };

function getPool(): Pool {
  if (!globalForPg._pgPoolSyncGrWithClients) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolSyncGrWithClients = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolSyncGrWithClients;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

/** ---------- Types ---------- */

type GoogleReviewRow = {
  id: string;
  business_id: string;
  author_name: string | null;
};

type ClientRow = {
  id: string;
  business_id: string;
  display_name: string | null;
};

type MatchResult = {
  google_review_id: string;
  client_id: string;
  author_name: string | null;
  display_name: string | null;
};

/** ---------- Helpers ---------- */

function normalizeName(input: string | null | undefined): string | null {
  if (!input) return null;
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, ""); // remove spaces, punctuation, symbols
}

/**
 * POST /api/google/sync-gr-with-clients
 * Body: { businessId: string }
 *
 * For the given business:
 *  - Fetch google_reviews where linked = FALSE
 *  - Fetch clients
 *  - Try to match google_reviews.author_name to clients.display_name
 *    using a simple normalized (case/punctuation-insensitive) exact match.
 *
 * Returns:
 * {
 *   success: true,
 *   businessId: string,
 *   matchCount: number,
 *   matches: Array<{
 *     google_review_id: string,
 *     client_id: string,
 *     author_name: string | null,
 *     display_name: string | null
 *   }>
 * }
 *
 * RLS:
 *  - Uses auth.api.getSession + set_config('app.user_id', ...) inside tx
 *  - Relies on DB-side RLS to ensure only allowed rows are visible.
 */
export async function POST(req: NextRequest) {
  const pool = getPool();
  const db = await pool.connect();

  try {
    const body = (await req.json().catch(() => ({}))) as { businessId?: string };
    const businessId = body.businessId?.trim();

    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid businessId is required." },
        { status: 400 }
      );
    }

    // Auth → set app.user_id for RLS
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // 1) Unlinked google reviews for this business (RLS will scope visibility)
    const grRes = await db.query<GoogleReviewRow>(
      `
      SELECT id, business_id, author_name
      FROM public.google_reviews
      WHERE business_id = $1
        AND linked = FALSE
      `,
      [businessId]
    );

    // 2) Clients for this business
    const cRes = await db.query<ClientRow>(
      `
      SELECT id, business_id, display_name
      FROM public.clients
      WHERE business_id = $1
        AND deleted_at IS NULL
      `,
      [businessId]
    );

    await db.query("COMMIT");

    const googleReviews = grRes.rows;
    const clients = cRes.rows;

    // 3) Build index of normalized display_name -> [clients]
    const clientIndex = new Map<string, ClientRow[]>();
    for (const c of clients) {
      const norm = normalizeName(c.display_name);
      if (!norm) continue;
      if (!clientIndex.has(norm)) clientIndex.set(norm, []);
      clientIndex.get(norm)!.push(c);
    }

    // 4) For each google review, attempt a simple normalized exact match
    const matches: MatchResult[] = [];

    for (const gr of googleReviews) {
      const normAuthor = normalizeName(gr.author_name);
      if (!normAuthor) continue;

      const candidates = clientIndex.get(normAuthor);
      if (!candidates || candidates.length === 0) continue;

      // Simplistic strategy: take the first candidate
      const matchedClient = candidates[0];

      matches.push({
        google_review_id: gr.id,
        client_id: matchedClient.id,
        author_name: gr.author_name,
        display_name: matchedClient.display_name,
      });
    }

    return NextResponse.json(
      {
        success: true,
        businessId,
        matchCount: matches.length,
        matches,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err: unknown) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // ignore rollback error
    }
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[POST /api/google/sync-gr-with-clients] Error:", msg);

    return NextResponse.json(
      { error: "SERVER_ERROR", message: "An unexpected error occurred." },
      { status: 500 }
    );
  } finally {
    db.release();
  }
}
