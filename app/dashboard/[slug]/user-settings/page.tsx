// app/dashboard/[slug]/user-settings/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/app/lib/auth-client";
import { API, ROUTES } from "@/app/lib/constants";
import { useUser } from "@/app/lib/UserContext";
import BackgroundSea from "@/app/ui/background-sea";

/* helpers */
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

export default function UserSettingsPage() {
  const router = useRouter();
  const params = useParams();
  const userSlugParam =
    (Array.isArray(params?.slug) ? params!.slug[0] : (params?.slug as string)) || "";

  const { name: currentSlugCtx, display: currentDisplayCtx } = useUser();

  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? "";
  const fallbackDisplay = session?.user?.name || "";

  // Local state
  const [displayName, setDisplayName] = useState<string>(
    currentDisplayCtx || fallbackDisplay || ""
  );
  const [slugInput, setSlugInput] = useState<string>(currentSlugCtx || userSlugParam || "");

  const prettySlug = slugify(slugInput);
  const prettyURL = useMemo(
    () => (prettySlug ? `${ROUTES.DASHBOARD}/${prettySlug}` : `${ROUTES.DASHBOARD}/[your-slug]`),
    [prettySlug]
  );
  const currentSlug = currentSlugCtx || userSlugParam || "";

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveIsError, setSaveIsError] = useState(false);

  const changedDisplay =
    (displayName || "").trim() !== (currentDisplayCtx || fallbackDisplay || "");
  const changedSlug = !!prettySlug && prettySlug !== currentSlug;

  const canSave =
    !!userId &&
    !!(displayName || "").trim() &&
    !!prettySlug &&
    (changedDisplay || changedSlug) &&
    !saving;

  const handleSave = async () => {
    setSaveMsg(null);
    setSaveIsError(false);

    if (!userId) {
      setSaveMsg("You must be signed in.");
      setSaveIsError(true);
      return;
    }
    if (!(displayName || "").trim()) {
      setSaveMsg("Display name cannot be empty.");
      setSaveIsError(true);
      return;
    }
    if (!prettySlug) {
      setSaveMsg("Please enter a valid slug (letters & numbers).");
      setSaveIsError(true);
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = { userId };
      if (changedDisplay) payload.displayName = (displayName || "").trim();
      if (changedSlug) payload.slug = prettySlug;

      const r = await fetch(API.SAVE_USER_SETTINGS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        const msg = data?.message || data?.error || "Could not save settings.";
        setSaveMsg(String(msg));
        setSaveIsError(true);
        return;
      }

      const newDisplay: string | undefined = data?.user?.displayName;
      const newSlug: string | undefined = data?.user?.slug;
      const slugConflict: boolean = Boolean(data?.slugConflict);
      const apiMessage: string | undefined = data?.message;

      // Reflect whatever the server successfully saved
      if (typeof newDisplay === "string") setDisplayName(newDisplay);
      if (typeof newSlug === "string") setSlugInput(newSlug);

      if (slugConflict) {
        setSaveMsg(apiMessage || "Slug is not unique. Display name was saved; slug unchanged.");
        setSaveIsError(false);
        router.refresh();
        return;
      }

      setSaveMsg("Changes saved.");
      setSaveIsError(false);

      if (changedSlug && typeof newSlug === "string" && newSlug !== currentSlug) {
        router.push(`${ROUTES.DASHBOARD}/${encodeURIComponent(newSlug)}/user-settings`);
      } else {
        router.refresh();
      }
    } catch {
      setSaveMsg("Network error saving settings.");
      setSaveIsError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen">
      <BackgroundSea />

      <div className="relative z-10 mx-auto w-full max-w-3xl px-6 py-10">
        {/* Top bar (match dashboard tone) */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">User settings</h1>
            <p className="mt-1 text-sm text-slate-600">
              Update your display name and dashboard URL slug.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`${ROUTES.DASHBOARD}/${encodeURIComponent(currentSlug || slugInput || "")}`}
              className="inline-flex items-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-md ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            >
              Back to dashboard
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {/* Status message */}
        {saveMsg && (
          <div
            role="status"
            aria-live="polite"
            className={`mt-5 rounded-xl px-4 py-3 text-sm shadow-sm ring-1 ${
              saveIsError
                ? "bg-rose-50 text-rose-800 ring-rose-200"
                : "bg-emerald-50 text-emerald-800 ring-emerald-200"
            }`}
          >
            {saveMsg}
          </div>
        )}

        {/* Card */}
        <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-300">
          <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Profile</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              These details personalise your dashboard and URL.
            </p>
          </div>

          <div className="space-y-8 p-6">
            {/* Display name */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-900">Display name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name as seen in the app"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">Shown wherever your name appears in the app.</p>
            </div>

            {/* Slug */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-900">Dashboard URL slug</label>
              <input
                type="text"
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                placeholder={currentSlug || "your-slug"}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="mt-2 text-xs text-slate-600">
                Your dashboard will be:{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5">{prettyURL}</code>
              </div>
              <div className="mt-1 text-xs text-slate-500">We’ll check availability when you save.</div>
            </div>
          </div>

          {/* Footer actions (secondary save/back for long screens) */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
            <Link
              href={`${ROUTES.DASHBOARD}/${encodeURIComponent(currentSlug || slugInput || "")}`}
              className="inline-flex items-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
