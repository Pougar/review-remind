"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "@/app/lib/auth-client";
import { useLogoUrl } from "@/app/lib/logoUrlClient";
import { API } from "@/app/lib/constants";

/* ============================ Helpers ============================ */
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

function looksLikeGoogleBusinessLink(urlStr?: string) {
  if (!urlStr) return true;
  try {
    const u = new URL(urlStr);
    return ["google.com", "business.google.com", "g.page", "maps.app.goo.gl", "maps.google.com"].some(
      (d) => u.hostname.includes(d)
    );
  } catch {
    return false;
  }
}

/* ============================ Types ============================ */
type BusinessInfo = {
  id: string;
  slug: string;
  display_name: string | null;
  description: string | null;
  google_business_link: string | null;
};

type GetIdResp = { id?: string | null };

/* ============================ Page ============================ */
export default function BusinessSettings() {
  const router = useRouter();
  const params = useParams() as { slug?: string; bslug?: string };

  // URL pieces from /dashboard/[slug]/[bslug]/settings/business-settings
  const accountSlug = params.slug ?? "";
  const bslug = params.bslug ?? "";

  const { data: session } = authClient.useSession();
  const authed = !!session?.user?.id;

  // Business state
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("Business");
  const [description, setDescription] = useState<string>("");
  const [googleLink, setGoogleLink] = useState<string>("");

  const googleLinkIsValid = useMemo(() => looksLikeGoogleBusinessLink(googleLink), [googleLink]);

  // Slug editing
  const [slugInput, setSlugInput] = useState<string>(bslug);
  const prettyURL = useMemo(
    () =>
      slugInput
        ? `/dashboard/${accountSlug}/${slugify(slugInput)}`
        : `/dashboard/${accountSlug}/[business]`,
    [accountSlug, slugInput]
  );
  const [checkingAvail, setCheckingAvail] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  // Logo
  const { url: logoUrl, refresh: refreshLogoUrl } = useLogoUrl();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadIsError, setUploadIsError] = useState(false);

  // Save all
  const [savingAll, setSavingAll] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveIsError, setSaveIsError] = useState(false);

  /* ---------- Resolve businessId from slug, then load details by businessId ---------- */
  useEffect(() => {
    let alive = true;
    setLoadingInfo(true);
    setLoadError(null);
    setBusinessId(null);

    (async () => {
      try {
        // 1) Get businessId from slug
        const idRes = await fetch(API.GET_BUSINESS_ID_BY_SLUG, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ businessSlug: bslug }),
        });
        const idData = (await idRes.json().catch(() => ({}))) as GetIdResp;

        if (!alive) return;
        const bid = (idRes.ok && idData?.id) ? String(idData.id) : null;
        if (!bid) {
          setLoadError("Could not resolve business.");
          setDisplayName("Business");
          setDescription("");
          setGoogleLink("");
          return;
        }
        setBusinessId(bid);

        // 2) Load details by businessId
        const detailsRes = await fetch(API.BUSINESSES_GET_DETAILS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ businessId: bid }),
        });
        const data = (await detailsRes.json().catch(() => ({}))) as Partial<BusinessInfo>;

        if (!alive) return;
        if (!detailsRes.ok || !data?.id) {
          setLoadError("Could not load business details.");
          setDisplayName("Business");
          setDescription("");
          setGoogleLink("");
          return;
        }

        setDisplayName((data.display_name ?? bslug)?.toString());
        setDescription((data.description ?? "")?.toString());
        setGoogleLink((data.google_business_link ?? "")?.toString());
        setSlugInput((data.slug ?? bslug)?.toString());
      } catch {
        if (alive) {
          setLoadError("Network error while loading business.");
          setDisplayName("Business");
          setDescription("");
          setGoogleLink("");
        }
      } finally {
        if (alive) setLoadingInfo(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bslug]); // re-run when the URL business slug changes

  /* ---------- Slug availability check (by excludeId = businessId) ---------- */
  useEffect(() => {
    if (!businessId) return;
    if (!slugInput || slugInput === bslug) {
      setIsAvailable(null);
      return;
    }

    let alive = true;
    const t = setTimeout(async () => {
      setCheckingAvail(true);
      try {
        const q = new URLSearchParams({
          slug: slugify(slugInput),
          excludeId: businessId,
        }).toString();

        const res = await fetch(`${API.BUSINESS_SLUG_AVAILABILITY}?${q}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (alive) setIsAvailable(Boolean(data?.available));
      } catch {
        if (alive) setIsAvailable(null);
      } finally {
        if (alive) setCheckingAvail(false);
      }
    }, 350);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [slugInput, bslug, businessId]);

  /* ---------- Logo pick & upload ---------- */
  const onPick = (f?: File) => {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setLocalPreview((e.target?.result as string) || null);
    reader.readAsDataURL(f);
  };

  const handleUploadLogo = async () => {
    setUploadMsg(null);
    setUploadIsError(false);

    if (!authed) {
      setUploadMsg("You must be signed in.");
      setUploadIsError(true);
      return;
    }
    if (!businessId) {
      setUploadMsg("Invalid business.");
      setUploadIsError(true);
      return;
    }
    if (!file) {
      setUploadMsg("Please choose an image first.");
      setUploadIsError(true);
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("businessId", businessId);

      const res = await fetch(API.UPLOAD_LOGO, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setUploadMsg(data?.message || data?.error || "Upload failed.");
        setUploadIsError(true);
      } else {
        const signedUrl = data?.signedUrl || null;
        if (signedUrl) setLocalPreview(signedUrl);
        void refreshLogoUrl();
        setUploadMsg("Logo updated.");
        setUploadIsError(false);
      }
    } catch {
      setUploadMsg("Network error during upload.");
      setUploadIsError(true);
    } finally {
      setUploading(false);
    }
  };

  /* ---------- Save all fields (by businessId) ---------- */
  const handleSaveAll = async () => {
    setSaveMsg(null);
    setSaveIsError(false);

    if (!authed) {
      setSaveMsg("You must be signed in.");
      setSaveIsError(true);
      return;
    }
    if (!businessId) {
      setSaveMsg("Invalid business.");
      setSaveIsError(true);
      return;
    }
    if (googleLink && !googleLinkIsValid) {
      setSaveMsg("Please enter a valid Google Business / Maps URL.");
      setSaveIsError(true);
      return;
    }

    const cleaned = slugify(slugInput);
    const slugChanged = cleaned !== bslug;

    if (!cleaned) {
      setSaveMsg("Please enter a valid business URL (letters & numbers).");
      setSaveIsError(true);
      return;
    }
    if (slugChanged && isAvailable === false) {
      setSaveMsg("That business URL is already taken.");
      setSaveIsError(true);
      return;
    }

    type Op = "description" | "google" | "slug";
    type OpResult = { name: Op; ok: boolean; message?: string };

    setSavingAll(true);
    try {
      const ops: Promise<OpResult>[] = [];

      // Description
      ops.push(
        fetch(API.UPDATE_BUSINESS_DESCRIPTION, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId, description: description || null }),
        })
          .then(async (res): Promise<OpResult> => {
            if (res.ok) return { name: "description", ok: true };
            const data = await res.json().catch(() => ({}));
            return {
              name: "description",
              ok: false,
              message: String(data?.message || data?.error || "Could not save description."),
            };
          })
          .catch((): OpResult => ({
            name: "description",
            ok: false,
            message: "Network error saving description.",
          }))
      );

      // Google link
      ops.push(
        fetch(API.UPDATE_BUSINESS_GOOGLE_LINK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId, googleBusinessLink: googleLink || null }),
        })
          .then(async (res): Promise<OpResult> => {
            if (res.ok) return { name: "google", ok: true };
            const data = await res.json().catch(() => ({}));
            return {
              name: "google",
              ok: false,
              message: String(data?.message || data?.error || "Could not save Google link."),
            };
          })
          .catch((): OpResult => ({
            name: "google",
            ok: false,
            message: "Network error saving Google link.",
          }))
      );

      // Slug (optional)
      if (slugChanged) {
        ops.push(
          fetch(API.UPDATE_BUSINESS_SLUG, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ businessId, newSlug: cleaned }),
          })
            .then(async (res): Promise<OpResult> => {
              if (res.ok) return { name: "slug", ok: true };
              const data = await res.json().catch(() => ({}));
              return {
                name: "slug",
                ok: false,
                message: String(data?.message || data?.error || "Could not update business URL."),
              };
            })
            .catch((): OpResult => ({
              name: "slug",
              ok: false,
              message: "Network error saving business URL.",
            }))
        );
      }

      const results = await Promise.all(ops);
      const failed = results.filter((r) => !r.ok);

      if (failed.length === 0) {
        setSaveMsg("All changes saved.");
        setSaveIsError(false);

        // If slug changed, navigate to the new route (your routing shape)
        if (slugChanged && results.some((r) => r.name === "slug" && r.ok)) {
          router.push(`/dashboard/${accountSlug}/${cleaned}/settings/business-settings`);
        }
      } else {
        const msg = failed
          .map((f) => {
            if (f.name === "description") return `Description: ${f.message}`;
            if (f.name === "google") return `Google link: ${f.message}`;
            if (f.name === "slug") return `Business URL: ${f.message}`;
            return f.message || "Unknown error";
          })
          .join("  •  ");
        setSaveMsg(msg);
        setSaveIsError(true);
      }
    } finally {
      setSavingAll(false);
    }
  };

  /* ============================ UI ============================ */
  return (
    <div className="min-h-screen">
      <main className="w-full max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-200">
          <h1 className="text-base font-semibold text-gray-900">
            {displayName ? `${displayName} Settings` : "Business Settings"}
          </h1>
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={
              savingAll ||
              loadingInfo ||
              !authed ||
              !businessId ||
              !slugify(slugInput) ||
              (googleLink ? !googleLinkIsValid : false) ||
              (slugInput !== bslug && isAvailable === false)
            }
            className="inline-flex items-center rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:border-indigo-300 disabled:bg-indigo-300"
          >
            {savingAll ? "Saving…" : "Save changes"}
          </button>
        </div>

        {/* Load error */}
        {loadError && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {/* Global save status */}
        {saveMsg && (
          <div
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              saveIsError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {saveMsg}
          </div>
        )}

        {/* Sections */}
        <div className="mt-6 divide-y divide-gray-200">
          {/* Logo */}
          <section className="py-6">
            <h2 className="text-sm font-medium text-gray-900 mb-3">Profile Photo (Company Logo)</h2>
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 overflow-hidden rounded-full bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={localPreview || logoUrl || "/DefaultPic.png"}
                  alt="Company logo"
                  className="h-full w-full object-contain p-1"
                  onError={(e) => {
                    if (!e.currentTarget.src.endsWith("/DefaultPic.png")) {
                      e.currentTarget.src = "/DefaultPic.png";
                    }
                  }}
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onPick(e.target.files?.[0] ?? undefined)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
                >
                  Choose image
                </button>
                <button
                  type="button"
                  onClick={handleUploadLogo}
                  disabled={!file || uploading || !businessId}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
              </div>
            </div>

            {uploadMsg && (
              <div
                className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                  uploadIsError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                {uploadMsg}
              </div>
            )}
          </section>

          {/* Description */}
          <section className="py-6">
            <div className="mb-2">
              <h2 className="text-sm font-medium text-gray-900">Business Description</h2>
              <p className="text-xs text-gray-500">Optional • Used to make generated reviews feel authentic.</p>
            </div>
            {loadingInfo ? (
              <div className="h-28 rounded-md border border-gray-200 bg-gray-50 animate-pulse" />
            ) : (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder={"A short description of what you do.\nWe will use this to make generated reviews more authentic."}
              />
            )}
          </section>

          {/* Google Link */}
          <section className="py-6">
            <h2 className="mb-2 text-sm font-medium text-gray-900">Google Business / Maps URL</h2>
            {loadingInfo ? (
              <div className="h-10 rounded-md border border-gray-200 bg-gray-50 animate-pulse" />
            ) : (
              <>
                <input
                  type="url"
                  value={googleLink}
                  onChange={(e) => setGoogleLink(e.target.value)}
                  placeholder="https://g.page/your-business or https://maps.google.com/..."
                  className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 ${
                    googleLink && !googleLinkIsValid
                      ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                      : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
                  }`}
                />
                {!googleLinkIsValid && googleLink && (
                  <div className="mt-2 text-xs text-red-600">That doesn’t look like a valid Google Business/Maps link.</div>
                )}
              </>
            )}
          </section>

          {/* Business URL (slug) */}
          <section className="py-6">
            <h2 className="mb-2 text-sm font-medium text-gray-900">Business URL</h2>
            <div className="grid gap-2">
              <label className="text-xs text-gray-600">Your unique business slug</label>
              <input
                type="text"
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                placeholder={bslug || "your-business"}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <div className="text-xs text-gray-600">
                The business dashboard URL will be:{" "}
                <code className="rounded bg-gray-100 px-1.5 py-0.5">{prettyURL}</code>
              </div>

              {slugInput !== bslug && (
                <div className="text-xs">
                  {checkingAvail ? (
                    <span className="text-gray-500">Checking availability…</span>
                  ) : isAvailable === true ? (
                    <span className="text-emerald-700">Available ✓</span>
                  ) : isAvailable === false ? (
                    <span className="text-red-600">Already taken ✗</span>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
