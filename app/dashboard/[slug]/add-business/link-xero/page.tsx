// app/dashboard/[slug]/add-business/link-xero/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";
import { API, ROUTES } from "@/app/lib/constants";

const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

type Stage = "link_google" | "link-xero" | "onboarding" | "already_linked";

export default function LinkXeroPage() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();

  // user slug from route
  const slug = useMemo(
    () => (Array.isArray(params?.slug) ? params!.slug[0] : (params?.slug as string)) || "",
    [params]
  );

  // business id from query (?bid=…)
  const businessId = search.get("bid") ?? "";

  // After Xero is connected, where should we go?
  const nextDest = useMemo(
    () => `${ROUTES.DASHBOARD}/${encodeURIComponent(slug)}`,
    [slug]
  );

  // BetterAuth session
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id ?? "";

  // UI state
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [connectDisabled, setConnectDisabled] = useState(false);
  const navigatedRef = useRef(false); // prevent double navigations

  // ---------- Status variant (purely visual) ----------
  const statusVariant = useMemo(() => {
    if (!statusMsg) return "idle" as const;

    const msg = statusMsg.toLowerCase();

    if (checking || connectDisabled || msg.includes("checking xero connection")) {
      return "loading" as const;
    }

    if (msg.includes("xero connected ✓") || msg.startsWith("xero connected ✓")) {
      return "success" as const;
    }

    if (
      msg.includes("failed") ||
      msg.includes("could not") ||
      msg.includes("missing or invalid business id") ||
      msg.includes("missing authorize url") ||
      msg.includes("popup was blocked") ||
      msg.includes("error")
    ) {
      return "error" as const;
    }

    if (
      msg.includes("not connected to xero yet") ||
      msg.includes("once you've connected") ||
      msg.includes("return here and refresh")
    ) {
      return "warning" as const;
    }

    return "info" as const;
  }, [statusMsg, checking, connectDisabled]);

  // Map variant to Tailwind classes
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

  // --- helpers ---

  // Check current onboarding stage and route accordingly
  const checkStageAndRoute = useCallback(async () => {
    if (!isUUID(businessId)) return;

    try {
      const res = await fetch(API.CHECK_BUSINESS_STAGE, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });

      const data = (await res.json().catch(() => ({}))) as { stage?: Stage; error?: string };
      if (!res.ok) {
        setStatusMsg(data?.error || "Could not check onboarding stage.");
        return;
      }

      const stage = data.stage as Stage | undefined;
      if (!stage || navigatedRef.current) return;

      switch (stage) {
        case "link_google":
          navigatedRef.current = true;
          router.replace(
            `${ROUTES.DASHBOARD}/${encodeURIComponent(slug)}/add-business/link-google`
          );
          return;

        case "link-xero":
          // Stay here — this is the correct page.
          return;

        case "onboarding":
          navigatedRef.current = true;
          router.replace(
            `${ROUTES.DASHBOARD}/${encodeURIComponent(
              slug
            )}/add-business/business-details?bid=${encodeURIComponent(
              businessId
            )}`
          );
          return;

        case "already_linked": {
          try {
            const r = await fetch(API.GET_BUSINESS_SLUG, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              cache: "no-store",
              body: JSON.stringify({ businessId }),
            });
            const j = (await r.json().catch(() => ({}))) as { slug?: string };
            const bizSlug = j?.slug;
            navigatedRef.current = true;
            router.replace(
              bizSlug
                ? `${ROUTES.DASHBOARD}/${encodeURIComponent(
                    slug
                  )}/${encodeURIComponent(bizSlug)}`
                : nextDest
            );
          } catch {
            navigatedRef.current = true;
            router.replace(nextDest);
          }
          return;
        }
      }
    } catch (e: unknown) {
      setStatusMsg(
        e instanceof Error ? e.message : "Could not check onboarding stage."
      );
    }
  }, [businessId, router, slug, nextDest]);

  const checkConnection = useCallback(async () => {
    if (!userId || !businessId) return { connected: false, tenantCount: 0 };

    setChecking(true);
    setStatusMsg("Checking Xero connection…");
    try {
      const res = await fetch(API.XERO_HAS_CONNECTION, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, businessId }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        connected?: boolean;
        tenantCount?: number;
        error?: string;
      };

      const connected = !!data?.connected;
      const tenantCount = data?.tenantCount ?? 0;

      if (res.ok) {
        setStatusMsg(
          connected
            ? `Xero connected ✓ ${
                tenantCount
                  ? `(${tenantCount} org${tenantCount > 1 ? "s" : ""})`
                  : ""
              }`
            : "Not connected to Xero yet."
        );
      } else {
        setStatusMsg(
          data?.error || "Could not verify Xero connection."
        );
      }

      return { connected, tenantCount };
    } catch (e: unknown) {
      setStatusMsg(
        e instanceof Error
          ? e.message
          : "Could not verify Xero connection."
      );
      return { connected: false, tenantCount: 0 };
    } finally {
      setChecking(false);
    }
  }, [userId, businessId]);

  // On mount: auth guard + stage check; then if we remain on link-xero, also show connection status
  useEffect(() => {
    if (isPending) return;

    // auth guard
    if (!userId) {
      const here =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : `/dashboard/${encodeURIComponent(
              slug
            )}/add-business/link-xero?bid=${encodeURIComponent(
              businessId || ""
            )}`;
      router.replace(`${ROUTES.LOG_IN}?next=${encodeURIComponent(here)}`);
      return;
    }

    if (!isUUID(businessId)) {
      setStatusMsg("Missing or invalid business id.");
      return;
    }

    void (async () => {
      await checkStageAndRoute();
      if (!navigatedRef.current) {
        void checkConnection();
      }
    })();
  }, [
    isPending,
    userId,
    businessId,
    slug,
    checkStageAndRoute,
    checkConnection,
    router,
  ]);

  // Kick off Xero flow in a NEW TAB only
  const onConnect = useCallback(async () => {
    if (!userId || !isUUID(businessId)) return;
    setStatusMsg("");
    setConnectDisabled(true);

    try {
      const callback = `/dashboard/${encodeURIComponent(
        slug
      )}/add-business/business-details?bid=${encodeURIComponent(
        businessId
      )}`;

      const res = await fetch("/api/xero/connect-to-xero", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          businessId,
          callback,
        }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to start Xero connect.");
      }

      const { authorizeUrl } = (await res
        .json()
        .catch(() => ({}))) as { authorizeUrl?: string };

      if (!authorizeUrl) {
        throw new Error("Missing authorize URL from server.");
      }

      // Open ONLY in a new tab. Do NOT auto-redirect this tab.
      const newTab = window.open(authorizeUrl, "_blank");

      if (newTab) {
        newTab.opener = null;
        setStatusMsg(
          "Xero connection page opened in a new tab. Once you've connected, return here and refresh this page to update your status."
        );
      } else {
        setStatusMsg(
          "Popup was blocked. Please allow pop-ups for this site and try again, or open the Xero link manually."
        );
      }
    } catch (e: unknown) {
      setStatusMsg(
        e instanceof Error
          ? e.message
          : "Failed to start Xero connect."
      );
    } finally {
      setConnectDisabled(false);
    }
  }, [userId, businessId, slug]);

  const disabled =
    isPending ||
    !userId ||
    !isUUID(businessId) ||
    connectDisabled ||
    checking;

  return (
    <div className="text-slate-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        {/* Title & subtitle */}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Link your Xero account
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Connect your Xero organisation so we can securely fetch invoices and
          keep your client list in sync.
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
            className={`inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition ${
              disabled
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            Connect to Xero
          </button>

          <p className="pt-2 text-xs text-slate-500">
            You can revoke access at any time in Xero. We only read invoice
            metadata needed for your workflow.
          </p>
        </div>
      </div>
    </div>
  );
}
