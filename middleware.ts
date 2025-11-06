// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** -------- Existing paths (kept) -------- */
const PATH_LOG_IN = "/log-in";
const PATH_SIGN_UP = "/sign-up";
const PATH_DASH = "/dashboard";

/** -------- Admin lock config -------- */
const ADMIN_LOCK_ENABLED = process.env.ADMIN_LOCK_ENABLED === "true";
const ADMIN_COOKIE = "admin_ok";              // must be set to "1" by your /admin flow
const PATH_ADMIN = "/admin";                  // public admin gate page
const ADMIN_UNLOCK_API = "/api/admin/authorize";

/** -------- Utility: BetterAuth cookie check (as you had it) -------- */
function hasBetterAuthCookie(req: NextRequest) {
  const all = req.cookies.getAll();
  return all.some(
    (c) =>
      c.name.includes("better-auth") &&
      c.name.endsWith("session_token")
  );
}

/** -------- Utility: routes that should bypass the admin lock -------- */
function isPublicForAdminLock(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (p === "/") return true;                 // homepage stays open
  if (p === PATH_ADMIN) return true;          // admin unlock page stays open
  // static & framework assets:
  if (p.startsWith("/_next")) return true;
  if (p.startsWith("/static")) return true;
  if (p.startsWith("/images")) return true;
  if (p === "/favicon.ico" || p === "/robots.txt" || p === "/sitemap.xml") return true;
  return false;
}

/** -------- Admin lock check -------- */
function checkAdminUnlocked(req: NextRequest) {
  return req.cookies.get(ADMIN_COOKIE)?.value === "1";
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
    if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return NextResponse.next();
  }
  /** 1) Admin lock first: protect everything except homepage & /admin */
  if (ADMIN_LOCK_ENABLED && !isPublicForAdminLock(req)) {
    const unlocked = checkAdminUnlocked(req);
    if (!unlocked) {
      // APIs get JSON 401 instead of redirect
      if (pathname.startsWith("/api")) {
        if (pathname === ADMIN_UNLOCK_API) return NextResponse.next();
        return new NextResponse(JSON.stringify({ error: "SITE_LOCKED" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      // Pages: redirect to /admin with ?next=<original path + search>
      const url = req.nextUrl.clone();
      url.pathname = PATH_ADMIN;
      const desired = pathname + (search || "");
      url.searchParams.set("next", desired);
      return NextResponse.redirect(url);
    }
  }

  /** 2) Your existing behavior (unchanged) */
  const loggedIn = hasBetterAuthCookie(req);
  const isDash = pathname.startsWith(PATH_DASH);
  const isAuthPage = pathname === PATH_LOG_IN || pathname === PATH_SIGN_UP;

  // Protect /dashboard/**
  if (isDash && !loggedIn) {
    const url = new URL(PATH_LOG_IN, req.url);
    url.searchParams.set("next", pathname + (search || ""));
    return NextResponse.redirect(url);
  }

  // Optional: auto-redirect away from auth pages if logged in
  if (isAuthPage && loggedIn) {
    const url = new URL(PATH_DASH, req.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * Matcher: run on (almost) everything so the admin lock can gate the site.
 * Exclude obvious static buckets for performance.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|images|static|public).*)",
  ],
};
