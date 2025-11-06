// app/api/update-business-description/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- PG Pool (singleton across hot reloads; no eslint-disable, no `any`) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolUpdateBizDesc?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolUpdateBizDesc) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolUpdateBizDesc = new Pool({
      connectionString: cs,
      // Neon typically requires SSL; set to false if your connection string includes sslmode=require.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolUpdateBizDesc;
}

const MAX_LEN = 4000;
const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

type ReqBody = {
  businessId?: string;
  description?: string | null;
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
    const description = body.description;

    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "MISSING_OR_INVALID_BUSINESS_ID" },
        { status: 400 }
      );
    }

    // Auth (BetterAuth) — used for RLS via app.user_id
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Normalize description: trim → cap → null if empty/whitespace
    let value: string | null = null;
    if (typeof description === "string") {
      const trimmed = description.trim().slice(0, MAX_LEN);
      value = trimmed.length ? trimmed : null;
    } else if (description === null) {
      value = null;
    }

    const { rows, rowCount } = await client.query(
      `
        UPDATE public.businesses
           SET description = $2,
               updated_at = NOW()
         WHERE id = $1
         RETURNING id, slug, display_name, description, company_logo_url, updated_at
      `,
      [businessId, value]
    );

    if (rowCount === 0) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Business not found or not accessible." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, business: rows[0] },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[update-business-description] error:", msg);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    client.release();
  }
}
