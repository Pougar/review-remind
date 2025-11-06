"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useUser } from "@/app/lib/UserContext";
import { authClient } from "@/app/lib/auth-client";
import { API } from "@/app/lib/constants";
import ReviewsGraph from "@/app/ui/dashboard/ReviewsGraph";
import TutorialPanel from "@/app/ui/dashboard/TutorialPanel";
import BackgroundSea from "@/app/ui/background-sea";

/* ---------------- Types ---------------- */
type RecentReview = {
  review_id: string;
  client_id: string | null;
  client_name: string | null;
  is_primary: "google" | "internal";
  sentiment: boolean | null;
  stars: number | null;
  review: string;
  created_at: string | null;
  updated_at: string | null;
};

export default function DashboardPage() {
  const { name: userSlug, display } = useUser();
  const params = useParams() as { slug?: string; bslug?: string };
  const search = useSearchParams();

  const slug = params.slug ?? userSlug ?? "";
  const businessSlug = params.bslug ?? "";

  // Prefer explicit businessId from ?bid=… if present (nice to have during flows)
  const businessId = search.get("bid");

  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;

  // Tutorial modal state (always available via bottom button)
  const [showTutorial, setShowTutorial] = useState(false);

  // Banner state: hide when user is >= 1 week old
  const [hideTutorialBanner, setHideTutorialBanner] = useState(true);
  const bannerVisible = !hideTutorialBanner;

  // --- Resolve business_id from slug (if ?bid not provided) ---
  const [resolvedBusinessId, setResolvedBusinessId] = useState<string | null>(
    businessId
  );
  const [bizIdLoading, setBizIdLoading] = useState(false);
  const [bizIdErr, setBizIdErr] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !businessSlug) return;
    // If we already have ?bid, use it and skip resolution
    if (businessId) {
      setResolvedBusinessId(businessId);
      setBizIdErr(null);
      return;
    }

    let alive = true;
    (async () => {
      setBizIdLoading(true);
      setBizIdErr(null);
      try {
        const res = await fetch(API.GET_BUSINESS_ID_BY_SLUG, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, businessSlug }),
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          throw new Error(
            data?.message || `Failed to resolve business id (${res.status})`
          );
        }
        const id: string | undefined = data?.business_id || data?.id;
        if (!id) throw new Error("Could not resolve business id from slug.");
        if (alive) {
          setResolvedBusinessId(String(id));
          setBizIdErr(null);
        }
      } catch (e: any) {
        if (alive) {
          setBizIdErr(e?.message || "Failed to resolve business id.");
          setResolvedBusinessId(null);
        }
      } finally {
        if (alive) setBizIdLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [userId, businessSlug, businessId]);

  // --------- Fetch Business Display Name (via API.GET_BUS_NAME_FROM_ID) ---------
  const [bizName, setBizName] = useState<string>("");
  const [bizNameLoading, setBizNameLoading] = useState<boolean>(false);

  useEffect(() => {
    const bid = resolvedBusinessId || businessId;
    if (!bid) {
      setBizName("");
      return;
    }
    let alive = true;
    (async () => {
      try {
        setBizNameLoading(true);
        const res = await fetch(API.GET_BUS_NAME_FROM_ID, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ businessId: bid }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) throw new Error(data?.error || "Failed to fetch business name");
        const name =
          data?.display_name ??
          data?.name ??
          data?.business?.display_name ??
          data?.business?.name ??
          "";
        if (alive) setBizName(String(name || ""));
      } catch {
        if (alive) setBizName("");
      } finally {
        if (alive) setBizNameLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [resolvedBusinessId, businessId]);

  /* ----- Recent reviews (4 per page) ----- */
  const [recent, setRecent] = useState<RecentReview[]>([]);
  const [rvLoading, setRvLoading] = useState(true);
  const [rvErr, setRvErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 4;
  const totalPages = Math.max(1, Math.ceil(recent.length / pageSize));
  const visible = useMemo(
    () => recent.slice(page * pageSize, page * pageSize + pageSize),
    [recent, page]
  );

  // Trigger to force-refresh recent reviews after syncing Google
  const [refreshTick, setRefreshTick] = useState(0);

  /* ----- Fetch recent reviews (scoped to business) ----- */
  useEffect(() => {
    if (!userId || !businessSlug) return;
    let alive = true;

    (async () => {
      setRvLoading(true);
      setRvErr(null);
      try {
        const res = await fetch(API.REVIEWS_GET_RECENT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Prefer businessId (when available via ?bid=…), else send businessSlug.
          body: JSON.stringify(
            businessId
              ? { userId, businessId }
              : { userId, businessSlug }
          ),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Failed to load reviews (${res.status})`);

        const data = await res.json().catch(() => ({} as any));
        const list: RecentReview[] = Array.isArray(data?.reviews)
          ? data.reviews.map((r: any): RecentReview => ({
              review_id: String(r.review_id ?? ""),
              client_id: r.client_id ?? null,
              client_name:
                typeof r.client_name === "string" ? r.client_name : null,
              is_primary:
                (r.is_primary === "google" ? "google" : "internal") as
                  | "google"
                  | "internal",
              sentiment:
                typeof r.sentiment === "boolean" ? r.sentiment : null,
              stars: Number.isFinite(r.stars) ? Number(r.stars) : null,
              review: String(r.review ?? ""),
              created_at: r.created_at ?? null,
              updated_at: r.updated_at ?? null,
            }))
          : [];

        if (alive) {
          setRecent(list);
          setPage(0);
        }
      } catch (e: any) {
        if (alive) setRvErr(e?.message || "Failed to load recent reviews.");
      } finally {
        if (alive) setRvLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [userId, businessSlug, businessId, refreshTick]);

  /* ----- Sync Google reviews button state ----- */
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [syncOk, setSyncOk] = useState<string | null>(null);

  async function handleSyncReviews() {
    if (!userId) return;
    const bid = resolvedBusinessId || businessId;
    if (!bid) {
      setSyncErr("No business id available yet.");
      return;
    }

    setSyncing(true);
    setSyncErr(null);
    setSyncOk(null);

    try {
      const res = await fetch(API.GOOGLE_GET_REVIEWS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: bid }),
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        throw new Error(data?.message || `Failed to sync reviews (${res.status})`);
      }

      const n = Number.isFinite(data?.total_reviews_returned)
        ? Number(data.total_reviews_returned)
        : null;

      setSyncOk(
        n != null
          ? `Synced ${n} review${n === 1 ? "" : "s"} from Google.`
          : "Synced reviews from Google."
      );

      // Refresh recent reviews panel
      setRefreshTick((t) => t + 1);
    } catch (e: any) {
      setSyncErr(e?.message || "Failed to sync Google reviews.");
    } finally {
      setSyncing(false);
    }
  }

  const syncDisabled =
    !userId || !businessSlug || bizIdLoading || (!resolvedBusinessId && !businessId) || syncing;

  return (
    <div className="min-h-screen">
      <BackgroundSea />
      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-5">
        {/* -------- Inline Tutorial Banner (white card, above graph) -------- */}
        {bannerVisible && (
          <div className="mb-12">
            <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="font-medium">
                  Looks like your account is not even a week old!
                </span>{" "}
                Click the tutorial to get an introduction to Upreview.
              </div>
              <button
                type="button"
                onClick={() => setShowTutorial(true)}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                Open Tutorial
              </button>
            </div>
          </div>
        )}

        {/* -------------------------------- Graph -------------------------------- */}
        <section className="mb-4">
          <h2 className="text-center text-lg font-semibold tracking-tight text-gray-900">
            {bizNameLoading ? "…" : bizName || display || "Business"} Monthly Reviews
          </h2>
          <div className="mt-6">
            {/* Pass business context so analytics are business-scoped */}
            <ReviewsGraph userId={userId} businessSlug={businessSlug} months={12} />
          </div>
        </section>

        {/* Divider */}
        <div className="my-8 h-px w-full bg-gradient-to-r from-transparent via-gray-200 to-transparent" />

        {/* -------------------------------- Recent Reviews -------------------------------- */}
        <section aria-labelledby="recent-heading" className="mb-6">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2
              id="recent-heading"
              className="text-lg font-semibold tracking-tight text-gray-900"
            >
              Recent reviews
            </h2>

            <div className="flex items-center gap-2">
              {/* --- Get reviews from Google button --- */}
              <button
                type="button"
                onClick={handleSyncReviews}
                disabled={syncDisabled}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 ${
                  syncDisabled
                    ? "bg-indigo-300 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-400"
                }`}
                aria-label="Get reviews from Google"
                title={
                  bizIdLoading
                    ? "Resolving business…"
                    : !resolvedBusinessId && !businessId
                    ? "Business not resolved yet"
                    : "Fetch Google reviews"
                }
              >
                {syncing ? "Syncing…" : "Get reviews from Google"}
              </button>

              {/* Pagination controls */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={rvLoading || page === 0}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  aria-label="Previous page"
                >
                  ←
                </button>
                <span className="select-none text-sm text-gray-500">
                  Page {Math.min(page + 1, totalPages)} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={rvLoading || page >= totalPages - 1}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  aria-label="Next page"
                >
                  →
                </button>
              </div>
            </div>
          </div>

          {/* Inline status for business-id resolution + sync */}
          {(bizIdErr || syncErr || syncOk) && (
            <div className="mb-3">
              {bizIdErr && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {bizIdErr}
                </div>
              )}
              {syncErr && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {syncErr}
                </div>
              )}
              {syncOk && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  {syncOk}
                </div>
              )}
            </div>
          )}

          {rvLoading ? (
            <RecentReviewsSkeleton />
          ) : rvErr ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {rvErr}
            </div>
          ) : recent.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              No recent reviews yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {visible.map((r) => (
                <RecentReviewCard key={r.review_id} review={r} />
              ))}
            </div>
          )}
        </section>

        {/* -------- Persistent Tutorial Button (always visible) -------- */}
        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={() => setShowTutorial(true)}
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            Open Tutorial
          </button>
        </div>
      </main>

      {/* ---------------- Tutorial Modal ---------------- */}
      {showTutorial && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Upreview Tutorial"
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowTutorial(false);
          }}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowTutorial(false)}
          />
          <div className="relative z-10 w-full max-w-5xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {/* Personalize with the user's display name */}
                Welcome to Upreview{display ? `, ${display}` : ""}
              </h2>
              <button
                type="button"
                onClick={() => setShowTutorial(false)}
                className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {/* New TutorialPanel expects route context (slug + businessSlug) */}
            <TutorialPanel slug={slug} businessSlug={businessSlug} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Helpers ---------------- */
function RecentReviewsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ring-1 ring-black/5"
        >
          <div className="mb-2 h-4 w-2/3 rounded bg-gray-200" />
          <div className="mb-1 h-3 w-1/3 rounded bg-gray-200" />
          <div className="h-20 w-full rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

function SentimentChip({ v }: { v?: string | boolean | null }) {
  const s =
    typeof v === "string"
      ? v.trim().toLowerCase()
      : v === true
      ? "good"
      : v === false
      ? "bad"
      : "unreviewed";

  const styles =
    s === "good"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : s === "bad"
      ? "bg-rose-50 text-rose-700 ring-rose-200"
      : "bg-gray-50 text-gray-700 ring-gray-200";

  const label = s === "good" ? "Good" : s === "bad" ? "Bad" : "Unreviewed";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${styles}`}
    >
      {label}
    </span>
  );
}

function SourceBadge({ source }: { source: "google" | "internal" }) {
  const isGoogle = source === "google";
  const styles = isGoogle
    ? "bg-blue-50 text-blue-700 ring-blue-200"
    : "bg-gray-50 text-gray-700 ring-gray-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${styles}`}
    >
      {isGoogle ? "Google" : "Internal"}
    </span>
  );
}

function Stars({ value }: { value: number | null }) {
  if (value == null) return null;
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span aria-label={`${full} stars`} className="text-xs text-yellow-600">
      {"★".repeat(full)}
      {"☆".repeat(5 - full)}
    </span>
  );
}

function RecentReviewCard({ review }: { review: RecentReview }) {
  const dt = review.updated_at ?? review.created_at;
  const dateFmt = dt ? new Date(dt).toLocaleDateString() : "";
  const title =
    review.client_name ??
    (review.is_primary === "google" ? "Google review" : "Internal review");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ring-1 ring-black/5 transition hover:shadow-md">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="truncate text-sm font-medium text-gray-900" title={title}>
          {title}
        </div>
        <div className="flex items-center gap-1">
          <SourceBadge source={review.is_primary} />
          {review.sentiment !== null && <SentimentChip v={review.sentiment} />}
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span>{dateFmt}</span>
        <Stars value={review.stars} />
      </div>
      <p
        className="text-sm text-gray-800"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 6,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          whiteSpace: "pre-wrap",
        }}
        title={review.review}
      >
        {review.review}
      </p>
    </div>
  );
}
