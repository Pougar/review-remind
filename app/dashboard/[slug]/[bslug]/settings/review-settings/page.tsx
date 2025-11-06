// app/dashboard/[slug]/[bslug]/settings/review-settings/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";
import { API } from "@/app/lib/constants";

/* ============================ Types ============================ */
type Sentiment = "good" | "bad";

type ExcerptItem = {
  excerpt_id: string;
  excerpt: string;
  sentiment: Sentiment; // derived from `happy` in the API
  review_id: string | null;
  g_review_id: string | null;
  is_unlinked_google: boolean;
  created_at: string | null;
};

type PhraseWithExcerpts = {
  phrase_id: string;
  phrase: string;
  sentiment: Sentiment; // "good" | "bad"
  total_count: number;
  created_at: string | null;
  excerpts: ExcerptItem[];
};

type GetPhrasesExcerptsResp = {
  success?: boolean;
  businessId?: string;
  count?: number;
  phrases?: PhraseWithExcerpts[];
  error?: string;
};

/* Generate new phrases */
type GenerateNewPhrasesResp = {
  success?: boolean;
  businessId?: string;
  input_count?: number;
  suggested_count?: number;
  existing_skipped?: number;
  new_phrases?: { phrase: string; counts: number; sentiment?: Sentiment }[];
  usage?: unknown;
  error?: string;
};

/* Add / save phrases */
type AddPhrasesResp = {
  success?: boolean;
  businessId?: string;
  inserted?: { id: string; phrase: string; counts: number }[];
  updated?: { id: string; phrase: string; counts: number }[];
  skipped_invalid?: number;
  requested?: number;
  error?: string;
};

/* Delete */
type DeleteResp = {
  success?: boolean;
  businessId?: string;
  phrase_id?: string;
  deleted_excerpts?: number;
  error?: string;
};

/* For business lookup */
type BusinessIdLookupResp = {
  id?: string;
  display_name?: string | null;
};

type BusinessDetailsResp = {
  id?: string;
  display_name?: string | null;
};

/* ============================ Helpers ============================ */
function titleCase(s: string): string {
  // Light title case for display pills.
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((tok) => {
      if (tok.trim() === "" || tok === "-") return tok;
      const first = tok.charAt(0).toUpperCase();
      return first + tok.slice(1);
    })
    .join("");
}

