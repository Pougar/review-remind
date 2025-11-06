"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useParams,
  useSearchParams,
  useRouter,
  usePathname,
} from "next/navigation";
import { API } from "@/app/lib/constants";

/* ============================================================
   Small helpers
   ============================================================ */

const REDIRECT_STORAGE_KEY = "pendingGoogleReviewRedirect";

function redirectToGoogleCountdown(
  router: ReturnType<typeof useRouter>,
  url: string | null | undefined,
  review: string,
  seconds = 5
) {
  if (!url) return;
  try {
    sessionStorage.setItem(
      REDIRECT_STORAGE_KEY,
      JSON.stringify({ url, review })
    );
  } catch {
    /* non-blocking */
  }
  router.push(`/redirect?s=${encodeURIComponent(String(seconds))}`);
}

function dedupeCaseInsensitive(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of list) {
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

const isUUID = (v?: string | null) =>
  !!v && /^[0-9a-fA-F-]{36}$/.test(v);

// send user to /error?m=<msg>
function bounceToError(
  router: ReturnType<typeof useRouter>,
  msg: string
) {
  const params = new URLSearchParams();
  params.set("m", msg);
  router.replace(`/error?${params.toString()}`);
}

/* ============================================================
   Types that reflect the *public* APIs
   ============================================================ */

type BusinessDetailsResp = {
  id?: string;
  display_name?: string | null;
  description?: string | null;
  google_review_link?: string | null;
  error?: string;
  message?: string;
};

type ClickedUpdateResp = {
  already?: boolean;
  error?: string;
  message?: string;
};

type SubmitReviewResp = {
  error?: string;
  message?: string;
};

type GoodPhrasesResp = {
  phrases?: {
    phrase_id?: string;
    phrase?: string;
  }[];
  error?: string;
  message?: string;
};

type GenerateGoodReviewResp =
  | {
      businessId?: string;
      clientId?: string;
      reviews?: string[];
      error?: string;
      message?: string;
    }
  | { error: string; message?: string };

/* ============================================================
   Component
   ============================================================ */

export default function SubmitReviewPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // Route param: submit-review/[clientId]
  const { clientId } = useParams() as { clientId: string };

  // Query params
  const businessId = (search.get("businessId") || "").trim();
  const typeParam = (search.get("type") || "").toLowerCase();
  const token = (search.get("token") || "").trim();

  const isGood = typeParam === "good";
  const isBad = typeParam === "bad";

  /* ------------------------------------------------------------
     Page state
     ------------------------------------------------------------ */

  // Status of logging "clicked the email link"
  const [status, setStatus] = useState<
    "idle" | "updating" | "updated" | "already" | "error"
  >("idle");

  // The text of the review the client will submit
  const [reviewText, setReviewText] = useState("");

  // The "send" button state
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitIsError, setSubmitIsError] = useState(false);

  // Business Google review link
  const [googleLink, setGoogleLink] = useState<string | null>(null);

  // Phrase chips (GOOD phrases only)
  const [availablePhrases, setAvailablePhrases] = useState<string[]>([]);
  const [selectedPhrases, setSelectedPhrases] = useState<string[]>([]);
  const [phrasesLoading, setPhrasesLoading] = useState(false);
  const [phrasesError, setPhrasesError] = useState<string | null>(null);

  // AI generate state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Star rating
  const [stars, setStars] = useState<number>(isGood ? 5 : 0);
  useEffect(() => {
    setStars(isGood ? 5 : 0);
  }, [isGood]);

  /* ------------------------------------------------------------
     1. Basic validation of URL & token
     ------------------------------------------------------------ */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!clientId) {
        bounceToError(router, "Missing client identifier in link.");
        return;
      }

      if (!isUUID(businessId)) {
        bounceToError(router, "This review link is missing a valid business ID.");
        return;
      }

      if (!token) {
        bounceToError(router, "Your review link is missing its security token.");
        return;
      }

      // For real clients we expect ?type=good|bad
      if (clientId !== "test" && !isGood && !isBad) {
        bounceToError(router, "Your review link is incomplete (no review type).");
        return;
      }

      // Probe with /get-business-details so we can surface a nice message
      try {
        const res = await fetch(API.PUBLIC_GET_BUSINESS_DETAILS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            clientId,
            token,
          }),
          cache: "no-store",
        });

        if (!alive) return;
        if (!res.ok) {
          let msg = "We couldn't load the business details.";
          try {
            const data: BusinessDetailsResp = await res.json();
            msg =
              data?.message ||
              data?.error ||
              msg;
          } catch {
            /* fallback keep msg */
          }
          bounceToError(router, msg);
          return;
        }
      } catch {
        if (alive) {
          bounceToError(
            router,
            "We couldn't verify your link. Please ask for a new review link."
          );
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [clientId, businessId, token, isGood, isBad, router]);

  /* ------------------------------------------------------------
     2. Log "review_clicked"
     ------------------------------------------------------------ */
  useEffect(() => {
    let alive = true;
    if (!clientId) return;

    (async () => {
      try {
        setStatus("updating");

        const res = await fetch(API.REVIEW_CLICKED_UPDATE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            clientId,
            token,
          }),
        });

        if (!alive) return;

        if (res.status === 403) {
          const data: ClickedUpdateResp = await res.json().catch(() => ({}));
          if (
            data?.error === "EMAIL_NOT_SENT" ||
            data?.error === "REVIEW_ALREADY_SUBMITTED"
          ) {
            const reason =
              data?.message ||
              (data.error === "EMAIL_NOT_SENT"
                ? "This review link is not active for you."
                : "You already submitted a review for this visit.");
            bounceToError(router, reason);
            return;
          }
        }

        if (!res.ok) {
          const data: ClickedUpdateResp = await res.json().catch(() => ({}));
          const reason =
            data?.message ||
            data?.error ||
            "We couldn't validate your review link.";
          setStatus("error");
          bounceToError(router, reason);
          return;
        }

        const data: ClickedUpdateResp = await res.json().catch(() => ({}));
        if (data?.already) {
          setStatus("already");
        } else {
          setStatus("updated");
        }
      } catch {
        if (alive) {
          setStatus("error");
          bounceToError(
            router,
            "We couldn't register your visit. Please open the link again from your email."
          );
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [clientId, businessId, token, router]);

  /* ------------------------------------------------------------
     3. Load business info (Google review link etc.)
     ------------------------------------------------------------ */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isUUID(businessId) || !token || !clientId) return;

      try {
        const res = await fetch(API.PUBLIC_GET_BUSINESS_DETAILS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            clientId,
            token,
          }),
          cache: "no-store",
        });

        if (!alive) return;

        if (!res.ok) {
          // We don't auto-bounce here because the first effect already probed
          // and would have bounced. If it gets this far it's probably fine.
          return;
        }

        const data: BusinessDetailsResp = await res.json().catch(() => ({}));
        const link =
          typeof data?.google_review_link === "string"
            ? data.google_review_link.trim()
            : "";
        setGoogleLink(link || null);
      } catch {
        if (!alive) return;
        setGoogleLink(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [businessId, clientId, token]);

  /* ------------------------------------------------------------
     4. Load GOOD phrases
     ------------------------------------------------------------ */
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();

    async function fetchGoodPhrasesForBusiness(bizId: string) {
      setPhrasesLoading(true);
      setPhrasesError(null);

      try {
        const res = await fetch(API.PUBLIC_GET_GOOD_PHRASES, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId: bizId,
            clientId,
            token,
          }),
          cache: "no-store",
          signal: ctrl.signal,
        });

        if (!alive) return;

        if (!res.ok) {
          const data: GoodPhrasesResp = await res.json().catch(() => ({}));
          const reason =
            data?.message ||
            data?.error ||
            `Failed to load phrases (${res.status}).`;
          setPhrasesError(reason);
          setAvailablePhrases([]);
          setSelectedPhrases([]);
          setPhrasesLoading(false);
          return;
        }

        const data: GoodPhrasesResp = await res.json().catch(() => ({}));
        const list = Array.isArray(data?.phrases) ? data.phrases : [];

        const collected = list
          .map((p) =>
            typeof p?.phrase === "string" ? p.phrase.trim() : ""
          )
          .filter(Boolean);

        const unique = dedupeCaseInsensitive(collected);

        if (!alive) return;
        setAvailablePhrases(unique);

        // Keep only still-valid selections
        setSelectedPhrases((prev) =>
          prev.filter((p) =>
            unique.some((u) => u.toLowerCase() === p.toLowerCase())
          )
        );

        setPhrasesLoading(false);
      } catch {
        if (!alive) return;
        setPhrasesError("Couldn't load sample phrases right now.");
        setAvailablePhrases([]);
        setSelectedPhrases([]);
        setPhrasesLoading(false);
      }
    }

    if (isUUID(businessId) && token && clientId) {
      fetchGoodPhrasesForBusiness(businessId);
    } else {
      setAvailablePhrases([]);
      setSelectedPhrases([]);
    }

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [businessId, clientId, token]);

  /* ------------------------------------------------------------
     5. AI generate a draft review (good path only)
     ------------------------------------------------------------ */
  const onGenerate = useCallback(async () => {
    setAiError(null);

    if (selectedPhrases.length === 0) {
      setAiError("Choose at least one phrase to include.");
      return;
    }

    setAiLoading(true);
    try {
      const res = await fetch(API.PUBLIC_GENERATE_GOOD_REVIEWS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          clientId,
          token,
          phrases: selectedPhrases,
        }),
      });

      if (!res.ok) {
        let reason = "Failed to generate review.";
        try {
          const raw = await res.json();
          reason =
            raw?.message ||
            raw?.error ||
            reason;
        } catch {
          /* leave reason */
        }
        throw new Error(reason);
      }

      const data: GenerateGoodReviewResp = await res
        .json()
        .catch(() => ({} as any));

      let generated = "";
      if (
        data &&
        typeof data === "object" &&
        "reviews" in data &&
        Array.isArray((data as any).reviews)
      ) {
        const arr = (data as any).reviews as string[];
        if (arr.length > 0) {
          generated = (arr[0] || "").trim();
        }
      }

      if (!generated) {
        const errMsg =
          (data as any)?.message ||
          (data as any)?.error ||
          "No review text returned.";
        throw new Error(errMsg);
      }

      setReviewText(generated);
    } catch (err: any) {
      setAiError(
        err?.message ||
          "Couldn't generate a review. Please try again."
      );
    } finally {
      setAiLoading(false);
    }
  }, [businessId, clientId, token, selectedPhrases]);

  /* ------------------------------------------------------------
     6. Submit final review
     ------------------------------------------------------------ */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitMsg(null);
    setSubmitIsError(false);
    setSubmitting(true);

    // tester mode just copies & maybe redirects
    if (clientId === "test") {
      try {
        const textToCopy = (reviewText || "").trim();
        if (textToCopy) {
          try {
            await navigator.clipboard.writeText(textToCopy);
          } catch {
            /* ignore */
          }
        }

        setSubmitMsg(
          isGood
            ? "Copied your review. Redirecting to Google…"
            : "Copied your feedback."
        );
        setSubmitIsError(false);

        if (isGood && googleLink) {
          redirectToGoogleCountdown(
            router,
            googleLink,
            (reviewText || "").trim(),
            5
          );
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // normal flow
    try {
      const res = await fetch(API.PUBLIC_SUBMIT_REVIEW, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          businessId,
          token,
          reviewType: isGood ? "good" : "bad",
          review: reviewText,
          stars,
        }),
      });

      const data: SubmitReviewResp = await res.json().catch(() => ({}));

      if (res.ok) {
        setSubmitMsg("Thanks for your review! 💙");
        setSubmitIsError(false);

        if (isGood && googleLink) {
          redirectToGoogleCountdown(
            router,
            googleLink,
            (reviewText || "").trim(),
            5
          );
        }
      } else if (
        res.status === 409 &&
        data?.error === "REVIEW_ALREADY_SUBMITTED"
      ) {
        setSubmitMsg(
          "You’ve already submitted a review for this visit."
        );
        setSubmitIsError(true);
      } else if (res.status === 404) {
        const reason =
          data?.message ||
          data?.error ||
          "We couldn’t find your record. Please check your link.";
        setSubmitMsg(reason);
        setSubmitIsError(true);
      } else {
        const reason =
          data?.message ||
          data?.error ||
          "Sorry, we couldn’t save your review.";
        setSubmitMsg(reason);
        setSubmitIsError(true);
      }
    } catch {
      setSubmitMsg(
        "Network error. Please try again."
      );
      setSubmitIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  /* ------------------------------------------------------------
     UI helpers
     ------------------------------------------------------------ */

  const tabBase: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontWeight: 600,
    color: "#374151",
    borderBottom: "2px solid transparent",
  };

  const chipStyle = (selected: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.4rem 0.65rem",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 9999,
    cursor: "pointer",
    userSelect: "none",
    border: selected ? "1px solid #16a34a" : "1px solid #d1d5db",
    background: selected ? "rgba(16, 163, 74, 0.1)" : "#fff",
    color: selected ? "#065f46" : "#374151",
  });

  const starBtn = (filled: boolean): React.CSSProperties => ({
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 24,
    lineHeight: 1,
    padding: "0 2px",
    color: filled ? "#f59e0b" : "#d1d5db",
  });

  // switching tab just rewrites ?type=good|bad in URL
  // (businessId and token already in URL, so they persist)
  function switchType(newType: "good" | "bad") {
    const params = new URLSearchParams(search.toString());
    params.set("type", newType);
    router.replace(`${pathname}?${params.toString()}`);
  }

  /* ------------------------------------------------------------
     Render
     ------------------------------------------------------------ */

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f9fafb",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: "2rem",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          maxWidth: "960px",
          width: "100%",
        }}
      >
        {/* Tabs: Good / Bad */}
        <div
          role="tablist"
          aria-label="Review type"
          style={{
            display: "flex",
            gap: "0.5rem",
            borderBottom: "1px solid #e5e7eb",
            marginBottom: "1rem",
          }}
        >
          <button
            role="tab"
            aria-selected={isGood}
            onClick={() => switchType("good")}
            style={{
              ...tabBase,
              color: isGood ? "#111827" : "#374151",
              borderBottomColor: isGood ? "#16a34a" : "transparent",
            }}
          >
            Good
          </button>

          <button
            role="tab"
            aria-selected={isBad}
            onClick={() => switchType("bad")}
            style={{
              ...tabBase,
              color: isBad ? "#111827" : "#374151",
              borderBottomColor: isBad ? "#dc2626" : "transparent",
            }}
          >
            Bad
          </button>
        </div>

        <h1
          style={{
            marginBottom: "0.25rem",
            fontSize: "1.5rem",
            color: "#111827",
          }}
        >
          Leave Your Review
        </h1>

        <p
          style={{
            marginTop: 0,
            marginBottom: "1rem",
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          {status === "updating" && "Loading..."}
          {status === "updated" && "Thanks for clicking through 💙"}
          {status === "already" &&
            "You've already left feedback for this visit."}
          {status === "error" && "Could not record your visit."}
          {status === "idle" && ""}
        </p>

        {/* Star rating */}
        <div
          role="radiogroup"
          aria-label="Rating from 0 to 5 stars"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: "0.75rem",
          }}
        >
          <button
            type="button"
            role="radio"
            aria-checked={stars === 0}
            onClick={() => setStars(0)}
            style={{ ...chipStyle(stars === 0), padding: "0.3rem 0.55rem" }}
            title="Zero stars"
          >
            0★
          </button>

          <div
            aria-hidden="true"
            style={{ display: "flex", alignItems: "center" }}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stars === n}
                aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                onClick={() => setStars(n)}
                style={starBtn(n <= stars)}
              >
                {n <= stars ? "★" : "☆"}
              </button>
            ))}
          </div>

          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {stars} / 5
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {isGood ? (
            <>
              {/* Phrase chips */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  marginBottom: "0.75rem",
                }}
              >
                {phrasesLoading ? (
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    Loading phrases…
                  </span>
                ) : phrasesError ? (
                  <span style={{ fontSize: 12, color: "#b91c1c" }}>
                    {phrasesError}
                  </span>
                ) : availablePhrases.length === 0 ? (
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    No phrases yet. You can still write your own
                    review below.
                  </span>
                ) : (
                  availablePhrases.map((p) => {
                    const selected = selectedPhrases.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() =>
                          setSelectedPhrases((prev) =>
                            prev.includes(p)
                              ? prev.filter((x) => x !== p)
                              : [...prev, p]
                          )
                        }
                        aria-pressed={selected}
                        style={chipStyle(selected)}
                        title={
                          selected
                            ? "Click to remove"
                            : "Click to add"
                        }
                      >
                        {p}
                        {selected ? (
                          <span aria-hidden>×</span>
                        ) : (
                          <span
                            aria-hidden
                            style={{
                              width: 14,
                              height: 14,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 9999,
                              border: "1px solid #d1d5db",
                              fontSize: 10,
                            }}
                          >
                            +
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Generate button */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={aiLoading || availablePhrases.length === 0}
                  style={{
                    background: aiLoading ? "#93c5fd" : "#2563eb",
                    color: "#fff",
                    padding: "0.55rem 1rem",
                    border: "none",
                    borderRadius: 6,
                    fontWeight: 700,
                    cursor: aiLoading ? "not-allowed" : "pointer",
                    fontSize: 14,
                  }}
                >
                  {aiLoading ? "Generating…" : "Generate review"}
                </button>

                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  Choose phrases, then generate. You can edit the
                  text below before submitting.
                </span>
              </div>

              {aiError && (
                <div
                  style={{
                    color: "#b91c1c",
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                  aria-live="polite"
                >
                  {aiError}
                </div>
              )}

              {/* Manual textarea */}
              <div
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  padding: 12,
                  background: "#fff",
                  marginBottom: 12,
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    marginBottom: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#065f46",
                  }}
                >
                  OR Write your own review here
                </h3>

                <textarea
                  placeholder="Write your own review here:"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: "120px",
                    padding: "0.75rem",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "1rem",
                    background: "#fff",
                  }}
                />
              </div>
            </>
          ) : (
            // BAD path
            <textarea
              placeholder="Tell us what we can improve..."
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              required
              style={{
                width: "100%",
                minHeight: "120px",
                padding: "0.75rem",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                marginBottom: "0.75rem",
                fontSize: "1rem",
              }}
            />
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              background: submitting
                ? "#93c5fd"
                : isGood
                ? "#16a34a"
                : "#dc2626",
              color: "#fff",
              padding: "0.75rem 1.5rem",
              border: "none",
              borderRadius: "6px",
              fontSize: "1rem",
              fontWeight: "bold",
              cursor: submitting ? "not-allowed" : "pointer",
              marginTop: "0.75rem",
            }}
          >
            {submitting
              ? "Submitting..."
              : clientId === "test"
              ? isGood
                ? "Copy & Open Google"
                : "Copy"
              : "Submit"}
          </button>

          {/* Helper text under GOOD */}
          {isGood && (
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: 12,
                color: "#9ca3af",
                fontStyle: "italic",
              }}
            >
              {clientId === "test"
                ? "We'll copy your review and (for happy reviews) open your Google reviews page. No data is saved."
                : "After submitting, we'll show a quick countdown and then take you to our Google reviews page."}
            </p>
          )}

          {submitMsg && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: 13,
                color: submitIsError ? "#b91c1c" : "#065f46",
              }}
              aria-live="polite"
            >
              {submitMsg}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
