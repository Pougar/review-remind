// app/dashboard/[slug]/add-business/business-details/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";
import { API, ROUTES } from "@/app/lib/constants";

/* ---------- small helpers ---------- */
const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);
function slugify(input: string, maxLen = 60): string {
  const ascii = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, "");
}

/* ---------- Stage type & API fallbacks ---------- */
type Stage = "link_google" | "link-xero" | "onboarding" | "already_linked";
const GET_BUSINESS_STAGE_API = API.CHECK_BUSINESS_STAGE;
const GET_BUSINESS_SLUG_API  = API.GET_BUSINESS_SLUG;

export default function BusinessDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();

  // USER slug (owner’s slug in URL)
  const userSlug = useMemo(
    () => (Array.isArray(params?.slug) ? params!.slug[0] : (params?.slug as string)) || "",
    [params]
  );

  // business id from ?bid=
  const businessId = useMemo(() => search.get("bid") ?? "", [search]);

  // session for userId (RLS on SAVE)
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id ?? "";

  // form state
  const [displayName, setDisplayName] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [description, setDescription] = useState("");
  const [googleReviewLink, setGoogleReviewLink] = useState("");
  const [slugInput, setSlugInput] = useState("");

  // ui state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // stage gate: only load details if we confirm stage === "onboarding"
  const [allowLoad, setAllowLoad] = useState(false);

  // derived helpers
  const prettySlug = slugify(slugInput);
  const emailValid = !businessEmail || /.+@.+\..+/.test(businessEmail.trim());
  const canSave =
    !!userId &&
    !!businessId &&
    !!displayName.trim() &&
    emailValid &&
    !saving;

  /* ---------- stage check & routing ---------- */
  useEffect(() => {
    if (isPending) return;

    // auth guard
    if (!userId) {
      const here =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : `/dashboard/${encodeURIComponent(userSlug)}/add-business/business-details?bid=${encodeURIComponent(businessId || "")}`;
      router.replace(`${ROUTES.LOG_IN}?next=${encodeURIComponent(here)}`);
      return;
    }

    if (!isUUID(businessId)) {
      setMsg("Missing or invalid business id.");
      setIsError(true);
      setLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      try {
        console.log("userID:", userId, " businessId:", businessId);
        setLoading(true);
        // POST { businessId } → { stage: "link_google" | "link-xero" | "onboarding" | "already_linked" }
        const res = await fetch(GET_BUSINESS_STAGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ businessId, userId }),
        });
        const data = (await res.json().catch(() => ({}))) as { stage?: Stage; error?: string };

        if (!alive) return;

        if (!res.ok) {
          setMsg(data?.error || "Could not verify onboarding stage.");
          setIsError(true);
          setLoading(false);
          return;
        }

        const stage = data?.stage as Stage | undefined;
        if (!stage || stage === "onboarding") {
          // Stay on this page and load details
          setAllowLoad(true);
          return;
        }

        if (stage === "link_google") {
          router.replace(`${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug)}/add-business/link-google`);
          return;
        }
        if (stage === "link-xero") {
          router.replace(
            `${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug)}/add-business/link-xero?bid=${encodeURIComponent(businessId)}`
          );
          return;
        }
        if (stage === "already_linked") {
          // Need the business slug to reach dashboard/[slug]/[business_slug]
          try {
            const r = await fetch(GET_BUSINESS_SLUG_API, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              cache: "no-store",
              body: JSON.stringify({ businessId }),
            });
            const j = (await r.json().catch(() => ({}))) as { slug?: string };
            const bizSlug = j?.slug;
            router.replace(
              bizSlug
                ? `${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug)}/${encodeURIComponent(bizSlug)}`
                : `${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug)}`
            );
          } catch {
            router.replace(`${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug)}`);
          }
          return;
        }
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message || "Failed to verify onboarding stage.");
        setIsError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isPending, userId, businessId, userSlug, router]);

  /* ---------- load existing details (only if stage == onboarding) ---------- */
  useEffect(() => {
    if (!allowLoad) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg(null);
      setIsError(false);

      try {
        // 🔁 Per your contract: POST only { businessId } in body
        const res = await fetch(API.BUSINESSES_GET_DETAILS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ businessId }),
        });

        const data = await res.json().catch(() => ({} as any));
        if (!alive) return;

        if (!res.ok) {
          setMsg(data?.message || data?.error || "Failed to load business details.");
          setIsError(true);
        } else {
          setDisplayName(data?.display_name ?? "");
          setBusinessEmail(data?.business_email ?? "");
          setDescription(data?.description ?? "");
          setGoogleReviewLink(data?.google_review_link ?? "");
          setSlugInput(data?.slug ?? "");
        }
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message || "Network error loading business details.");
        setIsError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [allowLoad, businessId]);

  /* ---------- save + mark onboarded + redirect ---------- */
  const onSaveAndContinue = useCallback(async () => {
    if (!canSave) return;

    setSaving(true);
    setMsg(null);
    setIsError(false);

    try {
      // 1) Save details — uses userId from session + businessId from ?bid
      const saveRes = await fetch(API.BUSINESSES_SAVE_DETAILS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          userId,              // from session
          businessId,          // from ?bid
          displayName: displayName.trim(),
          businessEmail: businessEmail.trim() || null,
          description: description.trim() || null,
          googleReviewLink: googleReviewLink.trim() || null,
          slug: (slugify(slugInput) || "").trim() || null,
        }),
      });

      const saveJson = await saveRes.json().catch(() => ({} as any));
      if (!saveRes.ok) {
        setMsg(saveJson?.message || saveJson?.error || "Could not save changes.");
        setIsError(true);
        setSaving(false);
        return;
      }

      const finalSlug: string = saveJson?.slug || slugify(slugInput) || "";
      if (!finalSlug) {
        setMsg("Saved, but could not resolve business URL.");
        setIsError(true);
        setSaving(false);
        return;
      }

      if (saveJson?.message) {
        setMsg(saveJson.message); // e.g., slug taken, other fields saved
        setIsError(false);
      }

      // 2) Mark the business as onboarded (non-fatal)
      try {
        await fetch(API.BUSINESSES_ONBOARDED, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ businessId }),
        });
      } catch {
        /* ignore */
      }

      // 3) Redirect to the business dashboard
      router.replace(`${ROUTES.DASHBOARD}/${encodeURIComponent(userSlug)}/${encodeURIComponent(finalSlug)}`);
    } catch (e: any) {
      setMsg(e?.message || "Unexpected error saving settings.");
      setIsError(true);
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    userId,
    businessId,
    displayName,
    businessEmail,
    description,
    googleReviewLink,
    slugInput,
    router,
    userSlug,
  ]);

  /* ---------- auth / loading guards ---------- */
  if (isPending || loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-white text-slate-700">
        Loading…
      </div>
    );
  }

  if (!userId || !businessId) {
    return (
      <div className="min-h-screen grid place-items-center bg-white text-slate-700 p-6">
        Missing context. Please open this page via the onboarding flow.
      </div>
    );
  }

  /* ---------- UI ---------- */
  return (
    <div className="bg-white text-slate-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-5">
          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            upreview
          </span>
        </div>

        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <h1 className="text-base font-semibold text-slate-900">Business details</h1>
          <button
            type="button"
            onClick={onSaveAndContinue}
            disabled={!canSave}
            className="inline-flex items-center rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:border-indigo-300 disabled:bg-indigo-300"
          >
            {saving ? "Saving…" : "Save & continue"}
          </button>
        </div>

        {msg && (
          <div
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              isError
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {msg}
          </div>
        )}

        {/* Form */}
        <section className="mt-6 space-y-6">
          {/* Display name */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-900">Business name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your business name"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Business email */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-900">Business email</label>
            <input
              type="email"
              value={businessEmail}
              onChange={(e) => setBusinessEmail(e.target.value)}
              placeholder="you@yourbusiness.com"
              className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-1 ${
                businessEmail && !emailValid
                  ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500"
                  : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
              }`}
            />
            {businessEmail && !emailValid && (
              <p className="mt-1 text-xs text-rose-700">Please enter a valid email.</p>
            )}
          </div>

          {/* Google review link */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-900">Google review link</label>
            <input
              type="url"
              value={googleReviewLink}
              onChange={(e) => setGoogleReviewLink(e.target.value)}
              placeholder="https://g.page/your-business or https://maps.google.com/..."
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-900">Business URL slug</label>
            <input
              type="text"
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              placeholder="your-business"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <div className="mt-2 text-xs text-slate-600">
              Your dashboard URL will be:{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">
                {ROUTES.DASHBOARD}/{userSlug}/{prettySlug || "[your-slug]"}
              </code>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
