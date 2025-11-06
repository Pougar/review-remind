"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo } from "react";

export default function ErrorPage() {
  const search = useSearchParams();
  const router = useRouter();

  // Read `m` from ?m=... but also guard against empty/garbage
  const message = useMemo(() => {
    const raw = search.get("m");
    if (!raw || !raw.trim()) {
      return "Something went wrong with this link.";
    }
    // Basic sanitisation for display: trim and cap length so a
    // totally wild backend string doesn't nuke layout.
    const trimmed = raw.trim();
    return trimmed.length > 500
      ? trimmed.slice(0, 500) + "…"
      : trimmed;
  }, [search]);

  function goHome() {
    // change this if your marketing / landing page is different
    router.replace("/");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#f9fafb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial, sans-serif",
        padding: "2rem",
      }}
    >
      <section
        style={{
          backgroundColor: "#ffffff",
          width: "100%",
          maxWidth: 480,
          borderRadius: 12,
          boxShadow: "0 12px 24px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
          padding: "1.5rem 1.5rem 2rem",
          textAlign: "center",
        }}
      >
        {/* Icon / badge */}
        <div
          aria-hidden="true"
          style={{
            width: 48,
            height: 48,
            margin: "0 auto 1rem auto",
            borderRadius: 9999,
            backgroundColor: "#fee2e2",
            color: "#dc2626",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          !
        </div>

        <h1
          style={{
            margin: 0,
            color: "#111827",
            fontSize: "1.25rem",
            fontWeight: 600,
            lineHeight: 1.2,
          }}
        >
          We couldn&apos;t open your review page
        </h1>

        <p
          style={{
            marginTop: "0.75rem",
            marginBottom: "1rem",
            fontSize: 14,
            lineHeight: 1.4,
            color: "#6b7280",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message}
        </p>

        <p
          style={{
            marginTop: 0,
            marginBottom: "1.5rem",
            fontSize: 12,
            lineHeight: 1.4,
            color: "#9ca3af",
          }}
        >
          If you got here from an email, your link may have expired
          or already been used.
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => router.back()}
            style={{
              backgroundColor: "#fff",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "0.6rem 1rem",
              fontSize: 14,
              fontWeight: 600,
              color: "#374151",
              cursor: "pointer",
              lineHeight: 1.2,
            }}
          >
            Go back
          </button>

          <button
            type="button"
            onClick={goHome}
            style={{
              backgroundColor: "#2563eb",
              border: "1px solid #2563eb",
              borderRadius: 6,
              padding: "0.6rem 1rem",
              fontSize: 14,
              fontWeight: 600,
              color: "#ffffff",
              cursor: "pointer",
              lineHeight: 1.2,
            }}
          >
            Go to homepage
          </button>
        </div>
      </section>
    </main>
  );
}
