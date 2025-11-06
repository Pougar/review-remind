// app/api/xero/connect-to-xero/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const NONCE_COOKIE = "xero_oauth_nonce";
const DEFAULT_SCOPES =
  "offline_access accounting.transactions.read accounting.contacts.read";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function toB64Url(obj: unknown) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function buildReceiveRedirectUri(origin: string) {
  // MUST exactly match the redirect URI you configured in your Xero app settings
  return `${origin}/api/xero/receive-xero-connection`;
}

type Body = {
  userId?: string;     // BetterAuth user id (string)
  businessId?: string; // Your business UUID (string)
  callback?: string;   // optional same-origin absolute/relative URL to return to after success
};

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const origin = url.origin;

    const { userId, businessId, callback }: Body = await req.json().catch(() => ({} as Body));

    // Minimal validation: require non-empty strings
    if (!userId || !businessId) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "userId and businessId are required." },
        { status: 400 }
      );
    }

    // Validate callback is same-origin (or fall back to dashboard)
    let returnTo = "/dashboard";
    if (callback) {
      try {
        const asURL = new URL(callback, origin);
        if (asURL.origin === origin) {
          returnTo = asURL.pathname + asURL.search;
        }
      } catch {
        // ignore invalid callback → keep default
      }
    }

    const clientId = requireEnv("XERO_CLIENT_ID");
    const scopes = process.env.XERO_SCOPES || DEFAULT_SCOPES;
    const redirectUri = buildReceiveRedirectUri(origin);

    // CSRF binding: nonce cookie + state param
    const nonce = crypto.randomBytes(16).toString("base64url");
    const state = toB64Url({ userId, businessId, returnTo, nonce });

    const authorize = new URL(XERO_AUTHORIZE_URL);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("scope", scopes);
    authorize.searchParams.set("state", state);
    // If you want to force the org picker each time:
    // authorize.searchParams.set("prompt", "consent");

    // Set short-lived nonce cookie, scoped to the receiver route
    const res = NextResponse.json({ authorizeUrl: authorize.toString() }, { status: 200 });
    res.cookies.set({
      name: NONCE_COOKIE,
      value: nonce,
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      path: "/api/xero/receive-xero-connection",
      maxAge: 60 * 5, // 5 minutes
    });
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err: any) {
    console.error("[/api/xero/connect-to-xero] error:", err?.stack || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
