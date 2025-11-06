// app/dashboard/[slug]/add-business/layout.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams, useParams } from "next/navigation";

/**
 * Steps:
 * 1) Link Google
 * 2) Link Xero
 * 3) Confirm Details
 */
const STEP_LABELS = ["Link Google", "Link Xero", "Confirm Details"] as const;
type StageApi =
  | "link_google"      // no rows for this business yet
  | "link-xero"        // google_connected only
  | "onboarding"       // google_connected + xero_connected
  | "already_linked";  // all actions present (incl. onboarded)

function inferIndexFromPath(pathname?: string | null): number {
  if (!pathname) return 1;
  if (pathname.includes("/link-google")) return 1;
  if (pathname.includes("/link-xero")) return 2;
  if (pathname.includes("/business-details")) return 3;
  return 1;
}

export default function AddBusinessLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const search = useSearchParams();

  const slug = useMemo(
    () => (Array.isArray(params?.slug) ? params!.slug[0] : (params?.slug as string)) || "",
    [params]
  );
  const bid = useMemo(() => search.get("bid") ?? "", [search]);

  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doCheck = useCallback(async () => {
    // If there is no business yet, we’re at step 1 (Link Google).
    // Don’t call the API; just ensure we’re on /link-google.
    if (!bid) {
      if (!pathname?.includes("/link-google")) {
        router.replace(`/dashboard/${encodeURIComponent(slug)}/add-business/link-google`);
      }
      return;
    }

    setChecking(true);
    setErr(null);
    try {
      const res = await fetch("/api/business-actions/check-onboarding-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ businessId: bid }),
      });

      const data = (await res.json().catch(() => ({}))) as { stage?: StageApi };
      if (!res.ok || !data?.stage) return;

      const go = (p: string) => {
        if (!pathname?.startsWith(p)) router.replace(p);
      };

      switch (data.stage) {
        case "link_google":
          go(`/dashboard/${encodeURIComponent(slug)}/add-business/link-google`);
          break;
        case "link-xero":
          go(`/dashboard/${encodeURIComponent(slug)}/add-business/link-xero?bid=${encodeURIComponent(bid)}`);
          break;
        case "onboarding":
          go(`/dashboard/${encodeURIComponent(slug)}/add-business/business-details?bid=${encodeURIComponent(bid)}`);
          break;
        case "already_linked":
          go(`/dashboard/${encodeURIComponent(slug)}`);
          break;
        default:
          break;
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not check onboarding stage.");
    } finally {
      setChecking(false);
    }
  }, [bid, pathname, router, slug]);

  useEffect(() => {
    void doCheck();
  }, [doCheck]);

  const currentIdx = useMemo(() => inferIndexFromPath(pathname), [pathname]); // 1-based

  // Cancel target
  const cancelHref = slug ? `/dashboard/${encodeURIComponent(slug)}` : "/dashboard";

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto max-w-6xl w-full px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3">
            {/* Left: Brand */}
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                upreview
              </span>
              <span className="hidden sm:inline text-xs text-slate-500">Business onboarding</span>
            </div>

            {/* Right: Cancel + (mobile) progress text */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push(cancelHref)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                Cancel
              </button>
              <div className="sm:hidden text-xs font-medium text-slate-700">
                {checking ? "Checking…" : `Step ${currentIdx} of ${STEP_LABELS.length}`}
              </div>
            </div>
          </div>

          <div className="pb-3">
            <Stepper current={currentIdx} labels={[...STEP_LABELS]} />
            <p className="mt-1 hidden sm:block text-center text-xs font-medium text-slate-600" aria-live="polite">
              {checking
                ? "Checking…"
                : err
                ? "Couldn’t verify progress — you can continue."
                : `Step ${currentIdx} of ${STEP_LABELS.length}`}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}

function Stepper({ current, labels }: { current: number; labels: readonly string[] }) {
  const total = labels.length;
  const clamped = Math.max(1, Math.min(current, total));
  const ratio = total <= 1 ? 1 : (clamped - 1) / (total - 1);

  return (
    <div className="relative">
      <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-1 rounded-full bg-slate-200" />
      <div
        className="absolute left-4 top-1/2 -translate-y-1/2 h-1 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 transition-[width]"
        style={{ width: `calc(${ratio * 100}% - 0rem)` }}
      />
      <div
        className="relative mx-4"
        style={{ display: "grid", gridTemplateColumns: `repeat(${total}, minmax(0,1fr))`, gap: "0.5rem" }}
      >
        {labels.map((label, idx) => {
          const step = idx + 1;
          const state = step < clamped ? "complete" : step === clamped ? "current" : "upcoming";
          const badgeBase =
            "flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ring-2 transition";
          const badgeStyles =
            state === "complete"
              ? "bg-emerald-600 text-white ring-emerald-300 shadow-sm"
              : state === "current"
              ? "bg-blue-600 text-white ring-blue-300 shadow-sm"
              : "bg-slate-200 text-slate-600 ring-slate-300";
          return (
            <div key={label} className="flex flex-col items-center gap-1 py-1 text-center">
              <div className={`${badgeBase} ${badgeStyles}`} aria-current={state === "current" ? "step" : undefined}>
                {step}
              </div>
              <span className="line-clamp-1 text-[11px] text-slate-600">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
