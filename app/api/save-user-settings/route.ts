// app/api/save-user-settings/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/* ========= Runtime / DB ========= */
export const runtime = "nodejs";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // or a dedicated PUBLIC URL if you split
  ssl: { rejectUnauthorized: true },
});

/* ========= Utils ========= */
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

/* ========= SQL ========= */
const SQL_SET_RLS          = `SET LOCAL app.user_id = $1` as const;
const SQL_GET_CURRENT      = `SELECT display_name, slug FROM public.myusers WHERE betterauth_id = $1 LIMIT 1` as const;
const SQL_UPDATE_NAME      = `UPDATE public.myusers SET display_name = $2, updated_at = now() WHERE betterauth_id = $1 RETURNING display_name` as const;
const SQL_UPDATE_SLUG      = `UPDATE public.myusers SET slug = $2, updated_at = now() WHERE betterauth_id = $1 RETURNING slug` as const;

type RowUser = { display_name: string | null; slug: string | null };

export async function POST(req: NextRequest) {
  let client;
  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body?.userId;
    const displayNameInput: string | undefined = body?.displayName;
    const slugInput: string | undefined = body?.slug;

    if (!userId) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "userId is required" },
        { status: 400 }
      );
    }

    const wantName = typeof displayNameInput === "string" && displayNameInput.trim().length > 0;
    const wantSlug = typeof slugInput === "string" && slugInput.trim().length > 0;

    if (!wantName && !wantSlug) {
      return NextResponse.json(
        { error: "NO_CHANGES", message: "Nothing to update." },
        { status: 400 }
      );
    }

    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(SQL_SET_RLS, [userId]);

    // Read current
    const currentRes = await client.query<RowUser>(SQL_GET_CURRENT, [userId]);
    const current = currentRes.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Profile not found." },
        { status: 404 }
      );
    }

    let finalDisplay = current.display_name ?? "";
    let finalSlug = current.slug ?? "";
    let slugConflict = false;

    // Update display name if requested
    if (wantName && displayNameInput!.trim() !== (current.display_name || "")) {
      const r = await client.query<{ display_name: string }>(SQL_UPDATE_NAME, [
        userId,
        displayNameInput!.trim(),
      ]);
      finalDisplay = r.rows[0]?.display_name ?? finalDisplay;
    }

    // Update slug if requested
    if (wantSlug) {
      const desired = slugify(slugInput!);
      if (!desired) {
        // invalid slug → treat like conflict but non-fatal
        slugConflict = true;
      } else if (desired !== (current.slug || "")) {
        try {
          const r = await client.query<{ slug: string }>(SQL_UPDATE_SLUG, [userId, desired]);
          finalSlug = r.rows[0]?.slug ?? finalSlug;
        } catch (e: any) {
          // Unique violation → keep old slug, mark conflict, continue (do not roll back name change)
          if (e?.code === "23505") {
            slugConflict = true;
          } else {
            throw e;
          }
        }
      }
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      user: { displayName: finalDisplay, slug: finalSlug },
      slugConflict,
      message: slugConflict ? "Slug is not unique. Display name was saved; slug unchanged." : undefined,
    });
  } catch (e) {
    try { await client?.query("ROLLBACK"); } catch {}
    console.error("save-user-settings failed:", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not save settings." },
      { status: 500 }
    );
  } finally {
    client?.release?.();
  }
}
