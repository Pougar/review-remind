// app/api/user/username/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";

/* ========= PG pool (singleton) ========= */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolGetUsername: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPoolGetUsername) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolGetUsername = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: true },
    });
  }
  return global._pgPoolGetUsername;
}

/* ========= SQL ========= */
const SQL_GET_USERNAME = `
  SELECT display_name
  FROM public.myusers
  WHERE betterauth_id = $1
  LIMIT 1
` as const;

/* ========= Errors ========= */
const ERR = {
  AUTH:     { error: "NOT_AUTHENTICATED", message: "Sign in required." },
  NOTFOUND: { error: "USER_NOT_FOUND", message: "No profile row for this user." },
  INTERNAL: { error: "INTERNAL", message: "Could not load username." },
} as const;

/* ========= GET /api/user/username ========= */
export async function GET(req: NextRequest) {
  try {
    // BetterAuth expects a native Headers object
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id?.toString().trim();

    if (!userId) {
      return NextResponse.json(ERR.AUTH, { status: 401 });
    }

    const db = getPool();
    const { rows } = await db.query<{ display_name: string }>(SQL_GET_USERNAME, [userId]);

    if (!rows[0]?.display_name) {
      // Optional: fall back to BetterAuth name if you prefer
      // const fallback = session?.user?.name || session?.user?.email?.split("@")[0];
      return NextResponse.json(ERR.NOTFOUND, { status: 404 });
    }

    return NextResponse.json({ username: rows[0].display_name });
  } catch (e) {
    console.error("GET /api/user/username failed:", e);
    return NextResponse.json(ERR.INTERNAL, { status: 500 });
  }
}
