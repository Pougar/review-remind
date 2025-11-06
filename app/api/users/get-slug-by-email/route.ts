import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/* ========= Runtime / DB ========= */
export const runtime = "nodejs";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

/* ========= Constants ========= */
const SQL_FIND_USER_ID_BY_EMAIL = `SELECT id FROM auth."user" WHERE email = $1 LIMIT 1` as const;
// ❌ remove: const SQL_SET_RLS = `SET LOCAL app.user_id = $1`
// keep your slug read as-is:
const SQL_GET_SLUG_BY_ID = `SELECT slug FROM public.myusers WHERE betterauth_id = $1 LIMIT 1` as const;

const ERR = {
  INVALID_EMAIL: { error: "INVALID_EMAIL", message: "Valid email is required." } as const,
  NOT_FOUND:     { error: "NOT_FOUND", message: "User or profile not found." } as const,
  INTERNAL:      { error: "INTERNAL", message: "Could not resolve slug." } as const,
} as const;

/* ========= Utils ========= */
function isValidEmail(str?: string) {
  return !!str && /.+@.+\..+/.test(str);
}

// Escape a value for single-quoted SQL literal
function sqlLiteral(val: string) {
  return `'${val.replace(/'/g, "''")}'`;
}

/* ========= Handler ========= */
export async function POST(req: NextRequest) {
  let client;
  try {
    const { email } = (await req.json()) as { email?: string };

    if (!isValidEmail(email)) {
      return NextResponse.json(ERR.INVALID_EMAIL, { status: 400 });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // 1) Resolve BetterAuth user id by email (citext → case-insensitive)
    const ures = await client.query<{ id: string }>(SQL_FIND_USER_ID_BY_EMAIL, [email!]);
    const userId = ures.rows[0]?.id;
    if (!userId) {
      await client.query("ROLLBACK");
      return NextResponse.json(ERR.NOT_FOUND, { status: 404 });
    }

    // 2) ✅ Set RLS GUC with a safely escaped literal (NO bind params)
    await client.query(`SET LOCAL app.user_id = ${sqlLiteral(userId)}`);

    // 3) Read slug under RLS
    const sres = await client.query<{ slug: string }>(SQL_GET_SLUG_BY_ID, [userId]);
    await client.query("COMMIT");

    const slug = sres.rows[0]?.slug;
    if (!slug) {
      return NextResponse.json(ERR.NOT_FOUND, { status: 404 });
    }

    return NextResponse.json({ slug });
  } catch (e) {
    try { if (client) await client.query("ROLLBACK"); } catch {}
    console.error("get-slug-by-email failed:", e);
    return NextResponse.json(ERR.INTERNAL, { status: 500 });
  } finally {
    client?.release?.();
  }
}
