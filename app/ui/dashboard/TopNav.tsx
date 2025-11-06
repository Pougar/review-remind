"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import clsx from "clsx";
import { authClient } from "@/app/lib/auth-client";
import { useLogoUrl } from "@/app/lib/logoUrlClient";
import { ROUTES, NAV_ITEMS, APP_NAME } from "@/app/lib/constants";

/* ============================================================
   Helpers
============================================================ */

type LogoInput =
  | string
  | null
  | undefined
  | {
      url?: string;
      signedUrl?: string;
      isLoading?: boolean;
      loading?: boolean;
      error?: unknown;
    };

function resolveLogo(input: unknown): {
  url: string | null;
  isLoading: boolean;
  error: unknown | null;
} {
  if (typeof input === "string" || input == null) {
    return { url: (input as string) ?? null, isLoading: false, error: null };
  }

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const url =
      typeof obj.url === "string"
        ? (obj.url as string)
        : typeof obj.signedUrl === "string"
        ? (obj.signedUrl as string)
        : null;

    const isLoading =
      typeof obj.isLoading === "boolean"
        ? (obj.isLoading as boolean)
        : typeof obj.loading === "boolean"
        ? (obj.loading as boolean)
        : false;

    const error = (obj && "error" in obj ? (obj.error as unknown) : null) ?? null;

    return { url, isLoading, error };
  }

  return { url: null, isLoading: false, error: null };
}

function isActive(pathname: string, target: string, opts?: { strict?: boolean }) {
  if (opts?.strict) return pathname === target;
  return pathname === target || pathname.startsWith(target + "/");
}

function titleFromSlug(slug?: string) {
  if (!slug) return "Business";
  try {
    const s = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
    return s.replace(/\b\w/g, (m) => m.toUpperCase());
  } catch {
    return slug;
  }
}

/**
 * Safely unwrap BetterAuth client session to get userId.
 */
async function fetchUserIdFromClientSession(): Promise<string | null> {
  try {
    const sess = await authClient.getSession();
    // Narrow various possible shapes:
    const maybe =
      (sess as { data?: { user?: { id?: string | null } } } | null) ?? null;
    const id = maybe?.data?.user?.id;
    return typeof id === "string" && id.trim() ? id : null;
  } catch {
    return null;
  }
}

