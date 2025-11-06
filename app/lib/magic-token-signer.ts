// lib/magic-token-signer.ts
import "server-only";
import crypto from "crypto";

const SECRET = process.env.SEND_REVIEW_LINK_SECRET || "";

// Convert Buffer → base64url
function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * signMagicToken
 *
 * Creates a short-lived signed token that your email links will include.
 * Shape embedded in the token:
 *   { businessId: string, clientId: string, exp: number }
 *
 * Returns a string like "<body>.<sig>" where:
 *   body = base64url(JSON payload)
 *   sig  = base64url(HMAC_SHA256(secret, body))
 */
export function signMagicToken(args: {
  businessId: string;
  clientId: string;
  ttlSeconds?: number; // default 7 days
}): string {
  if (!SECRET) {
    throw new Error("LINK_SIGNING_SECRET is not set on the server");
  }

  const { businessId, clientId } = args;
  const ttlSeconds =
    typeof args.ttlSeconds === "number" && args.ttlSeconds > 0
      ? args.ttlSeconds
      : 60 * 60 * 24 * 7; // 7 days default

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;

  const payload = { businessId, clientId, exp };
  const json = JSON.stringify(payload);

  // bodyPart
  const bodyPart = toBase64Url(Buffer.from(json, "utf8"));

  // sigPart
  const sigBuf = crypto.createHmac("sha256", SECRET).update(bodyPart).digest();
  const sigPart = toBase64Url(sigBuf);

  return `${bodyPart}.${sigPart}`;
}
