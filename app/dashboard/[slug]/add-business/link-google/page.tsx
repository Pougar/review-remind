// app/dashboard/[slug]/add-business/link-google/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";
import { API, ROUTES } from "@/app/lib/constants";

export default function LinkGooglePage() {
  const router = useRouter();
  const search = useSearchParams();
  const params = useParams();

  // [slug] is the USER slug
  const userSlug = useMemo(
    () => (Array.isArray(params?.slug) ? params!.slug[0] : (params?.slug as string)) || "",
    [params]
  );

  // Session
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id ?? "";

  // UI state
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const guardRef = useRef(false); // prevent duplicate “post-success” flows

  const disabled = isPending || !userId || checking || working;

  // --- API helpers ---
  const hasConnection = useCallback(async (): Promise<{ connected: boolean; scopeOk: boolean }> => {
    if (!userId) return { connected: false, scopeOk: false };
    setChecking(true);
    setStatusMsg("Checking Google connection…");
    try {
      const res = await fetch(
        `${API.GOOGLE_HAS_CONNECTION}?betterauth_id=${encodeURIComponent(userId)}`,
        { method: "GET", credentials: "include", cache: "no-store" }
      );
      const data = await res.json().catch(() => ({} as any));
      const connected = !!data?.connected;
      const scopeOk = !!data?.scopeOk;

      if (connected && scopeOk) {
        setStatusMsg("Google connected with Business Profile access ✓");
      } else if (connected) {
        setStatusMsg("Google connected — please grant Business Profile access.");
      } else {
        setStatusMsg("Not connected yet.");
      }
      return { connected, scopeOk };
    } catch (e: any) {
      setStatusMsg(e?.message || "Could not verify Google connection.");
      return { connected: false, scopeOk: false };
    } finally {
      setChecking(false);
    }
  }, [userId]);

  const createBusinessFromGoogle = useCallback(async (): Promise<{ businessId: string; slug: string } | null> => {
    setWorking(true);
    setStatusMsg("Creating your business from Google…");
    try {
      const r = await fetch(API.BUSINESSES_CREATE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ userId }),
      });
      if (r.status === 401) {
        setStatusMsg("Google token expired. Please reconnect Google.");
        return null;
      }
      if (r.status === 404) {
        setStatusMsg("No Google connection found for this account.");
        return null;
      }
      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        setStatusMsg(msg || "Failed to create business from Google.");
        return null;
      }
      const json = (await r.json().catch(() => ({}))) as { businessId?: string; slug?: string };
      if (!json.businessId || !json.slug) {
        setStatusMsg("Unexpected server response creating the business.");
        return null;
      }
      return { businessId: json.businessId, slug: json.slug };
    } finally {
      setWorking(false);
    }
  }, [userId]);

  const recordGoogleConnected = useCallback(async (businessId: string) => {
    try {
      await fetch(API.BUSINESS_GOOGLE_CONNECTED, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ businessId }),
      });
    } catch {
      /* non-fatal */
    }
  }, []);

  // After OAuth returns, we land here → check connection → create business → log action → redirect
  useEffect(() => {
    if (isPending || !userId || guardRef.current) return;

    (async () => {
      const { connected, scopeOk } = await hasConnection();
      if (!connected || !scopeOk) return;

      const created = await createBusinessFromGoogle();
      if (!created) return;

      guardRef.current = true; // avoid double runs (refresh/back)
      await recordGoogleConnected(created.businessId);

      // 🚀 include the business id in the link-xero URL
      const dest = `${ROUTES.DASHBOARD}/${encodeURIComponent(
        userSlug
      )}/add-business/link-xero?bid=${encodeURIComponent(created.businessId)}`;
      router.replace(dest);
    })();
  }, [isPending, userId, hasConnection, createBusinessFromGoogle, recordGoogleConnected, userSlug, router]);

  // Kick off OAuth
  const onConnect = useCallback(async () => {
    if (!userId) return;
    setStatusMsg("");
    const callbackURL =
      typeof window !== "undefined"
        ? window.location.href // come back to this page
        : `/dashboard/${encodeURIComponent(userSlug)}/add-business/link-google`;

    await authClient.linkSocial({
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/business.manage"],
      callbackURL,
    });
    // BetterAuth will redirect away and then back here.
  }, [userId, userSlug]);

  // If not signed in → send to /log-in with next back here
  useEffect(() => {
    if (!isPending && !userId) {
      const here =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : `/dashboard/${encodeURIComponent(userSlug)}/add-business/link-google`;
      router.replace(`${ROUTES.LOG_IN}?next=${encodeURIComponent(here)}`);
    }
  }, [isPending, userId, userSlug, router]);

  return (
    <div className="bg-white text-slate-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        {/* Brand */}
        <div className="mb-5">
          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            upreview
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Link your Google account</h1>
        <p className="mt-2 text-sm text-slate-600">
          Connect the Google account that owns or manages your Business Profile so we can securely
          fetch reviews and help you reply.
        </p>

        {/* Status */}
        <div className="mt-4 min-h-[1.25rem] text-sm" aria-live="polite">
          {statusMsg}
        </div>

        {/* Actions */}
        <div className="mt-6 space-y-4">
          <button
            type="button"
            onClick={onConnect}
            disabled={disabled}
            aria-disabled={disabled}
            className={`inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition
              ${disabled ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
          >
            Connect Google Business
          </button>

        {/* “Recheck” + back */}
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => void hasConnection()}
              disabled={disabled}
              className={`underline-offset-2 hover:underline ${
                disabled ? "text-slate-400 cursor-not-allowed" : "text-slate-700"
              }`}
            >
              {checking ? "Checking…" : "Recheck"}
            </button>

            <button
              type="button"
              onClick={() => router.push(`${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug)}`)}
              className="text-slate-700 underline-offset-4 hover:underline"
            >
              Back to dashboard
            </button>
          </div>

          <p className="pt-2 text-xs text-slate-500">
            We request the <code>business.manage</code> scope to list locations, read reviews, and manage replies.
            You can revoke access at any time.
          </p>
        </div>
      </div>
    </div>
  );
}
