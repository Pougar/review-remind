// app/dashboard/[slug]/[bslug]/clients/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { authClient } from "@/app/lib/auth-client";
import { useUser } from "@/app/lib/UserContext";
import { API } from "@/app/lib/constants";
import AddClientForm from "@/app/ui/clients/AddClientForm";
import BackgroundSea from "@/app/ui/background-sea";

/* ---------------- Types from /api/get-clients ---------------- */
type Client = {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  sentiment: "good" | "bad" | "unreviewed";

  // Derived/textual
  review: string | null;

  // Invoice status enum is stored in DB; API returns text
  invoice_status: "PAID" | "SENT" | "DRAFT" | "PAID BUT NOT SENT" | null;

  // Timeline & canonical stage (from API)
  added_at: string; // ISO
  email_last_sent_at: string | null;
  click_at: string | null;
  review_submitted_at: string | null;
  stage: "review_submitted" | "button_clicked" | "email_sent" | "no_email_sent";
  stage_at: string | null;
};

type GetBizIdResp = { id?: string };
type GetClientsResp = Client[] | { clients?: Client[] };

/* -------- Google review sync/link types -------- */

type GoogleMatch = {
  google_review_id: string;
  client_id: string;
  author_name: string | null;
  display_name: string | null;
};

type SyncGoogleReviewsResp = {
  success?: boolean;
  businessId?: string;
  matchCount?: number;
  matches?: GoogleMatch[];
  error?: string;
  message?: string;
};

type LinkGrToClientsResp = {
  success?: boolean;
  businessId?: string;
  linkedCount?: number;
  results?: {
    google_review_id: string;
    client_id: string;
    review_id: string;
    author_name: string | null;
    display_name: string | null;
  }[];
  error?: string;
  message?: string;
};

const googleMatchKey = (m: GoogleMatch) => `${m.google_review_id}:${m.client_id}`;

/* Small helper: safe typed JSON */
async function safeJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

const isUUID = (v?: string) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

