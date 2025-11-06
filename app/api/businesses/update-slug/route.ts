// app/api/update-business-slug/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG Pool (singleton; no eslint-disable, no `any`) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolUpdateBusinessSlug?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolUpdateBusinessSlug) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolUpdateBusinessSlug = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolUpdateBusinessSlug;
}

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

/** Server-side slug normalizer (matches client behavior closely) */
function normalizeSlug(input: string, maxLen = 60): string {
  const ascii = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // non-alnum -> "-"
    .replace(/^-+|-+$/g, "")       // trim leading/trailing "-"
    .replace(/-{2,}/g, "-")        // collapse "--"
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, "");      // re-trim in case slice cut mid "-"
}

const RESERVED = new Set([
  "admin", "api", "login", "log-in", "logout", "sign-in", "signout",
  "dashboard", "settings", "business", "businesses", "clients", "analytics",
  "review", "reviews", "email", "emails", "user", "users", "me",
]);

type ReqBody = {
  businessId?: string;
  newSlug?: string;
};

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = (await readJson<ReqBody>(req)) ?? {};
    const businessId = (body.businessId ?? "").trim();
    const newSlug = body.newSlug;

    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "MISSING_OR_INVALID_BUSINESS_ID" },
        { status: 400 }
      );
    }
    if (typeof newSlug !== "string") {
      return NextResponse.json(
        { error: "MISSING_NEWSLUG" },
        { status: 400 }
      );
    }

    // RLS: set app.user_id from BetterAuth session
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Normalize and validate
    const normalized = normalizeSlug(newSlug);
    if (!normalized || normalized.length < 2) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "INVALID_SLUG", message: "Slug must contain letters/numbers and be at least 2 characters." },
        { status: 400 }
      );
    }
    if (RESERVED.has(normalized)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "RESERVED", message: "That slug is reserved. Please choose another." },
        { status: 400 }
      );
    }

    // Check availability (case-insensitive by virtue of normalization)
    const exists = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM public.businesses
          WHERE slug = $1 AND id <> $2
        ) AS exists
      `,
      [normalized, businessId]
    );
    if (exists.rows[0]?.exists) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "SLUG_TAKEN", message: "That dashboard URL is already taken." },
        { status: 409 }
      );
    }

    // Update slug
    const { rows, rowCount } = await client.query<{
      id: string;
      slug: string;
      display_name: string;
      company_logo_url: string | null;
      google_review_link: string | null; // ← if your column is google_review_link (common in your other routes)
      updated_at: string;
    }>(
      `
        UPDATE public.businesses
           SET slug = $2,
               updated_at = NOW()
         WHERE id = $1
         RETURNING id, slug, display_name, company_logo_url, google_review_link, updated_at
      `,
      [businessId, normalized]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found or not accessible." },
        { status: 404 }
      );
    }

    await client.query("COMMIT");

    return NextResponse.json(
      { success: true, business: rows[0] },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[update-business-slug] error:", msg);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    client.release();
  }
}
