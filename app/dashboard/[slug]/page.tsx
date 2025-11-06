// app/dashboard/[slug]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/app/lib/auth-client";
import { ROUTES, API } from "@/app/lib/constants";
import BackgroundSea from "@/app/ui/background-sea";

/* ========= Types ========= */
/* include created_at and allow display_name to be null (server may return null) */
type Business = { id: string; slug: string; display_name: string | null; created_at: string };

/* ======================== Tiny review UI (faint) ======================== */
function Star({ className = "", size = 12 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} width={size} height={size}>
      <path
        d="M10 1.5l2.7 5.48 6.05.88-4.38 4.27 1.03 6.02L10 15.85 4.6 18.15l1.03-6.02L1.25 7.86l6.05-.88L10 1.5z"
        fill="currentColor"
      />
    </svg>
  );
}
function Stars5({ size = 12, className = "text-amber-500/70" }: { size?: number; className?: string }) {
  return (
    <div className="flex items-center gap-0.5" aria-label="5 out of 5 stars">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={className} size={size} />
      ))}
    </div>
  );
}
function FaintReviewCard({
  author,
  text,
  rating = 5,
  className = "",
}: {
  author: string;
  text: string;
  rating?: 4 | 5;
  className?: string;
}) {
  return (
    <div
      className={`w-[210px] rounded-xl bg-white/90 px-3 py-2 shadow-lg ring-1 ring-black/5 backdrop-blur-[1px] ${className}`}
    >
      <div className="flex items-center justify-between">
        <Stars5 />
        <span className="text-[10px] text-gray-500">{rating.toFixed(1)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-800">{text}</p>
      <div className="mt-1 text-[10px] text-gray-500">— {author}</div>
    </div>
  );
}

/* ======================== Sprinkled reviews BACKDROP ======================== */
function ReviewsSprinklesBackdrop() {
  const cards = [
    { a: "Priya N.",  t: "So easy to book and lovely team.",        top: "10%", left: "12%", rot: "rotate-[4deg]"  },
    { a: "Mark L.",   t: "Five stars! Clear explanations.",         top: "20%", left: "58%", rot: "-rotate-[3deg]" },
    { a: "Amelia R.", t: "Professional from start to finish.",      top: "35%", left: "27%", rot: "rotate-[7deg]"  },
    { a: "Hassan K.", t: "Great value; excellent communication.",   top: "46%", left: "66%", rot: "-rotate-[2deg]" },
    { a: "Sofia D.",  t: "On-time and super helpful.",              top: "60%", left: "18%", rot: "-rotate-[6deg]" },
    { a: "James O.",  t: "Listened and explained everything.",      top: "70%", left: "58%", rot: "rotate-[2deg]"  },
    { a: "Hannah L.", t: "Modern equipment, comfy experience.",     top: "14%", left: "76%", rot: "rotate-[10deg]" },
    { a: "Diego A.",  t: "Quick turnaround — recommend!",           top: "38%", left: "6%",  rot: "-rotate-[9deg]" },
    { a: "Maya C.",   t: "Clean clinic and easy booking.",          top: "78%", left: "9%",  rot: "rotate-[1deg]"  },
    { a: "Luca B.",   t: "Follow-up care was fantastic.",           top: "82%", left: "70%", rot: "-rotate-[3deg]" },
  ];

  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 hidden md:block"
        style={{ zIndex: -5 }}
        aria-hidden="true"
      >
        <div className="absolute inset-0">
          {cards.slice(0, 4).map((c, i) => (
            <div
              key={`far-${i}`}
              className={`absolute blur-[8px] opacity-40 ${c.rot} animate-float-slow`}
              style={{ top: c.top, left: c.left }}
            >
              <FaintReviewCard author={c.a} text={c.t} className="scale-[0.98]" />
            </div>
          ))}
        </div>
        <div className="absolute inset-0">
          {cards.slice(4).map((c, i) => (
            <div
              key={`near-${i}`}
              className={`absolute blur-[5px] opacity-65 ${c.rot} animate-float-med`}
              style={{ top: c.top, left: c.left }}
            >
              <FaintReviewCard author={c.a} text={c.t} className="scale-[1.02]" />
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes floaty {
          0%, 100% { transform: translateY(0) }
          50% { transform: translateY(-6px) }
        }
        .animate-float-slow { animation: floaty 9s ease-in-out infinite; }
        .animate-float-med  { animation: floaty 7s ease-in-out infinite; }
      `}</style>
    </>
  );
}

/* ========= Date formatting (AU, localised, stable TZ) ========= */
const dateFmt = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Australia/Sydney",
});
function formatAdded(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/* ======================== PAGE ======================== */
export default function DashboardSlugClientPage() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;

  const params = useParams();
  const router = useRouter();

  // [slug] is the *user* slug
  const userSlugRaw = params?.slug;
  const userSlug = Array.isArray(userSlugRaw) ? userSlugRaw[0] : (userSlugRaw as string);

  const [loading, setLoading] = useState(true);
  const [biz, setBiz] = useState<Business[]>([]);
  const [error, setError] = useState<string>("");

  const [displayName, setDisplayName] = useState<string>("");

  const linkGoogleHref = `${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug || "")}/add-business/link-google`;
  const userSettingsHref = `${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug || "")}/user-settings`;

  // Fetch username for greeting
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const r = await fetch(API.GET_USERNAME, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (r.ok) {
          const data = (await r.json()) as { username?: string };
          if (data?.username) setDisplayName(data.username);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [userId]);

  // Fetch businesses once we have a userId
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) {
        setLoading(false);
        setError("You’re not signed in.");
        const next = encodeURIComponent(`${ROUTES.DASHBOARD}/${userSlug || ""}`);
        router.replace(`${ROUTES.LOG_IN}?next=${next}`);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const r = await fetch(API.BUSINESSES_LIST, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        });

        if (cancelled) return;

        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(txt || "Failed to load businesses.");
        }

        // Expect created_at to be present (ISO string)
        const data = (await r.json()) as { businesses?: Business[] };
        setBiz(data.businesses ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not load businesses.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (userSlug) load();
    return () => {
      cancelled = true;
    };
  }, [router, userId, userSlug]);

  const goToBusiness = (bizSlug: string) => {
    if (!bizSlug) return;
    router.push(`${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug)}/${encodeURIComponent(bizSlug)}`);
  };

  const greetingName =
    displayName || session?.user?.name || (session?.user?.email ? session.user.email.split("@")[0] : "there");

  return (
    <main className="min-h-screen">
      <BackgroundSea />
      <ReviewsSprinklesBackdrop />

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-10">
        {/* Top row: Title + actions */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Hi {greetingName}, choose a business to manage
            </h1>
            <p className="mt-1 text-sm text-slate-600">Select an existing business, or add a new one.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={userSettingsHref}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-md ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            >
              User settings
            </Link>
          </div>
        </div>

        {/* Content */}
        <section className="mt-8">
          {/* Loading & error states */}
          {loading ? (
            <div className="py-8 text-sm text-slate-600">Loading your businesses…</div>
          ) : error ? (
            <div
              className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              role="alert"
            >
              {error}
            </div>
          ) : biz.length === 0 ? (
            <>
              {/* Get started bubble only when there are no businesses */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h2 className="text-sm font-semibold text-amber-900">Get started</h2>
                <p className="mt-1 text-sm text-amber-900/90">Add a business to start pulling reviews and insights.</p>
              </div>

              {/* Centered Add button in empty state */}
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => router.push(linkGoogleHref)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  Add new business
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Table only (no outer card) — increased contrast */}
              <div className="overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-300">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50/90">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
                      <th className="px-4 py-3">Business</th>
                      <th className="px-4 py-3">Slug</th>
                      <th className="px-4 py-3">Date Added</th>{/* NEW */}
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {biz.map((b) => (
                      <tr
                        key={b.id}
                        className="group cursor-pointer hover:bg-slate-50/80"
                        onClick={() => goToBusiness(b.slug)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            goToBusiness(b.slug);
                          }
                        }}
                        role="button"
                        aria-label={`Open ${b.display_name || b.slug}`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-900">
                          {b.display_name || b.slug}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">{b.slug}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">
                          {formatAdded(b.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center text-sm font-medium text-slate-400">→</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Centered Add button below the table */}
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => router.push(linkGoogleHref)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  Add new business
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
