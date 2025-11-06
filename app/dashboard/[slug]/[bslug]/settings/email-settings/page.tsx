"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";
import { API } from "@/app/lib/constants";

/* ============================ Helpers ============================ */
const emailLooksValid = (s: string) => /^\S+@\S+\.\S+$/.test(s);
const cap = (s?: string | null) => (s && s.trim() ? s.trim() : "");

/* ---------- Types from APIs ---------- */
type BusinessIdLookupResp = {
  id?: string;
  display_name?: string | null;
};

type BusinessDetailsResp = {
  id?: string;
  display_name?: string | null;
  business_email?: string | null;
};

type TemplateGetResp = {
  email_subject?: string | null;
  email_body?: string | null;
  businessDisplayName?: string | null;
};

type TemplateSaveResp = {
  email_subject: string;
  email_body: string;
};

/* ============================ Page ============================ */
export default function BusinessEmailTemplateSettings() {
  const params = useParams() as { slug?: string; bslug?: string };
  const bslug = params.bslug ?? "";

  // We still read session (in case we need a fallback email),
  // but the *default* should come from business_email.
  const { data: session } = authClient.useSession();

  /* ---------- Business context ---------- */
  const [businessId, setBusinessId] = useState<string | null>(null);

  // Shown in UI as the sender name (and sign-off in preview)
  const [businessName, setBusinessName] = useState<string>("Your company");

  // We'll populate this from the business_email once we load details
  const [testRecipient, setTestRecipient] = useState<string>("");

  // track if we've already initialised testRecipient from business_email
  const testRecipientInitRef = useRef(false);

  /* ---------- Template fields ---------- */
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");

  // Originals (for dirty check / reset)
  const [origSubject, setOrigSubject] = useState<string>("");
  const [origBody, setOrigBody] = useState<string>("");

  /* ---------- UI state ---------- */
  const [previewRecipient, setPreviewRecipient] = useState<string>("Customer");

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [testSending, setTestSending] = useState<boolean>(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testIsError, setTestIsError] = useState<boolean>(false);

  const [previewOpen, setPreviewOpen] = useState<boolean>(false);

  /* ---------- Derived ---------- */
  const dirty = subject !== origSubject || body !== origBody;
  const toDisplay = useMemo(() => cap(previewRecipient) || "Customer", [previewRecipient]);
  const senderName = businessName || "Your company";

  /* =========================================================
     Step 1: Resolve businessId from bslug
     ========================================================= */
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

        const data = (await res.json().catch(() => ({}))) as BusinessIdLookupResp;
        if (!alive) return;

        if (res.ok && data?.id) {
          setBusinessId(data.id);

          // set a temp name now; may get refined by GET_BUSINESS_DETAILS later
          const label = cap(data.display_name) || cap(bslug) || "Your company";
          setBusinessName(label);
        } else {
          setBusinessId(null);
          setBusinessName(cap(bslug) || "Your company");
          setError("Could not find business.");
        }
      } catch {
        if (!alive) return;
        setBusinessId(null);
        setBusinessName(cap(bslug) || "Your company");
        setError("Network error while resolving business.");
      }
    })();

    return () => {
      alive = false;
    };
  }, [bslug]);

  /* =========================================================
     Step 2: Once we have businessId: load details + template
     ========================================================= */
  useEffect(() => {
    if (!businessId) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setMsg(null);
      setError(null);

      try {
        /* ----- (A) Get business details by businessId ----- */
        const detailsRes = await fetch(API.BUSINESSES_GET_DETAILS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ businessId }),
        });

        const detailsData = (await detailsRes.json().catch(() => ({}))) as BusinessDetailsResp;

        if (alive && detailsRes.ok) {
          const cleanName =
            cap(detailsData.display_name) ||
            businessName || // fallback to what we had
            "Your company";
          setBusinessName(cleanName);

          // Default the testRecipient to business_email (only once)
          if (!testRecipientInitRef.current) {
            const fromBusiness =
              cap(detailsData.business_email) ||
              cap(session?.user?.email) ||
              "no-reply@upreview.app";
            setTestRecipient(fromBusiness);
            testRecipientInitRef.current = true;
          }
        } else if (alive && !detailsRes.ok) {
          setError("Could not load business details.");
          if (!testRecipientInitRef.current) {
            const fallbackEmail =
              cap(session?.user?.email) || "no-reply@upreview.app";
            setTestRecipient(fallbackEmail);
            testRecipientInitRef.current = true;
          }
        }

        /* ----- (B) Get email template for this businessId ----- */
        const tmplRes = await fetch(API.GET_EMAIL_TEMPLATE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ businessId }),
        });

        const tmplData = (await tmplRes.json().catch(() => ({}))) as TemplateGetResp;

        if (alive) {
          if (!tmplRes.ok) {
            setError((prev) => prev || "Could not load your email template.");
          } else {
            const subj = cap(tmplData?.email_subject) ?? "";
            const bod = tmplData?.email_body ?? "";
            setSubject(subj);
            setBody(bod);
            setOrigSubject(subj);
            setOrigBody(bod);

            // prefer display name from template call if provided
            const maybeDisplayName = cap(tmplData?.businessDisplayName);
            if (maybeDisplayName) setBusinessName(maybeDisplayName);
          }
        }
      } catch {
        if (!alive) return;
        setError("Network error while loading business data.");
        if (!testRecipientInitRef.current) {
          const fallbackEmail =
            cap(session?.user?.email) || "no-reply@upreview.app";
          setTestRecipient(fallbackEmail);
          testRecipientInitRef.current = true;
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [businessId, businessName, session?.user?.email]);

  /* =========================================================
     Actions
     ========================================================= */
  async function handleSave() {
    setSaving(true);
    setMsg(null);
    setError(null);

    if (!businessId) {
      setError("Invalid business.");
      setSaving(false);
      return;
    }

    try {
      const r = await fetch(API.SAVE_EMAIL_TEMPLATE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          email_subject: subject,
          email_body: body,
        }),
      });

      const p: TemplateSaveResp | { error?: string; message?: string } =
        await r.json().catch(() => ({} as any));

      if (!r.ok) {
        setError((p as any)?.message || (p as any)?.error || "Failed to save changes.");
        return;
      }

      const saved = p as TemplateSaveResp;
      setOrigSubject(saved.email_subject ?? subject);
      setOrigBody(saved.email_body ?? body);
      setMsg("Saved.");
    } catch {
      setError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setSubject(origSubject);
    setBody(origBody);
    setMsg(null);
    setError(null);
  }

  async function handleSendTestEmail() {
    setTestMsg(null);
    setTestIsError(false);

    const to = cap(testRecipient);
    if (!to || !emailLooksValid(to)) {
      setTestMsg("Please enter a valid email address.");
      setTestIsError(true);
      return;
    }

    if (!businessId) {
      setTestMsg("Invalid business.");
      setTestIsError(true);
      return;
    }

    setTestSending(true);
    try {
      const res = await fetch(API.SEND_TEST_EMAIL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          toEmail: to,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.error === "UNAUTHENTICATED"
            ? "Please sign in to send a test email."
            : data?.message || data?.error || "Failed to send test email.";
        throw new Error(msg);
      }

      setTestMsg(`Test email sent to ${to}.`);
      setTestIsError(false);
    } catch (e: any) {
      setTestMsg(e?.message || "Failed to send test email.");
      setTestIsError(true);
    } finally {
      setTestSending(false);
    }
  }

  /* ============================ UI ============================ */
  return (
    <main className="max-w-3xl px-6 py-8">
      {/* Page title */}
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Email template</h1>
        <p className="text-sm text-gray-600">
          Adjust the subject and body used for outreach emails for{" "}
          <span className="font-medium">{senderName}</span>.
        </p>
      </header>

      {(error || msg) && (
        <div
          className={`mb-6 border-l-4 px-4 py-2 text-sm ${
            error
              ? "border-red-500 bg-red-50 text-red-800"
              : "border-emerald-600 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || msg}
        </div>
      )}

      {/* Editor */}
      <section>
        <h2 className="mb-1 text-sm font-medium text-gray-900">Edit template</h2>
        <p className="mb-5 text-sm text-gray-600">These are the editable parts of your email.</p>

        {/* Subject */}
        <label className="mb-1 block text-sm font-medium text-gray-700">Subject</label>
        {loading ? (
          <div className="mb-3 h-10 w-full animate-pulse rounded-md border border-gray-200 bg-gray-50" />
        ) : (
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        )}
        <div className="mt-1 text-xs text-gray-500">{subject.length}/200</div>

        {/* Body */}
        <label className="mt-6 mb-1 block text-sm font-medium text-gray-700">Body</label>
        {loading ? (
          <div className="mb-3 h-40 w-full animate-pulse rounded-md border border-gray-200 bg-gray-50" />
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="h-48 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        )}
        <div className="mt-1 text-xs text-gray-500">{body.length}/8000</div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loading || !dirty}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={loading || (!dirty && !error && !msg)}
            className="rounded-md border bg-white border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset
          </button>

          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            disabled={loading}
            className="ml-auto rounded-md border bg-white border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed"
          >
            Preview email
          </button>
        </div>
      </section>

      {/* Send Test Email */}
      <section className="mt-10 border-t border-gray-200 pt-6">
        <h2 className="mb-3 text-sm font-medium text-gray-900">Send a test email</h2>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <label className="text-sm text-gray-700">Send to</label>

          <input
            type="email"
            value={testRecipient}
            onChange={(e) => setTestRecipient(e.target.value)}
            placeholder="name@example.com"
            className={`w-full rounded-md bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border focus:ring-1 sm:w-80 ${
              testRecipient && !emailLooksValid(testRecipient)
                ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
          />

          <button
            type="button"
            onClick={handleSendTestEmail}
            disabled={testSending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {testSending ? "Sending…" : "Send"}
          </button>
        </div>

        {testMsg && (
          <div
            className={`mt-3 border-l-4 px-3 py-2 text-sm ${
              testIsError
                ? "border-red-500 bg-red-50 text-red-800"
                : "border-emerald-600 bg-emerald-50 text-emerald-800"
            }`}
          >
            {testMsg}
          </div>
        )}
      </section>

      {/* ---------- PREVIEW MODAL ---------- */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Preview email"
          onKeyDown={(e) => e.key === "Escape" && setPreviewOpen(false)}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setPreviewOpen(false)}
            aria-hidden="true"
          />

          {/* Modal card */}
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 p-6 pb-0">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900">Email preview</h3>
                <p className="text-sm text-gray-600">Greeting and sign-off are added automatically.</p>
              </div>

              <div className="flex items-start gap-3">
                <div className="text-right">
                  <input
                    value={previewRecipient}
                    onChange={(e) => setPreviewRecipient(e.target.value)}
                    className="w-44 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  aria-label="Close preview"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 pt-4 overflow-auto">
              <div className="overflow-hidden rounded-md border border-gray-200">
                {/* Subject */}
                <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="text-xs text-gray-500">Subject</div>
                  <div className="font-medium text-gray-900">
                    {loading ? (
                      <span className="inline-block h-5 w-1/2 animate-pulse rounded bg-gray-200" />
                    ) : (
                      subject
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="p-4">
                  {loading ? (
                    <>
                      <div className="mb-2 h-4 w-7/12 animate-pulse rounded bg-gray-200" />
                      <div className="mb-2 h-4 w-10/12 animate-pulse rounded bg-gray-200" />
                      <div className="mb-2 h-4 w-9/12 animate-pulse rounded bg-gray-200" />
                      <div className="h-4 w-6/12 animate-pulse rounded bg-gray-200" />
                    </>
                  ) : (
                    <div className="space-y-4 text-gray-800">
                      <p>Hi {toDisplay || "Customer"},</p>

                      <p className="whitespace-pre-wrap">{body}</p>

                      <div className="mt-6 flex gap-3">
                        <a
                          href="#"
                          className="inline-block rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white no-underline hover:bg-green-700"
                          onClick={(e) => e.preventDefault()}
                        >
                          Happy
                        </a>
                        <a
                          href="#"
                          className="inline-block rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white no-underline hover:bg-red-700"
                          onClick={(e) => e.preventDefault()}
                        >
                          Unsatisfied
                        </a>
                      </div>

                      <p>
                        Best regards,
                        <br />
                        {senderName}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
