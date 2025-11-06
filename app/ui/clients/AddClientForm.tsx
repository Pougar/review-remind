"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { API } from "@/app/lib/constants";
import { useUser } from "@/app/lib/UserContext";

type Sentiment = "good" | "bad" | "unreviewed";

type FormState = {
  name: string;
  email: string;
  phone_number: string;
  sentiment: Sentiment;
  review: string;
};

export type AddClientModalProps = {
  businessId: string;                         // required
  onSuccess?: () => void | Promise<void>;     // optional
  disabledHeader?: boolean;                   // optional
  open?: boolean;                             // optional (for modal usage)
  onClose?: () => void;                       // optional (for modal usage)
};

/* ---------- helpers ---------- */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

export default function AddClientForm({
  businessId,
  onSuccess,
  disabledHeader = false,
  open = true,
  onClose,
}: AddClientModalProps) {
  const router = useRouter();
  const params = useParams() as { slug?: string; bslug?: string };
  const slug = params.slug ?? "";
  const bslug = params.bslug ?? "";
  const { display } = useUser();

  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    phone_number: "",
    sentiment: "unreviewed",
    review: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // compute after hooks are declared (no conditional hooks)
  const canSubmit = useMemo(
    () => !!businessId && !submitting,
    [businessId, submitting]
  );

  const update =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);

    if (!businessId) {
      setErr("Business not resolved yet.");
      return;
    }
    if (!form.name.trim()) {
      setErr("Name is required.");
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setErr("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(API.ADD_CLIENT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          businessId,                               // ← scope to business
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone_number: form.phone_number.trim() || null,
          initialSentiment: form.sentiment,         // optional in API
          initialReview: form.review.trim() || null // optional in API
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Request failed (${res.status})`);
      }

      setOkMsg("Client added successfully.");

      if (onSuccess) {
        await onSuccess(); // let parent refresh/close
      } else if (onClose) {
        onClose();
      } else {
        // fallback: go back to list
        router.push(`/${encodeURIComponent(slug)}/dashboard/${encodeURIComponent(bslug)}/clients`);
      }
    } catch (e: unknown) {
      setErr(getErrorMessage(e) || "Failed to add client.");
    } finally {
      setSubmitting(false);
    }
  }

  // respect `open` without conditional hooks
  if (!open) return null;

  return (
    <div className="w-full max-w-2xl">
      {!disabledHeader && (
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Add Client</h1>
          <p className="text-sm text-gray-500">
            New client will be linked to <span className="font-semibold">{display}</span>.
          </p>
        </header>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        {/* Disable the whole set when businessId is missing */}
        <fieldset disabled={!businessId} className="space-y-5">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={update("name")}
              className="w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
              placeholder="Jane Smith"
              required
            />
          </div>

          {/* Email */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={update("email")}
              className="w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
              placeholder="jane@example.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Phone number</label>
            <input
              type="tel"
              value={form.phone_number}
              onChange={update("phone_number")}
              className="w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
              placeholder="+61 412 345 678"
            />
          </div>

          {/* Sentiment */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Sentiment</label>
            <select
              value={form.sentiment}
              onChange={update("sentiment")}
              className="w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="unreviewed">Unreviewed</option>
              <option value="good">Good</option>
              <option value="bad">Bad</option>
            </select>
          </div>

          {/* Review */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Review</label>
            <textarea
              value={form.review}
              onChange={update("review")}
              className="min-h-[120px] w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:outline-none"
              placeholder="Write the client's review (optional)…"
            />
          </div>
        </fieldset>

        {/* Alerts */}
        {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        {okMsg && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{okMsg}</p>}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => (onClose ? onClose() : onSuccess ? onSuccess() : router.back())}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Adding…" : "Add Client"}
          </button>
        </div>
      </form>
    </div>
  );
}
