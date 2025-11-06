// lib/magic-token.ts
import crypto from "crypto";

const SECRET = process.env.SEND_REVIEW_LINK_SECRET || "";

/**
 * Decode a base64url string -> Buffer
 * (base64url means "-" instead of "+", "_" instead of "/", and no padding)
 */
function base64UrlToBuf(str: string): Buffer {
  // Add padding if needed
  const padLen = str.length % 4;
  const pad =
    padLen === 2 ? "==" :
    padLen === 3 ? "="  :
    padLen === 1 ? "===" :
    "";
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

/**
 * verifyMagicToken
 *
 * This MUST mirror signLinkToken() from /api/send-bulk-emails:
 *
 *   const payloadObj = { businessId, clientId, exp };
 *   const payloadJson = JSON.stringify(payloadObj);
 *
 *   const sig = HMAC_SHA256(SECRET, payloadJson).digest("base64url");
 *
 *   const token = base64url(payloadJson) + "." + sig;
 *
 * We check:
 *   - token is well formed
 *   - signature matches
 *   - payload.businessId === businessId
 *   - payload.clientId === clientId
 *   - payload.exp not expired
 *
 * Special case: clientId === "test"
 *   We allow this through without checking token at all. This supports
 *   your demo /submit-review/test flow.
 */
export function verifyMagicToken({
  token,
  businessId,
  clientId,
}: {
  token: string;
  businessId: string;
  clientId: string;
}): {
  ok: true;
  payload: { businessId: string; clientId: string; exp: number };
} | {
  ok: false;
  error: string;
} {
  // 0. fail-fast config
  if (!SECRET) {
    return { ok: false, error: "Server misconfigured: no SEND_REVIEW_LINK_SECRET" };
  }

  // 1. Special bypass for demo client "test"
  //    (no token required, no checks)
  if (clientId === "test") {
    return {
      ok: true,
      payload: {
        businessId,
        clientId,
        exp: Date.now() + 10 * 60 * 1000, // arbitrary future for shape
      },
    };
  }

  // 2. Basic shape check
  const [b64payload, sigPart] = (token || "").split(".");
  if (!b64payload || !sigPart) {
    return { ok: false, error: "Malformed token" };
  }

  // 3. Decode payload JSON string from the first part
  let payloadJson: string;
  try {
    payloadJson = base64UrlToBuf(b64payload).toString("utf8");
  } catch {
    return { ok: false, error: "Bad base64" };
  }

  // 4. Recompute expected signature EXACTLY like signLinkToken:
  //    HMAC(secret, payloadJson).digest("base64url")
  const expectedSig = crypto
    .createHmac("sha256", SECRET)
    .update(payloadJson)
    .digest("base64url");

  if (sigPart !== expectedSig) {
    return { ok: false, error: "Bad signature" };
  }

  // 5. Parse the JSON payload now that signature matches
  let payloadObj: { businessId: string; clientId: string; exp: number };
  try {
    payloadObj = JSON.parse(payloadJson);
  } catch {
    return { ok: false, error: "Bad payload" };
  }

  // 6. Business/client match check
  if (
    payloadObj.businessId !== businessId ||
    payloadObj.clientId !== clientId
  ) {
    return { ok: false, error: "Token mismatch" };
  }

  // 7. Expiry check.
  //    signLinkToken currently sets exp = Date.now() + 7days (ms since epoch).
  //    But to be defensive, we also allow "seconds since epoch".
  const nowMs = Date.now();
  const expRaw = payloadObj.exp;
  const expMs = expRaw > 1e12 ? expRaw : expRaw * 1000; // if it's too small, assume seconds
  if (nowMs > expMs) {
    return { ok: false, error: "Token expired" };
  }

  return {
    ok: true,
    payload: {
      businessId: payloadObj.businessId,
      clientId: payloadObj.clientId,
      exp: expRaw,
    },
  };
}
