// app/api/get-name/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export async function POST(req: NextRequest) {
  const client = await pool.connect();
  try {
    const { id } = (await req.json()) as { id?: string };
    if (!id) {
      return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
    }

    await client.query("BEGIN");
    // satisfy RLS
    const safe = id.replace(/'/g, "''");
    await client.query(`SET LOCAL app.user_id = '${safe}'`);

    const q = `
      SELECT slug, display_name
      FROM public.myusers
      WHERE betterauth_id = $1
      LIMIT 1
    `;
    const { rows } = await client.query<{ slug: string | null; display_name: string | null }>(q, [id]);
    await client.query("COMMIT");

    const row = rows[0];
    if (!row?.slug) {
      // No row OR slug is null → tell the caller clearly
      return NextResponse.json({ error: "PROFILE_NOT_READY" }, { status: 404 });
    }

    // ✅ Always return a key your checker understands
    return NextResponse.json({
      name: row.slug,                 // alias slug as "name"
      slug: row.slug,                 // and include slug too (belt-and-suspenders)
      display_name: row.display_name, // optional
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("get-name failed:", e);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    client.release();
  }
}
