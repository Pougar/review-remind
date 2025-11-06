// app/api/admin/authorize/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/lib/auth";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---------- Config ---------- */
const ADMIN_LOCK_ENABLED = process.env.ADMIN_LOCK_ENABLED === "true";
const ADMIN_ALLOWLIST = (process.env.ADMIN_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const RAW_SECRET = process.env.ADMIN_SHARED_SECRET ?? "";
const ADMIN_SHARED_SECRET = RAW_SECRET.trim();

const ADMIN_COOKIE = "admin_ok";
const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours
const SECURE_COOKIE = process.env.NODE_ENV === "production";

/** ---------- Helpers ---------- */
function json<T>(data: T, init?: number | ResponseInit): NextResponse {
  const resInit: ResponseInit =
    typeof init === "number" ? { status: init } : (init ?? {});
  const headers = new Headers(resInit.headers);
  headers.set("content-type", "application/json");
  return new NextResponse(JSON.stringify(data), { ...resInit, headers });
}

function unlockedFromCookie(req: NextRequest): boolean {
  return req.cookies.get(ADMIN_COOKIE)?.value === "1";
}

// Constant-time compare when lengths match
function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function devHeaders(
  extras: Record<string, string | number | boolean>
): ResponseInit {
  if (process.env.NODE_ENV === "production") return {};
  // Don’t emit actual secrets; only lengths/flags
  const hdr = new Headers();
  for (const [k, v] of Object.entries(extras)) {
    hdr.set(`X-Admin-${k}`, String(v));
  }
  return { headers: hdr };
}

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

/** ---------- POST: unlock ---------- */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!ADMIN_LOCK_ENABLED) {
    return json({ ok: true, lock: "disabled" as const });
  }

  console.log(
    "[admin] lock:",
    process.env.ADMIN_LOCK_ENABLED,
    "secretLen:",
    (process.env.ADMIN_SHARED_SECRET || "").length,
    "nodeEnv:",
    process.env.NODE_ENV
  );

  const body = await readJson<{ code?: string }>(req);
  const submitted = typeof body?.code === "string" ? body.code.trim() : "";

  // Signed-in user allowlist
  const session = await auth.api.getSession({ headers: req.headers });
  const uid = session?.user?.id ?? null;
  const isAllowlisted = !!uid && ADMIN_ALLOWLIST.includes(uid);

  // Shared secret (only if configured)
  const hasSecretConfigured = ADMIN_SHARED_SECRET.length > 0;
  const codeMatches =
    hasSecretConfigured && submitted
      ? safeEquals(submitted, ADMIN_SHARED_SECRET)
      : false;

  if (!isAllowlisted && !codeMatches) {
    return json(
      { error: "FORBIDDEN", message: "Not allowed." },
      {
        status: 403,
        ...devHeaders({
          LockEnabled: true,
          HasSecretConfigured: hasSecretConfigured,
          SubmittedLen: submitted.length,
          SecretLen: ADMIN_SHARED_SECRET.length,
          Allowlisted: isAllowlisted,
        }),
      }
    );
  }

  const res = json(
    {
      ok: true,
      unlockedBy: (isAllowlisted ? "allowlist" : "code") as
        | "allowlist"
        | "code",
      userId: uid ?? null,
    },
    devHeaders({
      LockEnabled: true,
      UnlockedBy: isAllowlisted ? "allowlist" : "code",
    })
  );

  res.cookies.set(ADMIN_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIE,
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });

  return res;
}

/** ---------- GET: status ---------- */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!ADMIN_LOCK_ENABLED) {
    return json(
      { lock: "disabled" as const, unlocked: true },
      devHeaders({ LockEnabled: false })
    );
  }
  const unlocked = unlockedFromCookie(req);

  // Also reflect allowlist status (non-sensitive)
  const session = await auth.api.getSession({ headers: req.headers });
  const uid = session?.user?.id ?? null;
  const isAllowlisted = !!uid && ADMIN_ALLOWLIST.includes(uid);

  return json(
    {
      lock: "enabled" as const,
      unlocked,
      allowlisted: isAllowlisted,
      hasSecretConfigured: ADMIN_SHARED_SECRET.length > 0,
    },
    devHeaders({
      LockEnabled: true,
      Unlocked: unlocked,
      Allowlisted: isAllowlisted,
      HasSecretConfigured: ADMIN_SHARED_SECRET.length > 0,
      SecretLen: ADMIN_SHARED_SECRET.length,
    })
  );
}

/** ---------- DELETE: clear cookie (re-lock this browser) ---------- */
export async function DELETE(): Promise<NextResponse> {
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIE,
    path: "/",
    maxAge: 0,
  });
  return res;
}
