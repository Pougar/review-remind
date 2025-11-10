// app/dashboard/[slug]/[bslug]/analytics/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import * as Recharts from "recharts";
import { authClient } from "@/app/lib/auth-client";
import { useUser } from "@/app/lib/UserContext";
import { API } from "@/app/lib/constants";
import BackgroundSea from "@/app/ui/background-sea";

/* ---------- Utils ---------- */
async function safeJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as unknown as T;
}

/* ---------- Types ---------- */
type ReviewCounts = { good: number; bad: number; unreviewed: number };

type EmailAnalyticsResp = {
  success?: boolean;
  metrics?: { emailSent?: number; reviewClicked?: number; reviewSubmitted?: number };
  error?: string;
};

type AvgEmailToClickResp = {
  success?: boolean;
  consideredClients?: number;
  avgSeconds?: number | null;
  error?: string;
};

type ExcerptPayload = {
  excerpt_id: string;
  excerpt: string;
  review_id: string | null;
  g_review_id: string | null;
  source: "internal" | "google" | null;
  created_at: string | null;
};

type PhrasePayload = {
  phrase_id: string;
  phrase: string;
  sentiment: "good" | "bad";
  counts?: number;
  total_count?: number;
  created_at?: string | null;
  good_count?: number;
  bad_count?: number;
  excerpts: ExcerptPayload[];
};

/* Raw shapes from GET_PHRASES_EXCERPTS (supports both old & new names) */
type RawExcerpt = {
  excerptId?: string;
  excerpt_id?: string;
  excerpt?: string | null;
  reviewId?: string | null;
  review_id?: string | null;
  gReviewId?: string | null;
  g_review_id?: string | null;
  source?: "internal" | "google" | null;
  updatedAt?: string | null;
  updated_at?: string | null;
};

type RawPhrase = {
  phraseId?: string;
  phrase_id?: string;
  phrase: string;
  counts?: number;
  total_count?: number;
  created_at?: string | null;
  updated_at?: string | null;    // 👈 add
  updatedAt?: string | null;     // 👈 add
  good_count?: number;
  bad_count?: number;
  sentiment?: "good" | "bad";
  excerpts?: RawExcerpt[];
};


type GetPhrasesResp = {
  success?: boolean;
  phrases?: RawPhrase[];
  error?: string;
};

type GetReviewResp = {
  success?: boolean;
  source?: "reviews" | "google_reviews";
  review?: {
    id: string;
    text: string | null;
    stars: number | null;
    reviewer_name?: string | null;
    created_at?: string | null;
  };
  error?: string;
};

type GraphPoint = [date: string, good: number, bad: number];
type GraphResp = { success?: boolean; points?: GraphPoint[]; error?: string };

const formatDateOnly = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";