export default function ClientsPage() {
  const params = useParams() as { slug?: string; bslug?: string };
  const bslug = params.bslug ?? "";

  const { display } = useUser();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;

  /* ---------------- Resolve businessId from bslug ---------------- */
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [resolvingBiz, setResolvingBiz] = useState(true);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  const [selected, setSelected] = useState<Client | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setResolvingBiz(true);
      setResolveErr(null);
      try {
        if (!bslug) throw new Error("Missing business slug.");
        const res = await fetch(API.GET_BUSINESS_ID_BY_SLUG, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ businessSlug: bslug }),
        });
        if (res.status === 404) throw new Error("Business not found.");
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `Failed to resolve business (${res.status})`);
        }
        const data = await safeJson<GetBizIdResp>(res);
        if (!data?.id) throw new Error("Business id missing in response.");
        if (alive) setBusinessId(String(data.id));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to resolve business.";
        if (alive) setResolveErr(msg);
      } finally {
        if (alive) setResolvingBiz(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bslug]);

  /* ---------------- Clients state ---------------- */
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refreshClients = useCallback(
    async (bizId?: string | null) => {
      const id = bizId ?? businessId;
      if (!id) return;
      try {
        const res = await fetch(API.GET_CLIENTS, {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId: id }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to load clients (${res.status}) ${text}`);
        }
        const data = await safeJson<GetClientsResp>(res);
        const list: Client[] = Array.isArray(data) ? data : data.clients ?? [];
        setClients(list);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load clients";
        setErr(msg);
      }
    },
    [businessId]
  );

  // Initial load after business resolves
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!businessId) return;
      setLoading(true);
      setErr(null);
      try {
        await refreshClients(businessId);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [businessId, refreshClients]);

  /* ---------------- Xero import (business-scoped) ---------------- */
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // date dropdown for Xero
  const [dateOpen, setDateOpen] = useState(false);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setDateOpen(false);
    }
    if (dateOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [dateOpen]);

  const formattedSince = useMemo(() => {
    if (!year && !month && !day) return null;
    const y = year.padStart(4, "0");
    const m = month.padStart(2, "0");
    const d = day.padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [year, month, day]);

  const dateValid = useMemo(() => {
    if (!year || !month || !day) return false;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) return false;
    if (!Number.isInteger(m) || m < 1 || m > 12) return false;
    const maxDay = new Date(y, m, 0).getDate();
    if (!Number.isInteger(d) || d < 1 || d > maxDay) return false;
    return true;
  }, [year, month, day]);

  type XeroImportBody = { businessId: string; createdBy: string; since?: string };

  const syncFromXero = useCallback(
    async (since?: string | null) => {
      if (!userId || !businessId) return;
      setSyncErr(null);
      setSyncing(true);
      try {
        const body: XeroImportBody = {
          businessId,
          createdBy: userId,
          ...(since && since.trim() ? { since: since.trim() } : {}),
        };

        const res = await fetch(API.GET_CLIENTS_FROM_XERO, {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Sync failed (${res.status}) ${text}`);
        }
        await refreshClients();
        setDateOpen(false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to import from Xero";
        setSyncErr(msg);
      } finally {
        setSyncing(false);
      }
    },
    [userId, businessId, refreshClients]
  );

  /* ---------------- Google reviews sync (manual link flow) ---------------- */

  const [gSyncErr, setGSyncErr] = useState<string | null>(null);
  const [gSyncing, setGSyncing] = useState(false);

  const [gMatches, setGMatches] = useState<GoogleMatch[] | null>(null);
  const [gModalOpen, setGModalOpen] = useState(false);
  const [gSelectedKeys, setGSelectedKeys] = useState<Set<string>>(new Set());
  const [gLinking, setGLinking] = useState(false);

  // helper: resolve businessId if for some reason it's not yet set
  const resolveBusinessIdIfNeeded = useCallback(async () => {
    if (businessId) return businessId;
    if (!bslug) throw new Error("Missing business slug.");

    const res = await fetch(API.GET_BUSINESS_ID_BY_SLUG, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ businessSlug: bslug }),
    });
    if (res.status === 404) throw new Error("Business not found.");
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `Failed to resolve business (${res.status})`);
    }
    const data = await safeJson<GetBizIdResp>(res);
    if (!data?.id) throw new Error("Business id missing in response.");
    setBusinessId(String(data.id));
    return String(data.id);
  }, [businessId, bslug]);

  const syncWithGoogleReviews = useCallback(async () => {
    setGSyncErr(null);
    setGSyncing(true);
    try {
      const id = await resolveBusinessIdIfNeeded();

      const res = await fetch(API.CLIENTS_SYNC_GOOGLE_REVIEWS, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: id }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google sync failed (${res.status}) ${text}`);
      }

      const data = await safeJson<SyncGoogleReviewsResp>(res);
      const matches = data.matches ?? [];

      if (!matches.length) {
        setGMatches(null);
        setGModalOpen(false);
        setGSyncErr("No potential matches found between Google reviews and your clients.");
        return;
      }

      setGMatches(matches);
      setGSelectedKeys(new Set(matches.map(googleMatchKey))); // default: all selected
      setGModalOpen(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to sync with Google reviews";
      setGSyncErr(msg);
    } finally {
      setGSyncing(false);
    }
  }, [resolveBusinessIdIfNeeded]);

  const linkSelectedGoogleMatches = useCallback(
    async () => {
      if (!businessId || !gMatches || gMatches.length === 0) {
        setGModalOpen(false);
        return;
      }

      const selected = gMatches.filter((m) => gSelectedKeys.has(googleMatchKey(m)));
      if (!selected.length) {
        setGModalOpen(false);
        return;
      }

      setGLinking(true);
      setGSyncErr(null);

      try {
        const res = await fetch(API.LINK_GR_TO_CLIENTS, {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            matches: selected,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Linking failed (${res.status}) ${text}`);
        }

        const data = await safeJson<LinkGrToClientsResp>(res);
        if (data.error || data.success === false) {
          throw new Error(data.message || data.error || "Linking failed");
        }

        // Refresh clients so the UI reflects new links
        await refreshClients();

        setGModalOpen(false);
        setGMatches(null);
        setGSelectedKeys(new Set());
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to link Google reviews to clients";
        setGSyncErr(msg);
      } finally {
        setGLinking(false);
      }
    },
    [businessId, gMatches, gSelectedKeys, refreshClients]
  );

  /* ---------------- Bulk email (business-scoped) ---------------- */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  const toggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const allSelected = useMemo(
    () => selectedIds.size > 0 && selectedIds.size === clients.length,
    [selectedIds, clients.length]
  );
  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(() => (checked ? new Set(clients.map((c) => c.id)) : new Set()));
    },
    [clients]
  );

  const sendBulkEmails = useCallback(async () => {
    if (!businessId || selectedIds.size === 0) return;
    setBulkErr(null);
    setBulkSending(true);
    try {
      const res = await fetch(API.EMAILS_SEND_BULK, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, clientIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Bulk send failed (${res.status}) ${text}`);
      }
      setSelectedIds(new Set());
      await refreshClients();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send emails to selected clients";
      setBulkErr(msg);
    } finally {
      setBulkSending(false);
    }
  }, [businessId, selectedIds, refreshClients]);

  /* ---------------- Add Client modal ---------------- */
  const [showAdd, setShowAdd] = useState(false);
  const openAdd = useCallback(() => setShowAdd(true), []);
  const closeAdd = useCallback(() => setShowAdd(false), []);

  /* ---------------- Helpers & derived ---------------- */
  const formatDateOnly = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";

  // Sorting: Never emailed first, then by oldest last email → newest.
  // Among "never emailed", tie-break by added_at oldest → newest.
  const sortedClients = useMemo(() => {
    const copy = [...clients];
    copy.sort((a, b) => {
      const aSent = a.email_last_sent_at ? 1 : 0;
      const bSent = b.email_last_sent_at ? 1 : 0;
      if (aSent !== bSent) return aSent - bSent;

      if (!a.email_last_sent_at && !b.email_last_sent_at) {
        return new Date(a.added_at).getTime() - new Date(b.added_at).getTime();
      }
      return (
        new Date(a.email_last_sent_at || 0).getTime() -
        new Date(b.email_last_sent_at || 0).getTime()
      );
    });
    return copy;
  }, [clients]);

  const empty = !loading && !err && sortedClients.length === 0;

  return (
    <div className="min-h-screen w-full">
      <BackgroundSea />
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <header className="mb-4 flex items-start justify-between gap-4 relative z-30">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Your Clients</h1>
            <p className="text-sm text-gray-600">Click a row to read the review</p>
          </div>

          {/* Actions */}
          <div className="flex flex-col items-end gap-2" ref={menuRef}>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-gray-500">
                Signed in as <span className="font-semibold">{display}</span>
              </p>

              {/* Google Reviews sync (manual linking) */}
              <button
                onClick={syncWithGoogleReviews}
                disabled={gSyncing}
                className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-60"
              >
                {gSyncing ? (
                  <>
                    <Spinner className="h-4 w-4" /> Syncing…
                  </>
                ) : (
                  "Sync with Google"
                )}
              </button>

              {/* Xero import */}
              <button
                onClick={() => setDateOpen((v) => !v)}
                disabled={!businessId}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60"
                aria-expanded={dateOpen}
                aria-controls="xero-date-panel"
              >
                {syncing ? (
                  <>
                    <Spinner className="h-4 w-4" /> Importing…
                  </>
                ) : (
                  "Import from Xero"
                )}
              </button>

              {/* Add Client (modal) */}
              <button
                onClick={openAdd}
                disabled={!businessId}
                className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60"
                aria-label="Add Client"
              >
                Add Client
              </button>
            </div>

            {/* Xero Date Panel */}
            {dateOpen && (
              <div
                id="xero-date-panel"
                role="dialog"
                aria-label="Choose date to import clients after"
                className="absolute right-0 top-12 z-50 w-[320px] rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
                onKeyDown={(e) => e.key === "Escape" && setDateOpen(false)}
              >
                <div className="mb-2 text-sm font-semibold text-gray-800">
                  Clients after
                </div>

                <div className="mb-2 grid grid-cols-3 gap-2">
                  <NumericInput
                    label="Year (YYYY)"
                    value={year}
                    onChange={setYear}
                    maxLength={4}
                    placeholder="YYYY"
                    focusColor="emerald"
                  />
                  <NumericInput
                    label="Month (MM)"
                    value={month}
                    onChange={setMonth}
                    maxLength={2}
                    placeholder="MM"
                    focusColor="emerald"
                  />
                  <NumericInput
                    label="Day (DD)"
                    value={day}
                    onChange={setDay}
                    maxLength={2}
                    placeholder="DD"
                    focusColor="emerald"
                    onEnter={() =>
                      dateValid && syncFromXero(formattedSince)
                    }
                  />
                </div>

                <div className="mb-2 text-xs text-gray-500">
                  Example: <code>2025</code> / <code>06</code> / <code>01</code>
                </div>
                {!dateValid && (year || month || day) && (
                  <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                    Please enter a valid date.
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    onClick={() => {
                      setYear("");
                      setMonth("");
                      setDay("");
                      setDateOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      syncing ||
                      (year || month || day ? !dateValid : false)
                    }
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
                    onClick={() => {
                      const since =
                        year || month || day
                          ? dateValid
                            ? formattedSince
                            : null
                          : null;
                      syncFromXero(since ?? undefined);
                    }}
                  >
                    {syncing ? "Importing…" : "Import"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Error banners */}
        {resolveErr && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {resolveErr}
          </div>
        )}
        {syncErr && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {syncErr}
          </div>
        )}
        {gSyncErr && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {gSyncErr}
          </div>
        )}
        {err && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        {/* Bulk toolbar */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm text-gray-600">
            {selectedIds.size === 0 ? (
              "No clients selected."
            ) : (
              <>
                <span className="font-medium">
                  {selectedIds.size}
                </span>{" "}
                selected.
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {bulkErr && (
              <div className="text-sm text-red-600">{bulkErr}</div>
            )}
            <button
              onClick={sendBulkEmails}
              disabled={
                !businessId || selectedIds.size === 0 || bulkSending
              }
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 ${
                selectedIds.size === 0
                  ? "bg-gray-100 text-gray-400 ring-gray-200 cursor-not-allowed"
                  : "bg-blue-600 text-white ring-blue-300 hover:bg-blue-700"
              }`}
            >
              {bulkSending ? (
                <>
                  <Spinner className="h-4 w-4" /> Sending emails…
                </>
              ) : (
                "Send email to selected clients"
              )}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-sky-200/40 bg-sky-50/10 shadow-[0_30px_60px_-20px_rgba(2,6,23,0.25)] overflow-x-auto supports-[backdrop-filter]:bg-sky-50/5 supports-[backdrop-filter]:backdrop-blur-md supports-[backdrop-filter]:backdrop-brightness-105 supports-[backdrop-filter]:backdrop-saturate-110">
          {/* header row (6 columns) */}
          <div className="grid grid-cols-6 gap-4 px-4 py-3 text-left text-sm font-semibold text-slate-900/90 border-b border-sky-200/50 bg-sky-50/15 supports-[backdrop-filter]:bg-sky-50/10">
            <div className="flex items-center gap-2">
              <ClickTargetCheckbox
                checked={allSelected}
                onChange={(checked) => toggleSelectAll(checked)}
                ariaLabel="Select all clients"
              />
              <span>Name</span>
            </div>
            <div>Email</div>
            <div>Phone</div>
            <div>Added</div>
            <div className="text-center">Invoice Status</div>
            <div className="text-center">Status</div>
          </div>

          {/* body */}
          {loading || resolvingBiz ? (
            <SkeletonRows cols={6} />
          ) : empty ? (
            <div className="p-6 text-sm text-gray-600">
              No clients yet. Use{" "}
              <span className="font-medium">Add Client</span> or{" "}
              <span className="font-medium">Import from Xero</span> to get
              started.
            </div>
          ) : (
            <ul className="divide-y divide-slate-200/70 bg-transparent">
              {sortedClients.map((c) => {
                const rowChecked = selectedIds.has(c.id);
                return (
                  <li
                    key={c.id}
                    className={`grid grid-cols-6 gap-4 px-4 py-3 text-sm cursor-pointer transition-colors hover:bg-slate-500/5 focus:outline-none ${
                      rowChecked ? "bg-blue-500/10" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(c);
                      }
                    }}
                  >
                    {/* Name + checkbox */}
                    <div className="truncate font-medium text-slate-900 flex items-center gap-2">
                      <ClickTargetCheckbox
                        checked={rowChecked}
                        onChange={(checked) =>
                          toggleSelect(c.id, checked)
                        }
                        ariaLabel={`Select ${c.name}`}
                        stopRowClick
                      />
                      <span className="truncate">
                        {c.name}
                      </span>
                    </div>

                    <div className="truncate text-slate-800">
                      {c.email || "—"}
                    </div>
                    <div className="truncate text-slate-800">
                      {c.phone_number || "—"}
                    </div>
                    <div className="text-slate-800">
                      {formatDateOnly(c.added_at)}
                    </div>

                    {/* Invoice Status */}
                    <div className="justify-self-center self-center">
                      <InvoiceStatusBadge
                        status={c.invoice_status}
                      />
                    </div>

                    {/* Single Status cell */}
                    <div className="justify-self-center self-center">
                      <StatusCell
                        emailLastSentAt={c.email_last_sent_at}
                        clickAt={c.click_at}
                        submittedAt={c.review_submitted_at}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Row click → review modal */}
      {selected && (
        <Modal
          onClose={() => setSelected(null)}
          title={`Review from ${selected.name}`}
        >
          <ReviewContent
            sentiment={selected.sentiment}
            review={selected.review}
          />
        </Modal>
      )}

      {/* Add Client modal */}
      {showAdd && businessId && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add Client"
          onKeyDown={(e) => e.key === "Escape" && closeAdd()}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeAdd}
          />
          <div className="relative z-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Add Client
              </h2>
              <button
                type="button"
                onClick={closeAdd}
                className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <AddClientForm
              businessId={businessId}
              disabledHeader
              onSuccess={async () => {
                closeAdd();
                await refreshClients();
              }}
            />
          </div>
        </div>
      )}

      {/* Google Sync → selection modal */}
      {gModalOpen && gMatches && gMatches.length > 0 && (
        <GoogleSyncModal
          matches={gMatches}
          selectedKeys={gSelectedKeys}
          onToggle={(key, checked) => {
            setGSelectedKeys((prev) => {
              const next = new Set(prev);
              if (checked) next.add(key);
              else next.delete(key);
              return next;
            });
          }}
          onToggleAll={(checked) => {
            if (!gMatches) return;
            setGSelectedKeys(
              checked
                ? new Set(gMatches.map(googleMatchKey))
                : new Set()
            );
          }}
          onClose={() => {
            if (!gLinking) setGModalOpen(false);
          }}
          onSubmit={linkSelectedGoogleMatches}
          linking={gLinking}
        />
      )}
    </div>
  );
}

/* ---------- UI pieces ---------- */

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function NumericInput({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  focusColor = "emerald",
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  placeholder: string;
  focusColor?: "emerald" | "blue" | "sky";
  onEnter?: () => void;
}) {
  const focusClass =
    focusColor === "blue"
      ? "focus:border-blue-500"
      : focusColor === "sky"
      ? "focus:border-sky-500"
      : "focus:border-emerald-500";

  return (
    <input
      inputMode="numeric"
      pattern="\\d*"
      maxLength={maxLength}
      placeholder={placeholder}
      value={value}
      onChange={(e) =>
        onChange(
          e.target.value.replace(/\D/g, "").slice(0, maxLength)
        )
      }
      className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none ${focusClass}`}
      aria-label={label}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
    />
  );
}

function SkeletonRows({ cols = 6 }: { cols?: number }) {
  const gridColsClass =
    cols === 6
      ? "grid-cols-6"
      : cols === 5
      ? "grid-cols-5"
      : cols === 4
      ? "grid-cols-4"
      : cols === 3
      ? "grid-cols-3"
      : "grid-cols-2";

  return (
    <div className="animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`grid ${gridColsClass} gap-4 px-4 py-3`}
        >
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-4 w-56 rounded bg-gray-200" />
          <div className="h-4 w-32 rounded bg-gray-200" />
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-6 w-36 rounded bg-gray-200 justify-self-center" />
          <div className="h-6 w-40 rounded bg-gray-200 justify-self-center" />
        </div>
      ))}
    </div>
  );
}

function InvoiceStatusBadge({
  status,
}: {
  status: Client["invoice_status"];
}) {
  let label = status ?? "—";
  let styles = "bg-gray-100 text-gray-700 ring-gray-200";

  switch (status) {
    case "PAID":
      styles =
        "bg-green-100 text-green-800 ring-green-200";
      break;
    case "SENT":
      styles =
        "bg-sky-100 text-sky-800 ring-sky-200";
      break;
    case "DRAFT":
      styles =
        "bg-gray-100 text-gray-700 ring-gray-200";
      break;
    case "PAID BUT NOT SENT":
      styles =
        "bg-green-100 text-green-800 ring-green-200";
      break;
    default:
      label = "—";
      styles =
        "bg-gray-100 text-gray-700 ring-gray-200";
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles}`}
    >
      {label}
    </span>
  );
}

function StatusCell({
  emailLastSentAt,
  clickAt,
  submittedAt,
}: {
  emailLastSentAt: string | null;
  clickAt: string | null;
  submittedAt: string | null;
}) {
  let label = "No email sent";
  let when: string | null = null;
  let styles =
    "bg-gray-100 text-gray-700 ring-gray-200";

  if (submittedAt) {
    label = "Review submitted";
    when = new Date(submittedAt).toLocaleString();
    styles =
      "bg-green-50 text-green-800 ring-green-200";
  } else {
    const clickTime = clickAt
      ? new Date(clickAt).getTime()
      : null;
    const emailTime = emailLastSentAt
      ? new Date(emailLastSentAt).getTime()
      : null;

    if (clickTime !== null || emailTime !== null) {
      const mostRecent =
        clickTime !== null && emailTime !== null
          ? Math.max(clickTime, emailTime)
          : (clickTime ?? emailTime)!;

      if (clickTime !== null && mostRecent === clickTime) {
        label = "Button clicked";
        when = new Date(clickTime).toLocaleString();
        styles =
          "bg-amber-50 text-amber-800 ring-amber-200";
      } else if (emailTime !== null) {
        label = "Last email sent";
        when = new Date(emailTime).toLocaleString();
        styles =
          "bg-blue-50 text-blue-800 ring-blue-200";
      }
    }
  }

  return (
    <div className="flex flex-col items-center">
      <span
        className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles}`}
      >
        {label}
      </span>
      <span className="mt-1 text-[11px] text-gray-500">
        {when ?? "—"}
      </span>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-800">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="text-sm text-gray-800">
          {children}
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewContent({
  sentiment,
  review,
}: {
  sentiment: Client["sentiment"];
  review: string | null;
}) {
  const hint = useMemo(() => {
    const v = sentiment?.toLowerCase();
    if (v === "good")
      return "This client left a positive sentiment.";
    if (v === "bad")
      return "This client left a negative sentiment.";
    return "This client hasn’t been reviewed yet.";
  }, [sentiment]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">
          Sentiment:
        </span>
        <span className="inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium ring-1 bg-gray-100 text-gray-700 ring-gray-200">
          {hint}
        </span>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-800">
        {review?.trim() ? (
          <p className="whitespace-pre-wrap leading-relaxed">
            {review}
          </p>
        ) : (
          <p className="text-gray-500">
            No review text provided.
          </p>
        )}
      </div>
    </div>
  );
}

function ClickTargetCheckbox({
  checked,
  onChange,
  ariaLabel,
  stopRowClick = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  stopRowClick?: boolean;
}) {
  return (
    <label
      className="-m-2 inline-flex items-center p-2 rounded-md select-none"
      onClick={
        stopRowClick
          ? (e) => e.stopPropagation()
          : undefined
      }
      onMouseDown={
        stopRowClick
          ? (e) => e.stopPropagation()
          : undefined
      }
    >
      <input
        type="checkbox"
        aria-label={ariaLabel}
        className="h-4 w-4 rounded border-gray-300 text-blue-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        onClick={
          stopRowClick
            ? (e) => e.stopPropagation()
            : undefined
        }
        onMouseDown={
          stopRowClick
            ? (e) => e.stopPropagation()
            : undefined
        }
      />
    </label>
  );
}

/* ---------- Google Sync Modal ---------- */

function GoogleSyncModal({
  matches,
  selectedKeys,
  onToggle,
  onToggleAll,
  onClose,
  onSubmit,
  linking,
}: {
  matches: GoogleMatch[];
  selectedKeys: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
  linking: boolean;
}) {
  const allSelected =
    matches.length > 0 &&
    matches.every((m) =>
      selectedKeys.has(googleMatchKey(m))
    );
  const someSelected =
    selectedKeys.size > 0 && !allSelected;
  const hasSelection = selectedKeys.size > 0;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Link Google reviews to clients"
      onKeyDown={(e) => e.key === "Escape" && !linking && onClose()}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !linking && onClose()}
      />
      <div className="relative z-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Link Google reviews to clients
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              Review the suggested matches below. Only the
              checked rows will be linked.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !linking && onClose()}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
            disabled={linking}
          >
            ✕
          </button>
        </div>

        <div className="mb-4 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50/40">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-700">
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={(e) =>
                      onToggleAll(e.target.checked)
                    }
                  />
                </th>
                <th className="px-3 py-2 text-left">
                  Google author
                </th>
                <th className="px-3 py-2 text-left">
                  Matching client
                </th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const key = googleMatchKey(m);
                const checked =
                  selectedKeys.has(key);
                return (
                  <tr
                    key={key}
                    className="border-t border-gray-200 bg-white hover:bg-sky-50/60"
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          onToggle(
                            key,
                            e.target.checked
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {m.author_name ||
                        "Unknown Google user"}
                    </td>
                    <td className="px-3 py-2 text-gray-900 font-medium">
                      {m.display_name ||
                        "Unnamed client"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500">
            {matches.length} suggested match
            {matches.length === 1 ? "" : "es"}.{" "}
            {hasSelection
              ? `${selectedKeys.size} selected to link.`
              : "Select at least one to link."}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !linking && onClose()}
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              disabled={linking}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={linking || !hasSelection}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow ${
                linking || !hasSelection
                  ? "bg-blue-300 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {linking ? (
                <>
                  <Spinner className="h-4 w-4" /> Linking…
                </>
              ) : (
                `Link ${
                  hasSelection
                    ? selectedKeys.size
                    : ""
                } selected`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
