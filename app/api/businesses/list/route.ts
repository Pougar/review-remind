// app/api/businesses/list/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";

/* ========= DB pool ========= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

/* ========= SQL ========= */
// Explicit filter by owner (in addition to RLS via app.user_id)
const SQL_LIST_BIZ = `
  SELECT id, slug, display_name, created_at
  FROM public.businesses
  WHERE deleted_at IS NULL
    AND user_id = $1
  ORDER BY created_at DESC
` as const;

/* ========= Types (server-side only) ========= */
type BizRow = {
  id: string;
  slug: string;
  display_name: string | null;
  created_at: Date | string; // pg can return Date or string depending on config
};

/* ========= Errors ========= */
const ERR = {
  AUTH:     { error: "NOT_AUTHENTICATED", message: "Sign in required." },
  INTERNAL: { error: "INTERNAL", message: "Could not load businesses." },
} as const;

/* ========= Utils ========= */
// Needed only for SET LOCAL (Neon disallows bind params there)
function sqlLiteral(val: string) {
  return `'${val.replace(/'/g, "''")}'`;
}

function toIso(d: Date | string) {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

async function listForUser(userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.user_id = ${sqlLiteral(userId)}`); // RLS context
    const { rows } = await client.query<BizRow>(SQL_LIST_BIZ, [userId]);

    await client.query("COMMIT");

    // Normalize created_at to ISO strings for JSON clients
    return (rows ?? []).map((r) => ({
      id: r.id,
      slug: r.slug,
      display_name: r.display_name,              // may be null; client already handles fallback
      created_at: toIso(r.created_at),           // always ISO string in the response
    }));
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

/* ========= POST /api/businesses/list ========= */
export async function POST(req: NextRequest) {
  try {
    // ✅ BetterAuth expects a Headers object
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id?.toString().trim();
    if (!userId) return NextResponse.json(ERR.AUTH, { status: 401 });

    const businesses = await listForUser(userId);
    return NextResponse.json({ businesses });
  } catch (e) {
    console.error("POST /api/businesses/list failed:", e);
    return NextResponse.json(ERR.INTERNAL, { status: 500 });
  }
}
