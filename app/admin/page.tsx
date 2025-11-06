// app/admin/page.tsx
"use client";

import React, { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API } from "@/app/lib/constants";

export const dynamic = "force-dynamic";

type AdminAuthorizeResponse = { message?: string };

/* Wrap the hook user in Suspense to satisfy Next 15/React 19 */
export default function AdminGatePage() {
  return (
    <Suspense
      fallback={
        <main className="relative min-h-screen bg-gradient-to-b from-slate-50 via-white to-white">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-indigo-200/30 blur-3xl" />
            <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-sky-200/30 blur-3xl" />
          </div>
          <div className="relative mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-16">
            <section className="w-full rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-xl backdrop-blur-md">
              <div className="mx-auto mb-6 flex w-full max-w-md flex-col items-center text-center">
                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md">
                  <LockIcon />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                  Admin access
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Loading…
                </p>
              </div>
              <div className="mx-auto w-full max-w-md">
                <div className="h-10 w-full animate-pulse rounded-xl bg-slate-200" />
              </div>
            </section>
          </div>
        </main>
      }
    >
      <AdminGatePageInner />
    </Suspense>
  );
}

function AdminGatePageInner() {
  const qs = useSearchParams();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Sanitize the "next" target so we only ever navigate within this origin
  const nextTarget = useMemo(() => {
    const raw = qs.get("next") || "/";
    try {
      // Reject absolute URLs or protocol-relative URLs
      if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
      // Optional: avoid navigating back to /admin itself
      if (raw === "/admin") return "/";
      return raw;
    } catch {
      return "/";
    }
  }, [qs]);

  const unlock = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(API.AUTHORIZE_ADMIN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(code ? { code } : {}),
      });

      // Parse JSON safely without `any`
      let j: AdminAuthorizeResponse = {};
      try {
        j = (await r.json()) as unknown as AdminAuthorizeResponse;
      } catch {
        // non-JSON or empty body; ignore
      }

      if (!r.ok) {
        setMsg(j.message ?? "Not allowed.");
        return;
      }

      // Success: cookie set server-side; send them to the desired page
      window.location.assign(nextTarget);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : "Failed to unlock.";
      setMsg(errMsg);
    } finally {
      setBusy(false);
    }
  }, [code, nextTarget]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!busy) void unlock();
    },
    [busy, unlock]
  );

  return (
    <main className="relative min-h-screen bg-gradient-to-b from-slate-50 via-white to-white">
      {/* Decorative background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-indigo-200/30 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-sky-200/30 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-16">
        <section className="w-full rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-xl backdrop-blur-md">
          {/* Header */}
          <div className="mx-auto mb-6 flex w-full max-w-md flex-col items-center text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md">
              <LockIcon />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Admin access
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              We are currently in early access mode only
            </p>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="mx-auto mt-6 w-full max-w-md space-y-4">
            <label className="block" htmlFor="admin-code">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Admin code
              </span>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-slate-400">
                  <KeyIcon />
                </span>
                <input
                  id="admin-code"
                  type="password"
                  inputMode="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-300 bg-white px-10 py-2.5 text-sm text-slate-900 outline-none ring-0 transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                  autoComplete="one-time-code"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="group relative inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && (
                <span
                  aria-hidden
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                />
              )}
              {busy ? "Unlocking…" : "Unlock"}
            </button>
          </form>

          {/* Helper / redirect info */}
          <div className="mx-auto mt-5 w-full max-w-md text-xs text-slate-500">
            You’ll be redirected to{" "}
            <code className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px]">
              {nextTarget}
            </code>{" "}
            after unlocking.
          </div>

          {/* Server message */}
          {msg && (
            <div
              role="alert"
              aria-live="polite"
              className="mx-auto mt-4 flex w-full max-w-md items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"
            >
              <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center">
                <AlertIcon />
              </span>
              <span>{msg}</span>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* ============================ Icons ============================ */

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V8a5 5 0 0 1 10 0v3" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 2l-2 2" />
      <path d="M7.5 13.5L2 19v3h3l5.5-5.5" />
      <circle cx="15" cy="9" r="4" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}
