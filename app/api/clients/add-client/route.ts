// app/api/clients/add-client/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reuse a single pool per process
const pool =
  (globalThis as any).__pgPool ??
  new Pool({
    connectionString: (process.env.DATABASE_URL || "").trim(),
    ssl: { rejectUnauthorized: true },
  });
(globalThis as any).__pgPool = pool;

type Sentiment = "good" | "bad" | "unreviewed";

function isValidEmail(str?: string | null) {
  if (!str) return true; // allow empty/null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

export async function POST(req: NextRequest) {
  let db;
  try {
    // ---- Auth (BetterAuth) ----
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // ---- Parse & validate ----
    const body = await req.json().catch(() => ({}));
    const {
      businessId,
      name,                 // UI sends as `name`
      email,
      phone_number,
      initialSentiment,
      initialReview,
    } = (body ?? {}) as {
      businessId?: string;
      name?: string;
      email?: string | null;
      phone_number?: string | null;
      initialSentiment?: Sentiment;
      initialReview?: string | null;
    };

    if (!businessId) {
      return NextResponse.json({ error: "MISSING_BUSINESS_ID" }, { status: 400 });
    }
    if (!name || !name.trim()) {
      return NextResponse.json({ error: "MISSING_NAME" }, { status: 400 });
    }

    const cleanedEmail = (email ?? "").trim() || null;
    if (!isValidEmail(cleanedEmail)) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }

    const cleanedPhone = (phone_number ?? "").trim() || null;
    const sentiment: Sentiment =
      initialSentiment === "good" || initialSentiment === "bad" || initialSentiment === "unreviewed"
        ? initialSentiment
        : "unreviewed";

    const reviewText = (initialReview ?? "").trim();
    const hasReview = reviewText.length > 0;

    // Map sentiment -> happy (boolean | null)
    const happy = sentiment === "good" ? true : sentiment === "bad" ? false : null;

    // ---- DB work ----
    db = await pool.connect();
    await db.query("BEGIN");

    // If your RLS depends on app.user_id
    await db.query(`select set_config('app.user_id', $1, true)`, [userId]);

    const clientId = crypto.randomUUID();

    // clients.display_name is the correct column (not `name`)
    const ins = await db.query(
      `
        INSERT INTO public.clients
          (id, business_id, created_by, display_name, email, phone_number, sentiment)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, business_id, created_by, display_name, email, phone_number, sentiment, created_at, updated_at
      `,
      [clientId, businessId, userId, name.trim(), cleanedEmail, cleanedPhone, sentiment]
    );
    const clientRow = ins.rows[0];

    if (hasReview) {
      // ✅ Match reviews schema: (id defaulted), no "isPrimary"
      await db.query(
        `
          INSERT INTO public.reviews
            (business_id, client_id, created_by, review, happy)
          VALUES
            ($1,         $2,        $3,        $4,    $5)
        `,
        [businessId, clientId, userId, reviewText, happy]
      );
      // If you later want stars, add a "stars" param and include it in the column list above.
    }

    await db.query(
      `
        INSERT INTO public.client_actions (id, client_id, business_id, action)
        VALUES ($1::uuid, $2, $3, 'client_added')
      `,
      [crypto.randomUUID(), clientId, businessId]
    );

    await db.query("COMMIT");
    return NextResponse.json({ success: true, client: clientRow });
  } catch (e) {
    try { await db?.query("ROLLBACK"); } catch {}
    console.error("[POST /api/clients/add-client] error:", e);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    db?.release();
  }
}
