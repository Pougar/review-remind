// app/api/business-actions/google-connected/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// simple UUID check
const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12}$/.test(v);

export async function POST(req: NextRequest) {
  let client;
  try {
    const { businessId } = (await req.json()) as { businessId?: string };
    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid businessId is required." },
        { status: 400 }
      );
    }

    // Verify session (we’ll set app.user_id to satisfy RLS)
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHENTICATED", message: "Sign in required." },
        { status: 401 }
      );
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // ✅ Use set_config instead of SET LOCAL ... = $1
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // Idempotent insert (assumes either a UNIQUE on (business_id, action) or you’re fine with blind DO NOTHING)
    const res = await client.query(
      `INSERT INTO public.business_actions (business_id, action)
       VALUES ($1, 'google_connected')
       ON CONFLICT DO NOTHING`,
      [businessId]
    );

    await client.query("COMMIT");
    return NextResponse.json({ success: true, inserted: (res.rowCount ?? 0) > 0 });
  } catch (e) {
    try { await client?.query("ROLLBACK"); } catch {}
    console.error("google-connected action failed:", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not record business action." },
      { status: 500 }
    );
  } finally {
    client?.release?.();
  }
}
