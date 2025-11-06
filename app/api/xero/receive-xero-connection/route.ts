// app/api/xero/receive-xero-connection/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const NONCE_COOKIE = "xero_oauth_nonce";

type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
};

type XeroConnection = {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
};

/* ---------- PG Pool (singleton across HMR) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var __pgPoolXeroReceive: Pool | undefined;
}

const pool =
  globalThis.__pgPoolXeroReceive ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
globalThis.__pgPoolXeroReceive = pool;

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function fromB64Url<T = unknown>(val: string): T {
  return JSON.parse(Buffer.from(val, "base64url").toString("utf8")) as T;
}

export async function GET(req: NextRequest) {
  const client: PoolClient = await pool.connect();

  try {
    const url = new URL(req.url);
    const origin = url.origin;

    const errParam = url.searchParams.get("error");
    if (errParam) {
      const desc = url.searchParams.get("error_description") || "Authorization failed.";
      return NextResponse.json({ error: errParam, description: desc }, { status: 400 });
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return NextResponse.json({ error: "Missing code/state" }, { status: 400 });
    }

    const cookieNonce = req.cookies.get(NONCE_COOKIE)?.value;
    if (!cookieNonce) {
      return NextResponse.json({ error: "Missing or expired auth session" }, { status: 400 });
    }

    let decoded: { userId?: string; businessId?: string; nonce?: string; returnTo?: string };
    try {
      decoded = fromB64Url<{ userId?: string; businessId?: string; nonce?: string; returnTo?: string }>(state);
    } catch {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }

    const userId = decoded?.userId || "";
    const businessId = decoded?.businessId || "";
    if (!userId || !businessId || decoded.nonce !== cookieNonce) {
      return NextResponse.json({ error: "State mismatch" }, { status: 400 });
    }

    const clientId = requireEnv("XERO_CLIENT_ID");
    const clientSecret = requireEnv("XERO_CLIENT_SECRET");
    const redirectUri = `${origin}/api/xero/receive-xero-connection`;

    const tokenResp = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResp.ok) {
      const body = await tokenResp.text().catch(() => "");
      return NextResponse.json(
        { error: "Token exchange failed", status: tokenResp.status, body },
        { status: 502 }
      );
    }

    const { access_token, refresh_token, id_token, token_type, expires_in, scope } =
      (await tokenResp.json()) as XeroTokenResponse;

    const conResp = await fetch(XERO_CONNECTIONS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!conResp.ok) {
      const body = await conResp.text().catch(() => "");
      return NextResponse.json(
        { error: "Failed to retrieve Xero connections", status: conResp.status, body },
        { status: 502 }
      );
    }

    const connections = (await conResp.json()) as XeroConnection[];
    if (!Array.isArray(connections) || connections.length === 0) {
      return NextResponse.json(
        { error: "No organisations granted. Please re-connect and select one." },
        { status: 400 }
      );
    }

    await client.query("BEGIN");
    // ✅ Use set_config() instead of SET LOCAL ... $1 (parameters aren’t allowed in SET)
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    const hasPrimaryRes = await client.query(
      `
      SELECT EXISTS (
        SELECT 1 FROM integrations.xero_details
        WHERE business_id = $1 AND is_primary = TRUE
      ) AS has_primary
      `,
      [businessId]
    );
    const row = hasPrimaryRes.rows[0] as { has_primary?: boolean } | undefined;
    let hasPrimary = !!row?.has_primary;

    const accessExpiresAt = new Date(Date.now() + expires_in * 1000);

    for (const c of connections) {
      const makePrimary = !hasPrimary;

      await client.query(
        `
        INSERT INTO integrations.xero_details (
          business_id,
          tenant_id,
          tenant_name,
          tenant_type,
          connection_id,
          scope,
          access_token,
          refresh_token,
          id_token,
          token_type,
          access_token_expires_at,
          last_refreshed_at,
          is_connected,
          is_primary
        )
        VALUES (
          $1, $2::uuid, $3, $4, $5::uuid,
          $6, $7, $8, $9, $10,
          $11, NOW(), TRUE, $12
        )
        ON CONFLICT (business_id, tenant_id)
        DO UPDATE SET
          scope                   = EXCLUDED.scope,
          access_token            = EXCLUDED.access_token,
          refresh_token           = EXCLUDED.refresh_token,
          id_token                = EXCLUDED.id_token,
          token_type              = EXCLUDED.token_type,
          access_token_expires_at = EXCLUDED.access_token_expires_at,
          last_refreshed_at       = EXCLUDED.last_refreshed_at,
          is_connected            = TRUE
        `,
        [
          businessId,
          c.tenantId,
          c.tenantName,
          c.tenantType,
          c.id,
          scope,
          access_token,
          refresh_token,
          id_token ?? null,
          token_type ?? "Bearer",
          accessExpiresAt,
          makePrimary,
        ]
      );

      if (makePrimary) hasPrimary = true;
    }

    try {
      await client.query(
        `
        INSERT INTO public.business_actions (business_id, action)
        SELECT $1, 'xero_connected'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.business_actions
          WHERE business_id = $1 AND action = 'xero_connected'
        )
        `,
        [businessId]
      );
    } catch (e) {
      console.warn("[xero_connected] failed to record business action (continuing):", e);
    }

    await client.query("COMMIT");

    const returnTo = decoded.returnTo || "/dashboard";
    const res = NextResponse.redirect(new URL(returnTo, origin).toString(), 302);
    res.cookies.set({
      name: NONCE_COOKIE,
      value: "",
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      path: "/api/xero/receive-xero-connection",
      maxAge: 0,
    });
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err: unknown) {
    try {
      await pool.query("ROLLBACK");
    } catch {}
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("[/api/xero/receive-xero-connection] error:", e.stack ?? e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
