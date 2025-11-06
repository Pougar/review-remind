// app/redirect/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const REDIRECT_STORAGE_KEY = "pendingGoogleReviewRedirect";

type PendingPayload = {
  url?: string;
  review?: string;
};

export default function RedirectPage() {
  const search = useSearchParams();

  // seconds param from ?s=...
  // Fallback to 5 if missing or invalid
  const initialSeconds = (() => {
    const raw = search.get("s");
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n) || n <= 0) return 5;
    return n;
  })();

  // local state
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Load url + review from sessionStorage on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(REDIRECT_STORAGE_KEY);
      if (raw) {
        const parsed: PendingPayload = JSON.parse(raw);
        const url = typeof parsed?.url === "string" ? parsed.url : null;
        const review =
          typeof parsed?.review === "string" ? parsed.review : "";

        if (url) {
          setTargetUrl(url);
        }

        // Try copying the review text to clipboard once here
        if (review.trim()) {
          navigator.clipboard
            .writeText(review.trim())
            .then(() => {
              setCopied(true);
            })
            .catch(() => {
              // Ignore clipboard error; user can still manually copy later if needed
            });
        }
      }
    } catch {
      // Ignore JSON / storage errors
    }
  }, []);

  // Countdown + auto-redirect when it hits 0
  useEffect(() => {
    // no URL? then don't redirect automatically
    if (!targetUrl) return;

    if (secondsLeft <= 0) {
      // hard redirect so we actually leave the site
      window.location.href = targetUrl;
      return;
    }

    const timer = setTimeout(() => {
      setSecondsLeft((s) => s - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [secondsLeft, targetUrl]);

  // Manual "Go now" click
  function handleGoNow() {
    if (!targetUrl) return;
    window.location.href = targetUrl;
  }

  // Basic styling matches the style you used in submit-review page
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f9fafb",
        fontFamily: "Arial, sans-serif",
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: "2rem",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          maxWidth: "480px",
          width: "100%",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "1.25rem",
            lineHeight: 1.2,
            margin: 0,
            marginBottom: "0.5rem",
            color: "#111827",
            fontWeight: 700,
          }}
        >
          Almost done!
        </h1>

        {targetUrl ? (
          <>
            <p
              style={{
                fontSize: "0.9rem",
                lineHeight: 1.4,
                color: "#374151",
                marginTop: 0,
                marginBottom: "1rem",
              }}
            >
              We’ve saved your review text to your clipboard{" "}
              {copied ? "✅" : "(we tried!)"}.
              <br />
              Please paste it on the next page.
            </p>

            <p
              style={{
                fontSize: "0.8rem",
                lineHeight: 1.4,
                color: "#6b7280",
                marginTop: 0,
                marginBottom: "1rem",
              }}
            >
              We’ll take you to our Google reviews page in{" "}
              <strong>{secondsLeft}</strong>{" "}
              second{secondsLeft === 1 ? "" : "s"}.
            </p>

            <button
              type="button"
              onClick={handleGoNow}
              style={{
                background: "#2563eb",
                color: "#fff",
                padding: "0.6rem 1rem",
                border: "none",
                borderRadius: 6,
                fontWeight: 700,
                cursor: "pointer",
                fontSize: "0.9rem",
                marginBottom: "0.75rem",
              }}
            >
              Go now
            </button>

            <div
              style={{
                fontSize: "0.7rem",
                lineHeight: 1.4,
                color: "#9ca3af",
              }}
            >
              If nothing happens, tap &quot;Go now&quot;.
            </div>
          </>
        ) : (
          <>
            <p
              style={{
                fontSize: "0.9rem",
                lineHeight: 1.4,
                color: "#374151",
                marginTop: 0,
                marginBottom: "1rem",
              }}
            >
              Thanks for your feedback 💙
            </p>

            <p
              style={{
                fontSize: "0.8rem",
                lineHeight: 1.4,
                color: "#6b7280",
                marginTop: 0,
                marginBottom: "1rem",
              }}
            >
              We couldn’t find the Google review link for this business,
              so you’re all done here.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
