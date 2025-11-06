import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";

/** DB pool (auth tables live in the "auth" schema) */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // or DATABASE_URL_AUTH if you split
  ssl: { rejectUnauthorized: true },
});

// Scope we expect to see after linking Google
const GBP_SCOPE_NEEDLE = "business.manage"; // substring match is enough

const ERR = {
  UNAUTHENTICATED: { error: "UNAUTHENTICATED", message: "You must be signed in." },
  FORBIDDEN:       { error: "FORBIDDEN", message: "User mismatch." },
  INTERNAL:        { error: "INTERNAL", message: "Could not verify connection." },
} as const;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const inputUserId = url.searchParams.get("betterauth_id") || undefined;

    // Session from BetterAuth (reads cookies from headers)
    const session = await auth.api.getSession({ headers: req.headers });
    const sessionUserId = session?.user?.id;

    if (!sessionUserId) {
      return NextResponse.json(ERR.UNAUTHENTICATED, { status: 401 });
    }

    // If caller passed an explicit user id, it must match the session user.
    if (inputUserId && inputUserId !== sessionUserId) {
      return NextResponse.json(ERR.FORBIDDEN, { status: 403 });
    }

    const effectiveUserId = inputUserId ?? sessionUserId;

    // Look for a Google account linked by BetterAuth
    const q = `
      SELECT
        scope,
        "accessToken",
        "refreshToken",
        "accessTokenExpiresAt"
      FROM auth.account
      WHERE "userId" = $1
        AND "providerId" = 'google'
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `;

    const { rows } = await pool.query<{
      scope: string | null;
      accessToken: string | null;
      refreshToken: string | null;
      accessTokenExpiresAt: Date | null;
    }>(q, [effectiveUserId]);

    const row = rows[0];

    // "Connected" if we have any token material for Google
    const connected = !!row && (!!row.accessToken || !!row.refreshToken);

    // Scope OK if scope string contains business.manage
    const scopeStr = (row?.scope || "").toLowerCase();
    const scopeOk = connected && scopeStr.includes(GBP_SCOPE_NEEDLE);

    return NextResponse.json({ connected, scopeOk });
  } catch (e) {
    console.error("GET /api/google/has-connection failed:", e);
    return NextResponse.json(ERR.INTERNAL, { status: 500 });
  }
}
