// app/api/businesses/get-id-by-slug/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool =
  (globalThis as any).__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
(globalThis as any).__pgPool = pool;

const isNonEmpty = (v?: string) => typeof v === "string" && v.trim().length > 0;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    businessSlug?: string;
    userId?: string;
  };

  const businessSlug = body.businessSlug?.trim();
  let userId = body.userId?.trim();

  if (!isNonEmpty(businessSlug)) {
    return NextResponse.json(
      { error: "BAD_INPUT", message: "businessSlug is required." },
      { status: 400 }
    );
  }

  // Fallback to session if userId not provided
  if (!isNonEmpty(userId)) {
    try {
      const sess = await auth.api.getSession({ headers: req.headers });
      userId = sess?.user?.id;
    } catch {}
  }
  if (!isNonEmpty(userId)) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Provide userId in body or sign in." },
      { status: 401 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);

    const { rows } = await client.query(
      `
      select id
      from public.businesses
      where slug = $1 and deleted_at is null
      limit 1
      `,
      [businessSlug]
    );

    await client.query("COMMIT");

    const id = rows[0]?.id as string | undefined;
    if (!id) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ id }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not resolve business id." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
