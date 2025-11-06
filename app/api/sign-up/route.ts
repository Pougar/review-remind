// app/api/sign-up/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// Escape for single-quoted SQL literal
function sqlLiteral(val: string) {
  return `'${val.replace(/'/g, "''")}'`;
}

function slugify(input: string, maxLen = 60) {
  const ascii = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, "");
}

function emailLocal(email?: string) {
  if (!email) return "";
  const i = email.indexOf("@");
  return i > 0 ? email.slice(0, i) : email;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let id = (body?.id ?? "").toString().trim(); // betterauth_id (optional)
    const email = (body?.email ?? "").toString().trim().toLowerCase();
    const name = (body?.name ?? "").toString().trim();

    // If id is missing, try to resolve it by email from auth.user
    if (!id && email) {
      const q = await pool.query<{ id: string }>(
        `SELECT id FROM auth."user" WHERE email = $1 LIMIT 1`,
        [email]
      );
      id = q.rows[0]?.id || "";
    }

    if (!id) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "Unable to resolve user id (pass id or email)" },
        { status: 400 }
      );
    }

    const base = slugify(name) || slugify(emailLocal(email)) || `user-${id.slice(0, 8)}`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Set RLS GUC via literal (Neon doesn’t like bind params in SET/LOCAL)
      await client.query(`SET LOCAL app.user_id = ${sqlLiteral(id)}`);

      // If myusers row exists and has a slug, return it
      const existing = await client.query<{ slug: string | null }>(
        `SELECT slug FROM public.myusers WHERE betterauth_id = $1 LIMIT 1`,
        [id]
      );
      const existingSlug = existing.rows[0]?.slug ?? null;
      if (existingSlug) {
        await client.query("COMMIT");
        return NextResponse.json({ slug: existingSlug });
      }

      // Helper: try slug with numeric suffixes until unique
      const tryCandidates = async (
        attempt: (candidate: string) => Promise<string | null>,
        max = 50
      ): Promise<string> => {
        for (let i = 0; i <= max; i++) {
          const candidate = i === 0 ? base : `${base}-${i + 1}`;
          try {
            const got = await attempt(candidate);
            if (got) return got;
          } catch (e: unknown) {
            const code =
              typeof e === "object" && e && "code" in e
                ? (e as { code?: string }).code
                : undefined;
            if (code === "23505") continue; // slug unique collision
            throw e;
          }
        }
        throw new Error("COULD_NOT_ALLOCATE_UNIQUE_SLUG");
      };

      let finalSlug: string;

      if (existing.rows.length > 0) {
        // Row exists but slug is NULL → set it
        finalSlug = await tryCandidates(async (candidate) => {
          const r = await client.query<{ slug: string }>(
            `
            UPDATE public.myusers
               SET slug = $2, display_name = COALESCE($3, display_name)
             WHERE betterauth_id = $1 AND slug IS NULL
         RETURNING slug
            `,
            [id, candidate, name || null]
          );
          return r.rows[0]?.slug ?? null;
        });
      } else {
        // No row yet → insert
        finalSlug = await tryCandidates(async (candidate) => {
          const r = await client.query<{ slug: string }>(
            `
            INSERT INTO public.myusers (betterauth_id, slug, display_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (betterauth_id) DO NOTHING
            RETURNING slug
            `,
            [id, candidate, name || candidate]
          );
          return r.rows[0]?.slug ?? null;
        });
      }

      await client.query("COMMIT");
      return NextResponse.json({ slug: finalSlug });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("record-sign-up failed:", err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not record sign-up" },
      { status: 500 }
    );
  }
}
