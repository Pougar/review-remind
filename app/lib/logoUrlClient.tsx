"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { API } from "@/app/lib/constants";

type LogoUrlContextValue = {
  url: string | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const LogoUrlContext = createContext<LogoUrlContextValue | null>(null);

type FetchResp = { url: string | null; expiresIn?: number; expiresAt?: number | null };

async function fetchSigned(userId: string) {
  const res = await fetch(API.RETRIEVE_LOGO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("logo-url fetch failed");
  return (await res.json()) as FetchResp;
}

function addCacheBuster(u: string) {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://www.upreview.com.au";
    const url = new URL(u, base);
    url.searchParams.set("cb", String(Date.now()));
    return url.pathname + url.search + url.hash;
  } catch {
    // Fallback (best effort)
    return u + (u.includes("?") ? "&" : "?") + `cb=${Date.now()}`;
  }
}

/** Compute seconds until refresh from either expiresIn or expiresAt. */
function computeRefreshDelaySeconds(resp: FetchResp) {
  const now = Date.now();
  const ttl =
    typeof resp.expiresIn === "number"
      ? Math.max(0, resp.expiresIn)
      : typeof resp.expiresAt === "number" && resp.expiresAt
      ? Math.max(0, Math.floor(resp.expiresAt * 1000 - now) / 1000)
      : 300; // default 5min if server didn’t say
  // Refresh early but never after expiry; clamp to [5s, ttl-5s]
  return Math.max(5, Math.min(ttl - 5, Math.floor(ttl * 0.5)));
}

export function LogoUrlProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const schedule = useCallback((delaySec: number) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      void refresh(); // fire-and-forget
    }, Math.max(5, delaySec) * 1000);
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      setUrl(null);
      clearTimer();
      return;
    }
    setIsLoading(true);
    try {
      const resp = await fetchSigned(userId);
      if (resp.url) {
        setUrl(addCacheBuster(resp.url));
        schedule(computeRefreshDelaySeconds(resp));
      } else {
        setUrl(null);
        clearTimer();
      }
    } catch (e) {
      console.error("[LogoUrlProvider] failed to refresh signed URL:", e);
      // Retry gently after 30s
      schedule(30);
    } finally {
      setIsLoading(false);
    }
  }, [userId, schedule]);

  useEffect(() => {
    // when userId changes, clear existing timer and fetch a fresh URL
    clearTimer();
    void refresh();
    return clearTimer;
  }, [userId, refresh]);

  // Bonus: if tab becomes visible again, opportunistically refresh
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  return (
    <LogoUrlContext.Provider value={{ url, isLoading, refresh }}>
      {children}
    </LogoUrlContext.Provider>
  );
}

export function useLogoUrl() {
  const ctx = useContext(LogoUrlContext);
  if (!ctx) throw new Error("useLogoUrl must be used within <LogoUrlProvider>");
  return ctx;
}
