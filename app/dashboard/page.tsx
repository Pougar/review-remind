// app/dashboard/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";
import { ROUTES, API } from "@/app/lib/constants";


/* ======================== NEW: Site background ======================== */
function BackgroundSea() {
  // fixed, covers entire viewport; very pale blue gradient + blurred blobs
  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      {/* base gentle vertical gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-50 via-sky-50/70 to-white" />
      {/* soft blurred shapes (like distant sea/light) */}
      <div className="absolute -top-24 -left-32 h-80 w-80 rounded-full bg-sky-200/35 blur-3xl" />
      <div className="absolute top-40 -right-24 h-72 w-72 rounded-full bg-indigo-200/30 blur-3xl" />
      <div className="absolute bottom-[-6rem] left-1/3 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-200/25 blur-[90px]" />
      {/* subtle grain for depth (very faint) */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-multiply"
        style={{
          backgroundImage:
            "radial-gradient(transparent 0, rgba(0,0,0,.07) 100%)",
          backgroundSize: "2px 2px",
        }}
      />
    </div>
  );
}


export default function DashboardLandingPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [status, setStatus] = useState("Redirecting you to your dashboard…");
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  // Attempt to resolve slug then redirect
  async function resolveAndRedirect() {
    if (running.current) return;
    running.current = true;
    setError(null);

    try {
      const userId = session?.user?.id;
      const email  = session?.user?.email;

      if (!userId) {
        // No session → go to login with next back to /dashboard
        router.replace(`${ROUTES.LOG_IN}?next=${encodeURIComponent(ROUTES.DASHBOARD)}`);
        return;
      }

      setStatus("Looking up your account…");

      // 1) Try /api/get-name (expects { id } and returns { name / slug })
      const r = await fetch(API.GET_NAME, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ id: userId }),
      });

      let slug: string | undefined;

      if (r.ok) {
        const j: any = await r.json().catch(() => ({}));
        slug =
          j?.user?.name ??
          j?.name ??
          j?.user?.slug ??
          j?.slug;
      }

      // 2) Fallback: if no slug from get-name, try by email (if available)
      if (!slug && email) {
        setStatus("Resolving dashboard address…");
        const r2 = await fetch(API.GET_MY_SLUG_BY_EMAIL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ email }),
        });
        if (r2.ok) {
          const j2: any = await r2.json().catch(() => ({}));
          slug =
            j2?.user?.name ??
            j2?.name ??
            j2?.user?.slug ??
            j2?.slug;
        }
      }

      if (slug) {
        router.replace(`${ROUTES.DASHBOARD}/${encodeURIComponent(slug)}`);
        return;
      }

      // Couldn’t resolve
      setError("We couldn’t find your dashboard slug.");
      setStatus(" ");
    } catch (e: any) {
      setError(e?.message || "Unexpected error while resolving your dashboard.");
      setStatus(" ");
    } finally {
      running.current = false;
    }
  }

  useEffect(() => {
    if (isPending) return;
    void resolveAndRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, session?.user?.id, session?.user?.email]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <BackgroundSea />
      <div className="text-center text-sm text-slate-700">
        <div className="mb-2">{status}</div>
        {!status.trim() && (
          <>
            {error && <div className="mb-4 text-amber-800">{error}</div>}
            <button
              onClick={() => void resolveAndRedirect()}
              className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </main>
  );
}
