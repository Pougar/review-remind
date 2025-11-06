// app/api/businesses/save-details/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient, type QueryResult } from "pg";

/* ========= Runtime / DB ========= */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reuse a typed Pool across hot-reloads (no `any`) */
const globalForPg = globalThis as unknown as { __pgPool?: Pool };
const pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
globalForPg.__pgPool = pool;

/* ========= Helpers ========= */
const isNonEmpty = (v?: string | null) => !!v && v.trim().length > 0;

function slugify(input: string, maxLen = 60): string {
  const ascii = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, "");
}

type Body = {
  userId?: string;        // BetterAuth user id (for RLS)
  businessId?: string;    // business id (text)
  displayName?: string | null;
  businessEmail?: string | null;
  description?: string | null;
  googleReviewLink?: string | null;
  slug?: string | null;   // desired new slug
};

const ERR = {
  BAD_INPUT: { error: "BAD_INPUT", message: "userId and businessId are required." },
  NOT_FOUND: { error: "NOT_FOUND", message: "Business not found or not accessible." },
  INTERNAL:  { error: "INTERNAL", message: "Could not save business details." },
} as const;

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

/* ========= POST /api/businesses/save-details =========
   Saves any subset of {displayName, businessEmail, description, googleReviewLink, slug}.
   - Requires { userId, businessId } for RLS.
   - If slug is provided and not unique/invalid, other fields are saved and a warning is returned.
*/
export async function POST(req: NextRequest) {
  const body = (await readJson<Body>(req)) ?? {};

  const userId = body.userId?.trim();
  const businessId = body.businessId?.trim();

  // ✅ only check for non-empty strings now
  if (!isNonEmpty(userId) || !isNonEmpty(businessId)) {
    return NextResponse.json(ERR.BAD_INPUT, { status: 400 });
  }

  // normalize non-slug inputs (allow explicit null to clear; empty string → null)
  const displayName =
    body.displayName === undefined ? undefined : (body.displayName?.trim() || null);
  const businessEmail =
    body.businessEmail === undefined ? undefined : (body.businessEmail?.trim() || null);
  const description =
    body.description === undefined ? undefined : (body.description?.trim() ?? null);
  const googleReviewLink =
    body.googleReviewLink === undefined ? undefined : (body.googleReviewLink?.trim() || null);

  // slug handling inputs
  const wantSlugRaw = body.slug === undefined ? undefined : (body.slug ?? "");
  const wantSlugClean =
    wantSlugRaw === undefined ? undefined : slugify(String(wantSlugRaw));

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    // Use set_config for RLS context (parameterized)
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Ensure the business exists & is accessible (RLS will enforce ownership)
    const existsRes: QueryResult<{ id: string; slug: string }> =
      await client.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM public.businesses WHERE id = $1 LIMIT 1`,
        [businessId]
      );
    const current = existsRes.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return NextResponse.json(ERR.NOT_FOUND, { status: 404 });
    }

    // Decide whether slug can be updated
    let slugCanUpdate = false;
    let slugReason: "TAKEN" | "INVALID" | null = null;

    if (wantSlugClean !== undefined) {
      if (!wantSlugClean) {
        slugCanUpdate = false;
        slugReason = "INVALID";
      } else if (wantSlugClean === current.slug) {
        slugCanUpdate = false; // no-op
      } else {
        const taken = await client.query(
          `SELECT 1 FROM public.businesses WHERE slug = $1 AND id <> $2 LIMIT 1`,
          [wantSlugClean, businessId]
        );
        if (taken.rowCount && taken.rowCount > 0) {
          slugCanUpdate = false;
          slugReason = "TAKEN";
        } else {
          slugCanUpdate = true;
          slugReason = null;
        }
      }
    }

    // Build dynamic UPDATE only with provided fields
    const sets: string[] = [];
    const vals: Array<string | null> = []; // no `any`
    let idx = 1;

    const push = (col: string, val: string | null) => {
      sets.push(`${col} = $${idx++}`);
      vals.push(val);
    };

    if (displayName !== undefined) push("display_name", displayName);
    if (businessEmail !== undefined) push("business_email", businessEmail);
    if (description !== undefined) push("description", description);
    if (googleReviewLink !== undefined) push("google_review_link", googleReviewLink);
    if (wantSlugClean !== undefined && slugCanUpdate) push("slug", wantSlugClean);

    if (sets.length === 0) {
      await client.query("COMMIT");
      return NextResponse.json(
        {
          updated: false,
          slugUpdated: false,
          slug: current.slug,
          message:
            wantSlugClean !== undefined && slugReason
              ? slugReason === "TAKEN"
                ? "Slug is already taken; no changes applied."
                : "Invalid slug; no changes applied."
              : "No changes provided.",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const sql = `UPDATE public.businesses SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id, slug`;
    const params: unknown[] = [...vals, businessId]; // keep typesafe; pg accepts unknown[] for values
    const upd: QueryResult<{ id: string; slug: string }> =
      await client.query<{ id: string; slug: string }>(sql, params);

    await client.query("COMMIT");

    const newSlug = upd.rows[0]?.slug ?? current.slug;

    return NextResponse.json(
      {
        updated: true,
        slugUpdated: Boolean(slugCanUpdate),
        slug: newSlug,
        ...(slugReason
          ? {
              message:
                slugReason === "TAKEN"
                  ? "Slug already taken. Other changes were saved."
                  : "Invalid slug. Other changes were saved.",
            }
          : null),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: unknown) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/businesses/save-details] failed:", msg);
    return NextResponse.json(ERR.INTERNAL, { status: 500 });
  } finally {
    client.release();
  }
}
