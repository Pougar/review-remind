// app/dashboard/[slug]/add-business/link-google/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";
import { API, ROUTES } from "@/app/lib/constants";

type HasConnectionResp = {
  connected?: boolean;
  scopeOk?: boolean;
};

export default function LinkGooglePage() {
  const router = useRouter();
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

  // Derive a visual style for the status message (purely presentational)
  const statusVariant = useMemo(() => {
    if (!statusMsg) return "idle" as const;

    const msg = statusMsg.toLowerCase();

    if (checking || working || msg.includes("checking") || msg.includes("creating your business")) {
      return "loading" as const;
    }

    if (msg.includes("✓") || msg.includes("connected with business profile access")) {
      return "success" as const;
    }

    if (
      msg.includes("expired") ||
      msg.includes("failed") ||
      msg.includes("could not") ||
      msg.includes("unexpected server response")
    ) {
      return "error" as const;
    }

    if (
      msg.includes("not connected yet") ||
      msg.includes("please reconnect") ||
      msg.includes("please grant") ||
      msg.includes("no google connection found")
    ) {
      return "warning" as const;
    }

    return "info" as const;
  }, [statusMsg, checking, working]);

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

      let data: HasConnectionResp;
      try {
        data = (await res.json()) as HasConnectionResp;
      } catch {
        data = {};
      }

      const connected = !!data.connected;
      const scopeOk = !!data.scopeOk;

      if (connected && scopeOk) {
        setStatusMsg("Google connected with Business Profile access ✓");
      } else if (connected) {
        setStatusMsg("Google connected — please grant Business Profile access.");
      } else {
        setStatusMsg("Not connected yet.");
      }
      return { connected, scopeOk };
    } catch (e: unknown) {
      setStatusMsg(e instanceof Error ? e.message : "Could not verify Google connection.");
      return { connected: false, scopeOk: false };
    } finally {
      setChecking(false);
    }
  }, [userId]);

  const createBusinessFromGoogle = useCallback(
    async (): Promise<{ businessId: string; slug: string } | null> => {
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
    },
    [userId]
  );

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
  }, [
    isPending,
    userId,
    hasConnection,
    createBusinessFromGoogle,
    recordGoogleConnected,
    userSlug,
    router,
  ]);

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

  // Map variant to Tailwind classes (visual only)
  const statusClasses = useMemo(() => {
    switch (statusVariant) {
      case "loading":
        return "border-blue-200 bg-blue-50 text-blue-700";
      case "success":
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "error":
        return "border-red-200 bg-red-50 text-red-700";
      case "warning":
        return "border-amber-200 bg-amber-50 text-amber-800";
      case "info":
        return "border-slate-200 bg-slate-50 text-slate-700";
      default:
        return "";
    }
  }, [statusVariant]);

  return (
    <div className="text-slate-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Link your Google account
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Connect the Google account that owns or manages your Business Profile so we can securely
          fetch reviews and help you reply.
        </p>

        {/* Status */}
        <div className="mt-4 min-h-[2.75rem]" aria-live="polite">
          {statusMsg && statusVariant !== "idle" && (
            <div
              className={`inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-xs sm:text-sm shadow-sm ${statusClasses}`}
            >
              {/* Icon / spinner */}
              {statusVariant === "loading" && (
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-current border-t-transparent"
                  aria-hidden="true"
                />
              )}
              {statusVariant === "success" && (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white text-[0.6rem]">
                  ✓
                </span>
              )}
              {statusVariant === "error" && (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white text-[0.6rem]">
                  !
                </span>
              )}
              {statusVariant === "warning" && (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white text-[0.6rem]">
                  !
                </span>
              )}
              {statusVariant === "info" && (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-400 text-white text-[0.6rem]">
                  i
                </span>
              )}

              <span className="truncate">{statusMsg}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 space-y-4">
          <button
            type="button"
            onClick={onConnect}
            disabled={disabled}
            aria-disabled={disabled}
            className={`inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition
              ${
                disabled
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
          >
            Connect Google Business
          </button>

          <p className="pt-2 text-xs text-slate-500">
            We request the <code>business.manage</code> scope to list locations, read reviews, and
            manage replies. You can revoke access at any time.
          </p>
        </div>
      </div>
    </div>
  );
}