function parsePhrasesInput(raw: string): string[] {
  // Split on newlines or commas; trim; dedupe (case-insensitive)
  const parts = raw
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

// Typed JSON helper to avoid implicit any from Response.json()
async function safeJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

/* ============================ Component ============================ */
export default function ReviewSettingsPage() {
  const params = useParams() as { slug?: string; bslug?: string };
  const bslug = params.bslug ?? "";

  // We still read session so the client can avoid trying actions before auth is known,
  // but we no longer pass userId to the API. The server uses session+RLS internally.
  const { isPending } = authClient.useSession();

  /* ---------- Business context ---------- */
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>("Business");

  /* ---------- Page state ---------- */
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Full list of phrases (and their excerpts) for this business
  const [phrases, setPhrases] = useState<PhraseWithExcerpts[]>([]);

  /* Add phrase state */
  const [newGoodPhraseInput, setNewGoodPhraseInput] = useState("");
  const [newBadPhraseInput, setNewBadPhraseInput] = useState("");
  const [addingGood, setAddingGood] = useState(false);
  const [addingBad, setAddingBad] = useState(false);
  const [addGoodMsg, setAddGoodMsg] = useState<string | null>(null);
  const [addBadMsg, setAddBadMsg] = useState<string | null>(null);
  const [addGoodIsError, setAddGoodIsError] = useState(false);
  const [addBadIsError, setAddBadIsError] = useState(false);

  const goodInputRef = useRef<HTMLInputElement | null>(null);
  const badInputRef = useRef<HTMLInputElement | null>(null);

  /* Delete state */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deleteIsError, setDeleteIsError] = useState(false);

  /* Generate new phrases modal state */
  const [genOpen, setGenOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    { phrase: string; counts: number; chosen: boolean; sentiment?: Sentiment }[]
  >([]);

  /* Accept generated phrases state */
  const [accepting, setAccepting] = useState(false);
  const [acceptMsg, setAcceptMsg] = useState<string | null>(null);
  const [acceptIsError, setAcceptIsError] = useState(false);

  /* ============================ Business lookup ============================ */

  // Step 1: resolve { businessId, display_name? } from the slug in the URL.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(API.GET_BUSINESS_ID_BY_SLUG, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ businessSlug: bslug }),
        });

        const data = await safeJson<BusinessIdLookupResp>(res);
        if (!alive) return;

        if (res.ok && data?.id) {
          setBusinessId(data.id);
          const fallbackName =
            (data.display_name && data.display_name.trim()) ||
            (bslug && bslug.trim()) ||
            "Business";
          setBusinessName(fallbackName);
        } else {
          setBusinessId(null);
          setBusinessName(bslug || "Business");
          setLoadError("Could not find this business.");
          setLoading(false);
        }
      } catch {
        if (!alive) return;
        setBusinessId(null);
        setBusinessName(bslug || "Business");
        setLoadError("Network error while resolving business.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [bslug]);

  // Step 2: get canonical display_name from business details using businessId (and also good
  // to confirm we're allowed to access this business via RLS).
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(API.BUSINESSES_GET_DETAILS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ businessId }),
        });
        const data = await safeJson<BusinessDetailsResp>(res);
        if (!alive) return;
        if (res.ok && data?.display_name) {
          setBusinessName(data.display_name.trim() || businessName);
        }
        // If not ok, we keep fallback name. RLS errors etc. would show up later anyway.
      } catch {
        /* Non-fatal: leave fallback name. */
      }
    })();
    return () => {
      alive = false;
    };
  }, [businessId, businessName]);

  /* ============================ Fetch phrases+excerpts for this business ============================ */

  const fetchBusinessPhrases = useCallback(
    async (bid: string) => {
      setLoading(true);
      setLoadError(null);

      try {
        const res = await fetch(API.GET_PHRASES_EXCERPTS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ businessId: bid }),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(
            txt || `Failed to load review phrases (${res.status})`
          );
        }

        const data = await safeJson<GetPhrasesExcerptsResp>(res);
        setPhrases(data?.phrases ?? []);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Failed to load phrases.";
        setLoadError(msg);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Fetch phrases once we know the businessId.
  useEffect(() => {
    if (!businessId) return;
    fetchBusinessPhrases(businessId);
  }, [businessId, fetchBusinessPhrases]);

  // Convenience refresher after mutations.
  const refreshAll = useCallback(async () => {
    if (!businessId) return;
    await fetchBusinessPhrases(businessId);
  }, [businessId, fetchBusinessPhrases]);

  /* ============================ Derived lists ============================ */
  const hasPhrases = phrases.length > 0;

  const goodPhrases = useMemo(
    () => phrases.filter((p) => p.sentiment === "good"),
    [phrases]
  );

  const badPhrases = useMemo(
    () => phrases.filter((p) => p.sentiment === "bad"),
    [phrases]
  );

  const anyChosen = useMemo(
    () => suggestions.some((s) => s.chosen),
    [suggestions]
  );

  /* ============================ Add GOOD phrases ============================ */
  const onAddGoodPhrases = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setAddGoodMsg(null);
      setAddGoodIsError(false);

      if (!businessId) {
        setAddGoodMsg("Missing business.");
        setAddGoodIsError(true);
        return;
      }

      const parsed = parsePhrasesInput(newGoodPhraseInput);
      if (parsed.length === 0) {
        setAddGoodMsg("Please enter at least one phrase.");
        setAddGoodIsError(true);
        return;
      }

      // New contract: backend should accept { businessId, phrases: [{ phrase, sentiment }] }
      const payload = {
        businessId,
        phrases: parsed.map((phrase) => ({
          phrase,
          sentiment: "good" as const,
        })),
      };

      setAddingGood(true);
      try {
        const res = await fetch(API.REVIEW_SETTINGS_ADD_PHRASES, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await safeJson<AddPhrasesResp>(res);
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || "Could not add phrases.");
        }

        const added = data?.inserted?.length ?? 0;
        const updated = data?.updated?.length ?? 0;
        setAddGoodMsg(
          added + updated > 0
            ? `Saved ${added} new phrase${added === 1 ? "" : "s"}${
                updated ? `, updated ${updated}.` : "."
              }`
            : "No changes."
        );
        setAddGoodIsError(false);

        setNewGoodPhraseInput("");
        await refreshAll();
        goodInputRef.current?.focus();
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Could not add phrases.";
        setAddGoodMsg(msg);
        setAddGoodIsError(true);
      } finally {
        setAddingGood(false);
      }
    },
    [businessId, newGoodPhraseInput, refreshAll]
  );

  /* ============================ Add BAD phrases ============================ */
  const onAddBadPhrases = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setAddBadMsg(null);
      setAddBadIsError(false);

      if (!businessId) {
        setAddBadMsg("Missing business.");
        setAddBadIsError(true);
        return;
      }

      const parsed = parsePhrasesInput(newBadPhraseInput);
      if (parsed.length === 0) {
        setAddBadMsg("Please enter at least one phrase.");
        setAddBadIsError(true);
        return;
      }

      const payload = {
        businessId,
        phrases: parsed.map((phrase) => ({
          phrase,
          sentiment: "bad" as const,
        })),
      };

      setAddingBad(true);
      try {
        const res = await fetch(API.REVIEW_SETTINGS_ADD_PHRASES, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await safeJson<AddPhrasesResp>(res);
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || "Could not add phrases.");
        }

        const added = data?.inserted?.length ?? 0;
        const updated = data?.updated?.length ?? 0;
        setAddBadMsg(
          added + updated > 0
            ? `Saved ${added} new phrase${added === 1 ? "" : "s"}${
                updated ? `, updated ${updated}.` : "."
              }`
            : "No changes."
        );
        setAddBadIsError(false);

        setNewBadPhraseInput("");
        await refreshAll();
        badInputRef.current?.focus();
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Could not add phrases.";
        setAddBadMsg(msg);
        setAddBadIsError(true);
      } finally {
        setAddingBad(false);
      }
    },
    [businessId, newBadPhraseInput, refreshAll]
  );

  /* ============================ Delete phrase ============================ */
  const onDeletePhrase = useCallback(
    async (phrase_id: string, phrase_text: string) => {
      if (!businessId) return;

      setDeleteMsg(null);
      setDeleteIsError(false);
      setDeletingId(phrase_id);

      try {
        const res = await fetch(API.REVIEW_SETTINGS_DELETE_PHRASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            businessId,
            phraseId: phrase_id,
          }),
        });

        const data = await safeJson<DeleteResp>(res);
        if (!res.ok || data?.success !== true) {
          throw new Error(data?.error || "Could not delete phrase.");
        }

        // Optimistically drop phrase from local state
        setPhrases((prev) => prev.filter((p) => p.phrase_id !== phrase_id));

        const exCount =
          typeof data?.deleted_excerpts === "number"
            ? data.deleted_excerpts
            : 0;

        setDeleteMsg(
          `Deleted phrase “${titleCase(
            phrase_text
          )}”${exCount ? ` and ${exCount} excerpt(s)` : ""}.`
        );
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : "Could not delete phrase.";
        setDeleteMsg(msg);
        setDeleteIsError(true);
      } finally {
        setDeletingId(null);
      }
    },
    [businessId]
  );

  /* ============================ Generate new phrases ============================ */
  const onGenerateNewPhrases = useCallback(async () => {
    if (!businessId) return;

    setGenError(null);
    setGenerating(true);
    setSuggestions([]);

    try {
      // Backend should generate suggestions based on THIS business's reviews,
      // so we'll send businessId, not userId.
      const res = await fetch(API.GENERATE_PHRASES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ businessId }),
      });

      const data = await safeJson<GenerateNewPhrasesResp>(res);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || "Failed to generate phrases.");
      }

      const items =
        (data?.new_phrases ?? []).map((x) => ({
          phrase: x.phrase,
          counts: x.counts ?? 0,
          chosen: true,
          sentiment: x.sentiment, // can be undefined
        })) ?? [];

      setSuggestions(items);
      setGenOpen(true);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to generate phrases.";
      setGenError(msg);
      setGenOpen(true); // still open to show message
    } finally {
      setGenerating(false);
    }
  }, [businessId]);

  const onToggleSuggestion = useCallback((idx: number) => {
    setSuggestions((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], chosen: !copy[idx].chosen };
      return copy;
    });
  }, []);

  const onAcceptSuggestions = useCallback(async () => {
    setAcceptMsg(null);
    setAcceptIsError(false);

    if (!businessId) return;

    const selected = suggestions.filter((s) => s.chosen);
    if (selected.length === 0) {
      setAcceptMsg("Select at least one phrase to add.");
      setAcceptIsError(true);
      return;
    }

    setAccepting(true);
    try {
      const res = await fetch(API.ADD_GENERATED_PHRASES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          phrases: selected.map((s) => ({
            phrase: s.phrase,
            counts: s.counts,
            sentiment: s.sentiment === "bad" ? "bad" : "good",
          })),
        }),
      });

      const data = await safeJson<AddPhrasesResp>(res);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || "Could not add selected phrases.");
      }

      // Refresh list in main page
      await refreshAll();

      // Close modal
      setGenOpen(false);
      setSuggestions([]);
      setAcceptMsg(null);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Could not add selected phrases.";
      setAcceptMsg(msg);
      setAcceptIsError(true);
    } finally {
      setAccepting(false);
    }
  }, [businessId, suggestions, refreshAll]);

  /* ============================ UI ============================ */
  return (
    <main className="max-w-3xl px-6 py-8">
      {/* ---------- Header ---------- */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">
            {businessName
              ? `${businessName} Review Settings`
              : "Review Settings"}
          </h1>
          <p className="text-sm text-gray-600">
            Manage the keywords used to detect highlights and complaints in
            customer feedback.
          </p>
        </div>

        <button
          type="button"
          onClick={onGenerateNewPhrases}
          disabled={isPending || !businessId || generating}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          title="Generate ~10 fresh phrases from recent reviews"
        >
          {generating ? "Generating…" : "Generate new phrases"}
        </button>
      </header>

      {/* ---------- Load / error state ---------- */}
      {loading ? (
        <div className="mb-6">
          <div className="mb-2 h-4 w-40 animate-pulse rounded bg-gray-100" />
          <div className="mb-2 h-4 w-64 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-56 animate-pulse rounded bg-gray-100" />
        </div>
      ) : loadError ? (
        <div className="mb-6 border-l-4 border-red-500 bg-red-50 px-4 py-2 text-sm text-red-800">
          {loadError}
        </div>
      ) : null}

      {/* ---------- Main content when loaded ---------- */}
      {!loading && !loadError && (
        <>
          {/* Add phrases */}
          <section className="mb-8">
            <h2 className="mb-2 text-sm font-medium text-gray-900">
              Add phrases
            </h2>

            <div className="grid gap-3 md:grid-cols-2">
              {/* GOOD input */}
              <form
                onSubmit={onAddGoodPhrases}
                className="rounded-lg border bg-white border-gray-200 p-3"
              >
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Add good phrases
                </h3>

                <div className="flex items-center gap-2">
                  <input
                    ref={goodInputRef}
                    type="text"
                    value={newGoodPhraseInput}
                    onChange={(e) => setNewGoodPhraseInput(e.target.value)}
                    placeholder="e.g., Great Communication, Friendly Staff"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                  <button
                    type="submit"
                    disabled={addingGood || !businessId}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    title="Add good phrase(s)"
                  >
                    {addingGood ? "Adding…" : "Add"}
                  </button>
                </div>

                {addGoodMsg && (
                  <div
                    className={`mt-3 border-l-4 px-3 py-2 text-sm ${
                      addGoodIsError
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-emerald-600 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {addGoodMsg}
                  </div>
                )}

                <p className="mt-2 text-[11px] text-gray-500">
                  Separate with commas or new lines to add multiple.
                </p>
              </form>

              {/* BAD input */}
              <form
                onSubmit={onAddBadPhrases}
                className="rounded-lg border bg-white border-gray-200 p-3"
              >
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Add bad phrases
                </h3>

                <div className="flex items-center gap-2">
                  <input
                    ref={badInputRef}
                    type="text"
                    value={newBadPhraseInput}
                    onChange={(e) => setNewBadPhraseInput(e.target.value)}
                    placeholder="e.g., Long Wait Times, Poor Communication"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  />
                  <button
                    type="submit"
                    disabled={addingBad || !businessId}
                    className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
                    title="Add bad phrase(s)"
                  >
                    {addingBad ? "Adding…" : "Add"}
                  </button>
                </div>

                {addBadMsg && (
                  <div
                    className={`mt-3 border-l-4 px-3 py-2 text-sm ${
                      addBadIsError
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-rose-600 bg-rose-50 text-rose-800"
                    }`}
                  >
                    {addBadMsg}
                  </div>
                )}

                <p className="mt-2 text-[11px] text-gray-500">
                  Separate with commas or new lines to add multiple.
                </p>
              </form>
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Tip: keep phrases short and generic (e.g., “Pricing”,
              “Communication”, “Aftercare”).
            </p>
          </section>

          {/* Existing phrases */}
          <section className="mb-4">
            <h2 className="mt-2 text-sm font-medium text-gray-900">
              Your phrases
            </h2>
            <p className="mb-2 text-xs text-gray-500">
              Good phrases are surfaced to happy customers to help them post
              public reviews. Bad phrases help detect issues.
            </p>

            {!hasPhrases ? (
              <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                No phrases yet. Click{" "}
                <strong>Generate new phrases</strong> or add your own above.
              </div>
            ) : (
              <>
                {deleteMsg && (
                  <div
                    className={`mb-3 border-l-4 px-3 py-2 text-sm ${
                      deleteIsError
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-amber-500 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {deleteMsg}
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  {/* GOOD group */}
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-emerald-700">
                        Good ({goodPhrases.length})
                      </h3>
                    </div>

                    {goodPhrases.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                        No good phrases yet.
                      </div>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {goodPhrases.map((p) => (
                          <li
                            key={p.phrase_id}
                            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900"
                            title={titleCase(p.phrase)}
                          >
                            <span className="font-medium">
                              {titleCase(p.phrase)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onDeletePhrase(p.phrase_id, p.phrase)
                              }
                              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-emerald-700 hover:bg-emerald-100"
                              aria-label={`Delete ${p.phrase}`}
                              title={`Delete ${titleCase(p.phrase)}`}
                            >
                              {deletingId === p.phrase_id ? (
                                <svg
                                  className="h-4 w-4 animate-spin"
                                  viewBox="0 0 24 24"
                                  fill="none"
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
                              ) : (
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M9 3h6m-9 4h12m-1 0-.8 11.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 7m3 4v6m6-6v6"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* BAD group */}
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-rose-700">
                        Bad ({badPhrases.length})
                      </h3>
                    </div>

                    {badPhrases.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                        No bad phrases yet.
                      </div>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {badPhrases.map((p) => (
                          <li
                            key={p.phrase_id}
                            className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-900"
                            title={titleCase(p.phrase)}
                          >
                            <span className="font-medium">
                              {titleCase(p.phrase)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onDeletePhrase(p.phrase_id, p.phrase)
                              }
                              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-rose-700 hover:bg-rose-100"
                              aria-label={`Delete ${p.phrase}`}
                              title={`Delete ${titleCase(p.phrase)}`}
                            >
                              {deletingId === p.phrase_id ? (
                                <svg
                                  className="h-4 w-4 animate-spin"
                                  viewBox="0 0 24 24"
                                  fill="none"
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
                              ) : (
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M9 3h6m-9 4h12m-1 0-.8 11.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 7m3 4v6m6-6v6"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {/* ---------- Suggestions Modal ---------- */}
      {genOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Suggested phrases"
          onKeyDown={(e) => e.key === "Escape" && setGenOpen(false)}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setGenOpen(false)}
            aria-hidden="true"
          />

          {/* Modal card */}
          <div className="relative z-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Suggested phrases
              </h2>
              <button
                type="button"
                onClick={() => setGenOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-5">
              {/* Current phrases list */}
              <section className="md:col-span-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">
                    Current phrases
                  </h3>
                  <span className="text-xs text-gray-500">{phrases.length}</span>
                </div>

                {phrases.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3 text-xs text-gray-600">
                    You don’t have any phrases yet.
                  </div>
                ) : (
                  <div className="max-h-56 overflow-auto pr-1">
                    <ul className="flex flex-wrap gap-2">
                      {phrases.map((p) => (
                        <li
                          key={p.phrase_id}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-800"
                          title={titleCase(p.phrase)}
                        >
                          {titleCase(p.phrase)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-2 text-[11px] text-gray-500">
                  You can remove items in the main list.
                </p>
              </section>

              {/* Suggestions */}
              <section className="md:col-span-3">
                {genError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {genError}
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700">
                    No new phrases were suggested.
                  </div>
                ) : (
                  <>
                    <p className="mb-3 text-sm text-gray-600">
                      These are recently-detected phrases. Uncheck any you
                      don’t want to add.
                    </p>

                    <ul className="divide-y divide-gray-100 rounded-xl border">
                      {suggestions.map((s, idx) => (
                        <li
                          key={s.phrase}
                          className="flex items-center justify-between p-3"
                        >
                          <label className="flex cursor-pointer items-center gap-3">
                            <input
                              type="checkbox"
                              checked={s.chosen}
                              onChange={() => onToggleSuggestion(idx)}
                              className="h-4 w-4"
                            />
                            <span className="text-sm font-medium text-gray-800">
                              {titleCase(s.phrase)}
                            </span>
                          </label>

                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-600">
                              mentions: {s.counts}
                            </span>

                            {s.sentiment && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  s.sentiment === "good"
                                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                    : "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                                }`}
                              >
                                {s.sentiment.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    {acceptMsg && (
                      <div
                        className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                          acceptIsError
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {acceptMsg}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setGenOpen(false)}
                        className="rounded-lg bg-gray-100 px-4 py-2 text-gray-800 hover:bg-gray-200"
                      >
                        Cancel
                      </button>

                      <button
                        type="button"
                        onClick={onAcceptSuggestions}
                        disabled={!anyChosen || accepting}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        {accepting ? "Adding…" : "Accept changes"}
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