/* ============================================================
   Component
============================================================ */

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  // Route params like /dashboard/[slug]/[bslug]/...
  const params = useParams() as { slug?: string; bslug?: string };
  const slug = params.slug ?? "";
  const businessSlug = params.bslug ?? "";

  // Avatar/logo (must not call hooks conditionally)
  const rawLogo = useLogoUrl();
  const {
    url: resolvedLogoUrl,
    isLoading: logoLoading,
    error: logoError,
  } = useMemo(() => resolveLogo(rawLogo as LogoInput), [rawLogo]);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Avatar dropdown menu state
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /* ------------------------------------------------------------
     Basic effects
  ------------------------------------------------------------ */
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    setAvatarUrl(resolvedLogoUrl ?? null);
  }, [resolvedLogoUrl]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onDocClick);
    }
    return () => {
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // (Optional) If you need userId later, keep this; otherwise remove it entirely.
  // Here we keep it but do not surface it to avoid "assigned but unused" warning.
  useEffect(() => {
    let alive = true;
    (async () => {
      const _uid = await fetchUserIdFromClientSession();
      if (!alive) return;
      // no-op for now
      void _uid;
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ------------------------------------------------------------
     Open Switch Business (navigate to the dashboard root for user)
  ------------------------------------------------------------ */
  function openSwitchModal() {
    setOpen(false);
    router.push(`/dashboard/${slug}`);
  }

  /* ------------------------------------------------------------
     Sign out
  ------------------------------------------------------------ */
  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push(ROUTES.LOG_IN),
      },
    });
  };

  /* ------------------------------------------------------------
     Derived values for render
  ------------------------------------------------------------ */
  const brandHref = ROUTES.DASHBOARD_HOME(slug, businessSlug);
  const businessName = titleFromSlug(businessSlug);

  const navLinks = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        key: item.key,
        label: item.label,
        href: item.href(slug, businessSlug),
      })),
    [slug, businessSlug]
  );

  /* ============================================================
     Render
============================================================ */

  return (
    <>
      {/* Top bar */}
      <header
        className="fixed inset-x-0 top-0 z-50 border-b border-sky-200/40 bg-sky-50/10
             shadow-[0_10px_30px_-15px_rgba(2,6,23,0.35)]
             supports-[backdrop-filter]:bg-sky-50/5
             supports-[backdrop-filter]:backdrop-blur-md
             supports-[backdrop-filter]:backdrop-brightness-105
             supports-[backdrop-filter]:backdrop-saturate-100"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-stretch px-6">
          {/* Left side: App + Business name */}
          <div className="flex items-center gap-3 pr-6">
            <Link
              href="/"
              className="text-sm font-semibold text-gray-500 hover:text-gray-900"
            >
              {APP_NAME}
            </Link>
            <span className="h-5 w-px bg-gray-200" />
            <Link
              href={brandHref}
              className="flex max-w-[260px] items-center gap-2"
            >
              <span className="truncate text-base font-semibold text-gray-800">
                {businessName}
              </span>
            </Link>
          </div>

          {/* Center nav */}
          <nav className="flex items-stretch gap-0 overflow-hidden">
            {navLinks.map((l) => {
              const isHome = l.href === brandHref;
              const active = isActive(pathname, l.href, { strict: isHome });
              return (
                <Link
                  key={l.key}
                  href={l.href}
                  className={clsx(
                    "flex items-center px-6 text-base font-medium transition-colors",
                    "text-gray-700 hover:bg-sky-200/40 hover:text-gray-900",
                    active && "bg-sky-100/60 text-sky-800"
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>

          {/* Right side: avatar dropdown */}
          <div className="ml-auto flex items-center">
            <div ref={menuRef} className="relative" onKeyDown={handleKeyDown}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={clsx(
                  "flex h-[50px] w-[50px] items-center justify-center rounded-full border bg-white transition",
                  open
                    ? "border-blue-300 ring-2 ring-blue-400 ring-offset-2 ring-offset-zinc-50"
                    : "border-gray-200 hover:ring-2 hover:ring-blue-300/50 hover:ring-offset-0 hover:ring-offset-zinc-50",
                  "focus:outline-none"
                )}
                title="Account menu"
              >
                {logoLoading && !avatarUrl ? (
                  <div className="h-9 w-9 animate-pulse rounded-full bg-gray-200" />
                ) : avatarUrl ? (
                  <div className="h-9 w-9 overflow-hidden rounded-full bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarUrl}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = "/snakepic.png";
                      }}
                      alt="Business logo"
                    />
                  </div>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-6 w-6 text-gray-500"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M12 12a5 5 0 1 0-5-5a5 5 0 0 0 5 5Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z"
                    />
                  </svg>
                )}
              </button>

              {open && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
                >
                  {/* Business settings link */}
                  <Link
                    role="menuitem"
                    href={ROUTES.DASHBOARD_BUSINESS_SETTINGS(slug, businessSlug)}
                    className={clsx(
                      "block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50",
                      isActive(
                        pathname,
                        ROUTES.DASHBOARD_BUSINESS_SETTINGS(slug, businessSlug),
                        { strict: true }
                      ) && "bg-blue-50 text-blue-700"
                    )}
                    onClick={() => setOpen(false)}
                  >
                    Business settings
                  </Link>

                  {/* Switch business button */}
                  <button
                    role="menuitem"
                    type="button"
                    onClick={openSwitchModal}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Switch business
                  </button>

                  {/* Sign out */}
                  <button
                    role="menuitem"
                    type="button"
                    onClick={handleSignOut}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Sign out
                  </button>

                  {logoError ? (
                    <div className="px-4 py-2 text-xs text-red-600/80">
                      Couldn’t load logo.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