/* ============================= PAGE ============================= */
export default function AnalyticsPage() {
  const router = useRouter();
  const params = useParams() as { slug?: string; bslug?: string };
  const slug = params.slug ?? "";
  const bslug = params.bslug ?? "";

  const { name: username } = useUser();
  const { data: session, isPending } = authClient.useSession();

  /* ---------- Business resolve ---------- */
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [bizLoading, setBizLoading] = useState(true);
  const [bizError, setBizError] = useState<string | null>(null);

  // business display name for header
  const [bizName, setBizName] = useState<string>("");
  const [bizNameLoading, setBizNameLoading] = useState<boolean>(false);

  // toggles for which series are visible
  const [showTotal, setShowTotal] = useState(true);
  const [showGood, setShowGood] = useState(true);
  const [showBad, setShowBad] = useState(true);

  /* ---------- Stats state ---------- */
  const [counts, setCounts] = useState<ReviewCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---------- Email analytics state ---------- */
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(0);
  const [reviewClicked, setReviewClicked] = useState(0);
  const [reviewSubmitted, setReviewSubmitted] = useState(0);

  // Avg email → click
  const [avgLoading, setAvgLoading] = useState(true);
  const [avgError, setAvgError] = useState<string | null>(null);
  const [avgSeconds, setAvgSeconds] = useState<number | null>(null);
  const [avgConsidered, setAvgConsidered] = useState<number>(0);

  /* ---------- Phrases/excerpts state ---------- */
  const [phrasesLoading, setPhrasesLoading] = useState(true);
  const [phrasesError, setPhrasesError] = useState<string | null>(null);
  const [phrases, setPhrases] = useState<PhrasePayload[]>([]);

  /* ---------- Excerpt generation state ---------- */
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  /* ---------- Review modal state ---------- */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalReview, setModalReview] = useState<GetReviewResp["review"] | null>(null);

  /* ---------- Graph state ---------- */
  const [granularity, setGranularity] = useState<"day" | "month">("day");
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphPoints, setGraphPoints] = useState<GraphPoint[]>([]);

  /* ---------- Excerpts popup state ---------- */
  const [popupPhraseId, setPopupPhraseId] = useState<string | null>(null);

  /* ---------- Effects: business resolve ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!bslug) throw new Error("Missing business slug");
        setBizLoading(true);
        setBizError(null);
        const res = await fetch(API.GET_BUSINESS_ID_BY_SLUG, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ businessSlug: bslug }),
        });
        if (res.status === 404) throw new Error("Business not found");
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(t || `Failed to resolve business (${res.status})`);
        }
        const data = await safeJson<{ id?: string }>(res);
        if (!data?.id) throw new Error("No business id in response");
        if (alive) setBusinessId(String(data.id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (alive) setBizError(msg || "Failed to resolve business");
      } finally {
        if (alive) setBizLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bslug]);

  // fetch business name once we know the id
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    (async () => {
      try {
        setBizNameLoading(true);
        const res = await fetch(API.GET_BUS_NAME_FROM_ID, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ businessId }),
        });
        const data = await safeJson<{
          error?: string;
          display_name?: string;
          name?: string;
          business?: { display_name?: string; name?: string };
        }>(res);
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
  }, [businessId]);

  useEffect(() => {
    if (!popupPhraseId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [popupPhraseId]);

  /* ---------- Helpers ---------- */
  const pct = useCallback((num: number, den: number) => {
    if (!den || den <= 0) return "0%";
    return `${Math.round((num / den) * 100)}%`;
  }, []);

  const renderStars = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return "—";
    const rounded = Math.round(n * 2) / 2;
    const full = Math.floor(rounded);
    const half = rounded - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(Math.max(0, empty));
  };

  const formatDayLabel = (iso: string) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const monthKey = (iso: string) => iso.slice(0, 7);
  const formatMonthLabel = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  };

  /* ---------- Fetchers (business-scoped) ---------- */
  const fetchReviewCounts = useCallback(async (bizId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API.GBU_COUNTS, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: bizId }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch review counts");
      const data = await safeJson<ReviewCounts>(res);
      setCounts({
        good: data.good ?? 0,
        bad: data.bad ?? 0,
        unreviewed: data.unreviewed ?? 0,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to load statistics");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEmailAnalytics = useCallback(async (bizId: string) => {
    setEmailLoading(true);
    setEmailError(null);
    try {
      const res = await fetch(API.EMAIL_ANALYTICS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: bizId }),
        cache: "no-store",
      });
      const data = await safeJson<EmailAnalyticsResp>(res);
      if (!res.ok || data?.error) throw new Error(data?.error || "Failed to fetch email analytics");
      const metrics = data?.metrics ?? {};
      setEmailSent(metrics.emailSent ?? 0);
      setReviewClicked(metrics.reviewClicked ?? 0);
      setReviewSubmitted(metrics.reviewSubmitted ?? 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setEmailError(msg || "Failed to load email analytics");
    } finally {
      setEmailLoading(false);
    }
  }, []);

  const fetchAvgEmailToClick = useCallback(async (bizId: string) => {
    setAvgLoading(true);
    setAvgError(null);
    try {
      const res = await fetch(API.AVG_EMAIL_TO_CLICK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ businessId: bizId }),
      });
      const data = await safeJson<AvgEmailToClickResp>(res);
      if (!res.ok || !data?.success) throw new Error(data?.error || "Failed to compute average");
      setAvgSeconds(typeof data.avgSeconds === "number" ? data.avgSeconds : null);
      setAvgConsidered(data.consideredClients ?? 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAvgError(msg || "Failed to load average time");
      setAvgSeconds(null);
      setAvgConsidered(0);
    } finally {
      setAvgLoading(false);
    }
  }, []);

  const fetchPhrases = useCallback(async (bizId: string) => {
    setPhrasesLoading(true);
    setPhrasesError(null);
    try {
      const res = await fetch(API.GET_PHRASES_EXCERPTS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ businessId: bizId }),
      });
      const data = await safeJson<GetPhrasesResp>(res);
      if (!res.ok || data?.error) throw new Error(data?.error || "Failed to fetch phrases");

      const raw = Array.isArray(data?.phrases) ? data!.phrases! : [];

      const items: PhrasePayload[] = raw.map((p, pIdx) => {
  const phraseId = p.phrase_id ?? p.phraseId ?? `phrase-${pIdx}`;
  const excerptsArray = Array.isArray(p.excerpts) ? p.excerpts : [];

  const excerpts: ExcerptPayload[] = excerptsArray.map((e, eIdx) => {
    const eid = e.excerpt_id ?? e.excerptId ?? `ex-${pIdx}-${eIdx}`;
    const reviewId = e.review_id ?? e.reviewId ?? null;
    const gReviewId = e.g_review_id ?? e.gReviewId ?? null;
    const source: "internal" | "google" | null =
      e.source ?? (gReviewId ? "google" : reviewId ? "internal" : null);

    return {
      excerpt_id: String(eid),
      excerpt: e.excerpt ?? "",
      review_id: reviewId,
      g_review_id: gReviewId,
      source,
      created_at: e.updated_at ?? e.updatedAt ?? null,
    };
  });

  return {
    phrase_id: String(phraseId),
    phrase: p.phrase,
    sentiment: p.sentiment === "bad" ? "bad" : "good",
    counts: p.counts ?? p.total_count,
    total_count: p.total_count ?? p.counts,
    created_at:
      p.created_at ??
      p.updated_at ??
      p.updatedAt ??
      null,
    good_count: p.good_count ?? 0,
    bad_count: p.bad_count ?? 0,
    excerpts,
  };
});


      setPhrases(items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhrasesError(msg || "Failed to load phrases.");
    } finally {
      setPhrasesLoading(false);
    }
  }, []);

  const fetchGraph = useCallback(async (bizId: string) => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const res = await fetch(API.GET_GRAPH_INFO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ businessId: bizId }),
      });
      const data = await safeJson<GraphResp>(res);
      if (!res.ok || !data?.success) throw new Error(data?.error || "Failed to load graph data.");
      setGraphPoints(Array.isArray(data.points) ? data.points : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGraphError(msg || "Failed to load graph data.");
      setGraphPoints([]);
    } finally {
      setGraphLoading(false);
    }
  }, []);

  /* ---------- Open excerpt -> fetch full review ---------- */
  const onOpenExcerpt = useCallback(
    async (ex: ExcerptPayload) => {
      if (!businessId) return;
      setModalOpen(true);
      setModalLoading(true);
      setModalError(null);
      setModalReview(null);

      try {
        const res = await fetch(API.ANALYTICS_GET_REVIEW, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            businessId,
            excerpt_id: ex.excerpt_id,
          }),
        });

        const data = await safeJson<GetReviewResp>(res);
        if (!res.ok || !data?.success || !data?.review) {
          throw new Error(data?.error || "Review not found");
        }
        setModalReview(data.review);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setModalError(msg || "Failed to load full review.");
      } finally {
        setModalLoading(false);
      }
    },
    [businessId]
  );

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalLoading(false);
    setModalError(null);
    setModalReview(null);
  }, []);

  /* ---------- Refresh all ---------- */
  const onRefresh = useCallback(async () => {
    if (!businessId || isPending) return;
    await Promise.all([
      fetchPhrases(businessId),
      fetchReviewCounts(businessId),
      fetchEmailAnalytics(businessId),
      fetchAvgEmailToClick(businessId),
      fetchGraph(businessId),
    ]);
  }, [businessId, isPending, fetchReviewCounts, fetchEmailAnalytics, fetchAvgEmailToClick, fetchPhrases, fetchGraph]);

  /* ---------- Generate excerpts (calls NEW make-excerpts) ---------- */
  const onFindExcerpts = useCallback(async () => {
    if (!businessId) return;
    setFindLoading(true);
    setFindError(null);
    try {
      const res = await fetch(API.MAKE_EXCERPTS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ businessId }), // ✅ new API: keyed by businessId
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Failed to generate excerpts (${res.status})`);
      }
      await fetchPhrases(businessId); // reload phrases+excerpts based on new generator
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFindError(msg || "Failed to generate excerpts.");
    } finally {
      setFindLoading(false);
    }
  }, [businessId, fetchPhrases]);

  /* ---------- Navigate to review-settings ---------- */
  const goToReviewSettings = useCallback(() => {
    const dest = username ? `/dashboard/${slug}/${bslug}/settings/review-settings` : "/settings/review-settings";
    router.push(dest);
  }, [router, username, slug, bslug]);

  /* ---------- Initial loads ---------- */
  useEffect(() => {
    if (isPending || bizLoading) return;
    if (bizError) return;
    if (!session?.user?.id) {
      setLoading(false);
      setEmailLoading(false);
      setPhrasesLoading(false);
      setGraphLoading(false);
      setAvgLoading(false);
      setError("You're not signed in.");
      setEmailError("You're not signed in.");
      setPhrasesError("You're not signed in.");
      setGraphError("You're not signed in.");
      setAvgError("You're not signed in.");
      return;
    }
    onRefresh();
  }, [session, isPending, onRefresh, bizLoading, bizError]);

  /* ---------- Derived ---------- */
  const chartData = useMemo(() => {
    const pts = graphPoints;
    type Row = { label: string; good: number; bad: number; total: number; key: string };
    let base: Row[] = [];

    if (pts.length === 0) return base;

    if (granularity === "day") {
      base = pts
        .slice()
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([d, good, bad]) => ({
          label: formatDayLabel(d),
          good,
          bad,
          total: good + bad,
          key: d,
        }));
    } else {
      const map = new Map<string, { good: number; bad: number }>();
      for (const [d, good, bad] of pts) {
        const k = monthKey(d);
        const prev = map.get(k) || { good: 0, bad: 0 };
        prev.good += good;
        prev.bad += bad;
        map.set(k, prev);
      }
      base = Array.from(map.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([ym, v]) => ({
          label: formatMonthLabel(ym),
          good: v.good,
          bad: v.bad,
          total: v.good + v.bad,
          key: ym,
        }));
    }

    // cumulative
    let g = 0;
    let b = 0;
    return base.map((row) => {
      g += Math.max(0, row.good || 0);
      b += Math.max(0, row.bad || 0);
      return { ...row, good: g, bad: b, total: g + b };
    });
  }, [graphPoints, granularity]);

  const goodPhrases = useMemo(() => phrases.filter((p) => p.sentiment === "good"), [phrases]);
  const badPhrases = useMemo(() => phrases.filter((p) => p.sentiment === "bad"), [phrases]);
  const activePhrase = useMemo(
    () => phrases.find((p) => p.phrase_id === popupPhraseId) || null,
    [phrases, popupPhraseId]
  );

  const refreshingTop =
    loading || emailLoading || findLoading || graphLoading || avgLoading;

  /* ---------- UI ---------- */
  if (bizLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="h-64 w-64 rounded-2xl bg-gray-100 animate-pulse" />
      </div>
    );
  }
  if (bizError) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{bizError}</div>;
  }
  if (loading && !counts) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="h-64 w-64 rounded-2xl bg-gray-100 animate-pulse" />
      </div>
    );
  }
  if (error && !counts) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{error}</div>;
  }

  return (
    <div className="min-h-screen w-full text-gray-900">
      <BackgroundSea />

      {/* Fixed left sidebar */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-48 shrink-0 border-r border-gray-100 bg-white">
        <div className="px-4 pt-8 pb-8 border-b border-gray-100" />
        <nav className="py-3">
          <ul className="flex flex-col">
            <SidebarLink label="Phrases & Excerpts" onClick={() => scrollToId("sec-phrases")} />
            <SidebarLink label="Reviews Over Time" onClick={() => scrollToId("sec-reviews")} />
            <SidebarLink label="Email Analytics" onClick={() => scrollToId("sec-email")} />
          </ul>
        </nav>
      </aside>

      {/* Main */}
      <div className="ml-48">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-gray-900">
                {bizNameLoading ? "Analytics" : `${bizName || "Analytics"} Analytics`}
              </h1>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshingTop || !businessId}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ring-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500
                ${
                  refreshingTop
                    ? "bg-gray-50 text-gray-400 ring-gray-200 cursor-not-allowed"
                    : "bg-white hover:bg-gray-50 text-gray-700 ring-gray-200"
                }`}
              aria-busy={refreshingTop}
            >
              {refreshingTop ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
                  </svg>
                  Refreshing…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 5V1L7 6l5 5V7c3.309 0 6 2.691 6 6a6 6 0 1 1-6-6z" />
                  </svg>
                  Refresh
                </>
              )}
            </button>
          </div>

          {/* Alerts */}
          {(findError || graphError) && (
            <div className="mb-6 space-y-2">
              {findError && <InlineAlert tone="error">{findError}</InlineAlert>}
              {graphError && <InlineAlert tone="warn">{graphError}</InlineAlert>}
            </div>
          )}

          {/* ================== PHRASES & EXCERPTS ================== */}
          <section id="sec-phrases" className="scroll-mt-28 mb-24">
            <SectionHeader title="Phrases & Excerpts" subtitle="Click a phrase to view real excerpts.">
              <div className="flex items-center gap-2">
                <Button
                  onClick={goToReviewSettings}
                  disabled={!session?.user?.id}
                  variant="primary"
                  label="Generate phrases"
                />
                <Button
                  onClick={onFindExcerpts}
                  disabled={!businessId || findLoading || phrases.length === 0}
                  variant="success"
                  label={findLoading ? "Generating…" : "Generate excerpts"}
                  loading={findLoading}
                />
              </div>
            </SectionHeader>

            {phrasesLoading && (
              <span className="text-xs text-gray-500">Loading…</span>
            )}

            {phrasesError ? (
              <div className="mt-2 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                {phrasesError}
              </div>
            ) : phrases.length === 0 ? (
              <div className="mt-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                No phrases yet. Click <strong>Generate phrases</strong>, then{" "}
                <strong>Generate excerpts</strong>.
              </div>
            ) : (
              <>
                {popupPhraseId && activePhrase && (
                  <ExcerptsCenteredModal
                    phrase={activePhrase}
                    onOpenExcerpt={onOpenExcerpt}
                    onClose={() => setPopupPhraseId(null)}
                  />
                )}

                {/* GOOD */}
                <div className="mb-8">
                  <div className="mb-2 text-sm font-semibold text-emerald-800">
                    Good
                  </div>
                  <ul className="divide-y divide-slate-200/70 bg-transparent supports-[backdrop-filter]:backdrop-contrast-125 supports-[backdrop-filter]:backdrop-brightness-105 supports-[backdrop-filter]:backdrop-saturate-110">
                    {goodPhrases.map((p, idx) => {
                      const mentioned =
                        p.counts ??
                        p.total_count ??
                        (p.good_count ?? 0) + (p.bad_count ?? 0);
                      const key = p.phrase_id || `${p.phrase}-${idx}`;
                      return (
                        <li
                          key={key}
                          className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm cursor-pointer transition-colors hover:bg-emerald-500/5"
                          onClick={() => setPopupPhraseId(p.phrase_id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ")
                              setPopupPhraseId(p.phrase_id);
                          }}
                        >
                          <div className="col-span-6 truncate font-medium text-gray-900">
                            {p.phrase}
                          </div>
                          <div className="col-span-3 text-gray-700 text-center sm:text-left">
                            mentioned {mentioned}{" "}
                            {mentioned === 1 ? "time" : "times"}
                          </div>
                          <div className="text-gray-600">
                            {formatDateOnly(p.created_at)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* BAD */}
                <div>
                  <div className="mb-2 text-sm font-semibold text-rose-800">
                    Bad
                  </div>
                  <ul className="divide-y divide-slate-200/70 bg-transparent supports-[backdrop-filter]:backdrop-contrast-125 supports-[backdrop-filter]:backdrop-brightness-105 supports-[backdrop-filter]:backdrop-saturate-110">
                    {badPhrases.map((p, idx) => {
                      const mentioned =
                        p.counts ??
                        p.total_count ??
                        (p.good_count ?? 0) + (p.bad_count ?? 0);
                      const key = p.phrase_id || `${p.phrase}-${idx}`;
                      return (
                        <li
                          key={key}
                          className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm cursor-pointer transition-colors hover:bg-rose-500/5"
                          onClick={() => setPopupPhraseId(p.phrase_id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ")
                              setPopupPhraseId(p.phrase_id);
                          }}
                        >
                          <div className="col-span-6 truncate font-medium text-gray-900">
                            {p.phrase}
                          </div>
                          <div className="col-span-3 text-gray-700 text-center sm:text-left">
                            mentioned {mentioned}{" "}
                            {mentioned === 1 ? "time" : "times"}
                          </div>
                          <div className="text-gray-600">
                            {formatDateOnly(p.created_at)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </section>

          {/* ================== REVIEWS OVER TIME ================== */}
          <section id="sec-reviews" className="scroll-mt-28 mb-24">
            <SectionHeader
              title="Reviews over time"
              controls={
                <div className="flex flex-wrap items-center gap-2">
                  {/* Granularity */}
                  <div className="inline-flex items-center rounded-lg bg-gray-50 p-1 ring-1 ring-gray-200">
                    {(["day", "month"] as const).map((g) => {
                      const active = granularity === g;
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGranularity(g)}
                          className={`px-3 py-1.5 text-sm font-medium rounded-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                            active
                              ? "bg-white shadow text-gray-900"
                              : "text-gray-600 hover:bg-white/60"
                          }`}
                        >
                          {g === "day" ? "Daily" : "Monthly"}
                        </button>
                      );
                    })}
                  </div>

                  {/* Series toggles */}
                  <div className="inline-flex items-center rounded-lg bg-gray-50 p-1 ring-1 ring-gray-200">
                    {[
                      {
                        key: "total",
                        label: "Total",
                        on: showTotal,
                        set: setShowTotal,
                        dot: "bg-black",
                        activeText: "text-gray-900",
                        ring: "ring-slate-200",
                      },
                      {
                        key: "good",
                        label: "Good",
                        on: showGood,
                        set: setShowGood,
                        dot: "bg-emerald-500",
                        activeText: "text-emerald-700",
                        ring: "ring-emerald-200",
                      },
                      {
                        key: "bad",
                        label: "Bad",
                        on: showBad,
                        set: setShowBad,
                        dot: "bg-rose-500",
                        activeText: "text-rose-700",
                        ring: "ring-rose-200",
                      },
                    ].map(({ key, label, on, set, dot, activeText, ring }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => set(!on)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                          on
                            ? `bg-white shadow ${activeText} ${ring}`
                            : "text-gray-600 hover:bg-white/60"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${dot} ${
                              on ? "" : "opacity-30"
                            }`}
                          />
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              }
            />

            {(() => {
              const AXIS = "#64748b";
              const GRID = "#e2e8f0";

              // Total (neutral)
              const LINE_TOTAL = "#0f172a";
              const AREA_TOTAL_TOP = "rgba(15, 23, 42, 0.14)";
              const AREA_TOTAL_BOT = "rgba(15, 23, 42, 0.04)";

              // Good = green
              const LINE_GOOD = "#16a34a"; // tailwind green-600
              const AREA_GOOD_TOP = "rgba(22, 163, 74, 0.18)";
              const AREA_GOOD_BOT = "rgba(22, 163, 74, 0.04)";

              // Bad = red
              const LINE_BAD = "#dc2626"; // tailwind red-600
              const AREA_BAD_TOP = "rgba(220, 38, 38, 0.18)";
              const AREA_BAD_BOT = "rgba(220, 38, 38, 0.04)";



              const maxVisible = chartData.reduce(
                (m, d) =>
                  Math.max(
                    m,
                    showTotal ? d.total : 0,
                    showGood ? d.good : 0,
                    showBad ? d.bad : 0
                  ),
                0
              );
              const yTarget = Math.ceil(maxVisible * 1.25);
              const yMax = Math.max(
                maxVisible + 1,
                Math.ceil(yTarget / 4) * 4
              );

              return (
                <div className="h-80 w-full overflow-hidden">
                  {graphLoading ? (
                    <div className="h-full w-full animate-pulse bg-gray-50/60" />
                  ) : chartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-gray-500">
                      No reviews yet.
                    </div>
                  ) : (
                    <Recharts.ResponsiveContainer
                      width="100%"
                      height="100%"
                    >
                      <Recharts.ComposedChart
                        data={chartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                      >
                        <Recharts.CartesianGrid
                          stroke={GRID}
                          vertical={false}
                        />
                        <Recharts.XAxis
                          dataKey="label"
                          tickMargin={8}
                          tickLine={false}
                          axisLine={{ stroke: GRID }}
                          tick={{ fill: AXIS, fontSize: 12 }}
                        />
                        <Recharts.YAxis
                          allowDecimals={false}
                          domain={[0, yMax]}
                          tick={{ fill: AXIS, fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          width={36}
                          tickMargin={12}
                        />
                        <Recharts.Tooltip
                          cursor={{ stroke: GRID }}
                          contentStyle={{
                            borderRadius: 12,
                            borderColor: GRID,
                          }}
                          formatter={(
                            value: number | string,
                            name: string
                          ) => [value, name] as [
                            number | string,
                            string
                          ]}
                          labelFormatter={(label: string) => label}
                        />
                        <defs>
                          <linearGradient
                            id="areaTotal"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={AREA_TOTAL_TOP}
                            />
                            <stop
                              offset="100%"
                              stopColor={AREA_TOTAL_BOT}
                            />
                          </linearGradient>
                          <linearGradient
                            id="areaGood"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={AREA_GOOD_TOP}
                            />
                            <stop
                              offset="100%"
                              stopColor={AREA_GOOD_BOT}
                            />
                          </linearGradient>
                          <linearGradient
                            id="areaBad"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={AREA_BAD_TOP}
                            />
                            <stop
                              offset="100%"
                              stopColor={AREA_BAD_BOT}
                            />
                          </linearGradient>
                        </defs>
                        {showTotal && (
                          <Recharts.Area
                            type="linear"
                            dataKey="total"
                            name="Total"
                            stroke={LINE_TOTAL}
                            strokeWidth={2}
                            dot={false}
                            fill="url(#areaTotal)"
                          />
                        )}
                        {showGood && (
                          <Recharts.Area
                            type="linear"
                            dataKey="good"
                            name="Good"
                            stroke={LINE_GOOD}
                            strokeWidth={2}
                            dot={false}
                            fill="url(#areaGood)"
                          />
                        )}
                        {showBad && (
                          <Recharts.Area
                            type="linear"
                            dataKey="bad"
                            name="Bad"
                            stroke={LINE_BAD}
                            strokeWidth={2}
                            dot={false}
                            fill="url(#areaBad)"
                          />
                        )}
                      </Recharts.ComposedChart>
                    </Recharts.ResponsiveContainer>
                  )}
                </div>
              );
            })()}
          </section>

          {/* ================== EMAIL ANALYTICS ================== */}
          <section id="sec-email" className="scroll-mt-28 mb-24">
            <SectionHeader
              title="Email analytics"
              subtitle="Basic funnel from send → click → review"
            />

            {(emailError || avgError) && (
              <div className="mb-4 space-y-2">
                {emailError && (
                  <InlineAlert tone="warn">{emailError}</InlineAlert>
                )}
                {avgError && (
                  <InlineAlert tone="warn">{avgError}</InlineAlert>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
              <MetricCard
                title="Emails Sent"
                numerator={emailSent}
                denominator={emailSent}
                computePct={(num) => (num > 0 ? "100%" : "0%")}
                loading={emailLoading}
                barClass="bg-blue-600"
                badgeClass="bg-blue-50 text-blue-800 ring-blue-200"
                label={`${emailSent}`}
              />
              <MetricCard
                title="Button Clicked"
                numerator={reviewClicked}
                denominator={emailSent}
                computePct={pct}
                loading={emailLoading}
                barClass="bg-indigo-600"
                badgeClass="bg-indigo-50 text-indigo-800 ring-indigo-200"
                label={`${reviewClicked} / ${emailSent}`}
              />
              <MetricCard
                title="Reviews Submitted"
                numerator={reviewSubmitted}
                denominator={reviewClicked}
                computePct={pct}
                loading={emailLoading}
                barClass="bg-emerald-600"
                badgeClass="bg-emerald-50 text-emerald-800 ring-emerald-200"
                label={`${reviewSubmitted} / ${reviewClicked}`}
              />
              <TimeStatCard
                title="Avg time to click"
                seconds={avgSeconds}
                loading={avgLoading}
                badgeText={`${avgConsidered} client${
                  avgConsidered === 1 ? "" : "s"
                }`}
              />
            </div>
          </section>
        </div>
      </div>

      {/* Full review modal */}
      {modalOpen && (
        <ReviewModal
          onClose={closeModal}
          loading={modalLoading}
          error={modalError}
          review={modalReview}
          renderStars={renderStars}
        />
      )}
    </div>
  );
}

/* ============================= UI PRIMITIVES ============================= */
function SidebarLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        className="w-full text-left relative flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        onClick={onClick}
      >
        {label}
      </button>
    </li>
  );
}

function InlineAlert({
  tone,
  children,
}: {
  tone: "error" | "warn";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "border-red-100 bg-red-50 text-red-700"
      : "border-amber-100 bg-amber-50 text-amber-800";
  return (
    <div className={`rounded-2xl border p-4 text-sm ${styles}`}>
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  controls,
  children,
}: {
  title: string;
  subtitle?: string;
  controls?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
      <div className="flex min-w-0 flex-col">
        <h2 className="text-base md:text-lg font-semibold tracking-tight text-gray-900">
          {title}
        </h2>
        {subtitle && (
          <span className="text-xs text-gray-500">{subtitle}</span>
        )}
      </div>
      {controls}
      {children}
    </div>
  );
}

function Button({
  onClick,
  disabled,
  variant = "primary",
  label,
  loading,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "success" | "neutral";
  label: string;
  loading?: boolean;
}) {
  const base =
    "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 transition";
  const variants: Record<string, string> = {
    primary:
      "text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300",
    success:
      "text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300",
    neutral:
      "text-gray-700 bg-white hover:bg-gray-50 ring-1 ring-gray-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]}`}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="4"
          />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="4"
          />
        </svg>
      )}
      {label}
    </button>
  );
}

/* ============================= MODALS ============================= */
function ExcerptsCenteredModal({
  phrase,
  onOpenExcerpt,
  onClose,
}: {
  phrase: PhrasePayload;
  onOpenExcerpt: (ex: ExcerptPayload) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) =>
      e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const isGood = phrase.sentiment === "good";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      aria-modal="true"
      role="dialog"
      aria-label={`Excerpts for ${phrase.phrase}`}
      onClick={onClose}
    >
      <div
        className="w-[680px] max-w-[94vw] max-h-[80vh] overflow-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-baseline gap-3 min-w-0">
            <h2 className="text-base md:text-lg font-semibold tracking-tight text-gray-900 truncate">
              {phrase?.phrase}
            </h2>
            <span className="text-xs text-gray-500 shrink-0">
              Click an excerpt to view the full review
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {phrase.excerpts.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            No excerpts yet for this phrase.
          </div>
        ) : (
          <ul className="space-y-2 pr-1">
            {phrase.excerpts.map((e) => {
              const wrap = isGood
                ? "border-emerald-100 bg-emerald-50/70 text-emerald-900"
                : "border-rose-100 bg-rose-50/80 text-rose-900";
              const badge = isGood
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-rose-50 text-rose-800 ring-rose-200";
              return (
                <li
                  key={e.excerpt_id}
                  className={`rounded-lg border px-3 py-2 text-xs ${wrap} cursor-pointer`}
                  onClick={() => onOpenExcerpt(e)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${badge}`}
                    >
                      {isGood ? "good" : "bad"}
                    </span>
                    {e.source === "google" && (
                      <span className="ml-auto inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-blue-200">
                        Google
                      </span>
                    )}
                  </div>
                  <p className="mt-1 leading-snug">{e.excerpt}</p>
                  {e.created_at && (
                    <p className="mt-1 text-[10px] text-gray-600">
                      {new Date(e.created_at).toLocaleString()}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ReviewModal({
  onClose,
  loading,
  error,
  review,
  renderStars,
}: {
  onClose: () => void;
  loading: boolean;
  error: string | null;
  review: GetReviewResp["review"] | null;
  renderStars: (n?: number | null) => string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Full review"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base md:text-lg font-semibold tracking-tight text-gray-900">
            Review details
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700">
            Loading full review…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !review ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700">
            No review found.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                <span className="font-medium">Reviewer:</span>{" "}
                {review.reviewer_name || "Anonymous"}
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {renderStars(review.stars)}{" "}
                {review.stars != null ? `(${review.stars})` : ""}
              </div>
            </div>
            {review.created_at && (
              <div className="text-xs text-gray-500">
                {new Date(review.created_at).toLocaleString()}
              </div>
            )}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 whitespace-pre-line">
              {review.text || "—"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================= METRIC & TIME CARDS ============================= */
function MetricCard({
  title,
  numerator,
  denominator,
  computePct,
  loading,
  barClass,
  badgeClass,
  label,
}: {
  title: string;
  numerator: number;
  denominator: number;
  computePct: (num: number, den: number) => string;
  loading: boolean;
  barClass: string;
  badgeClass: string;
  label: string;
}) {
  const pctText = computePct(numerator, denominator);
  const pctNum = parseInt(pctText, 10) || 0;

  return (
    <div className="bg-transparent p-5 text-left supports-[backdrop-filter]:backdrop-contrast-125 supports-[backdrop-filter]:backdrop-brightness-105 supports-[backdrop-filter]:backdrop-saturate-110">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-800">
          {title}
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ${badgeClass}`}
        >
          {label}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        {loading ? (
          <div className="h-2 w-1/2 animate-pulse bg-gray-200" />
        ) : (
          <div
            className={`h-2 ${barClass}`}
            style={{
              width: `${pctNum}%`,
              transition: "width 300ms ease",
            }}
          />
        )}
      </div>
      {!loading && (
        <div className="mt-2 text-xs text-gray-500">{pctText}</div>
      )}
    </div>
  );
}

function TimeStatCard({
  title,
  seconds,
  loading,
  badgeText,
}: {
  title: string;
  seconds: number | null;
  loading: boolean;
  badgeText?: string;
}) {
  const formatted = useMemo(
    () => formatDurationShort(seconds),
    [seconds]
  );
  return (
    <div className="bg-transparent p-5 text-left supports-[backdrop-filter]:backdrop-contrast-125 supports-[backdrop-filter]:backdrop-brightness-105 supports-[backdrop-filter]:backdrop-saturate-110">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-800">
          {title}
        </div>
        {badgeText && (
          <span className="rounded-full px-2 py-1 text-xs font-medium ring-1 bg-gray-50 text-gray-800 ring-gray-200">
            {badgeText}
          </span>
        )}
      </div>
      {loading ? (
        <div className="h-6 w-32 animate-pulse rounded bg-gray-200" />
      ) : (
        <div className="text-2xl font-semibold tracking-tight text-gray-900">
          {formatted}
        </div>
      )}
      {!loading && (
        <div className="mt-1 text-xs text-gray-500">
          Average delay from sending to first click
        </div>
      )}
    </div>
  );
}

function formatDurationShort(totalSeconds: number | null): string {
  if (totalSeconds == null || !isFinite(totalSeconds) || totalSeconds <= 0)
    return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/* ---------- Local helper ---------- */
function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
