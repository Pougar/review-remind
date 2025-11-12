// app/api/xero/get-clients-from-xero/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- Xero endpoints ---------------- */
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";
const XERO_CONTACTS_URL = "https://api.xero.com/api.xro/2.0/Contacts";
const DEFAULT_SINCE_WHERE = "Date >= DateTime(2025, 1, 1)";
const DEFAULT_SINCE_ISO = "2025-01-01";

/* ---------------- PG pool (singleton) ---------------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolXero: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPoolXero) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolXero = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolXero;
}

/* ---------------- Xero types (minimal) ---------------- */
type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  id_token?: string;
};
type XeroContactPhone = {
  PhoneType?: "DEFAULT" | "MOBILE" | "DDI" | "FAX" | string;
  PhoneNumber?: string | null;
  PhoneAreaCode?: string | null;
  PhoneCountryCode?: string | null;
};
type XeroContact = {
  ContactID?: string;
  Name?: string;
  EmailAddress?: string | null;
  Phones?: XeroContactPhone[] | null;
  IsCustomer?: boolean | null;
};
type XeroLineItem = { Description?: string | null };
type XeroInvoice = {
  InvoiceID?: string;
  Contact?: { ContactID?: string; Name?: string } | null;
  Date?: string;
  LineItems?: XeroLineItem[] | null;
  SentToContact?: boolean | null;
  Status?: string | null;
  Type?: string | null; // <-- include invoice type so we can filter ACCREC only
};
type XeroInvoicesResponse = { Invoices?: XeroInvoice[] };
type XeroContactsResponse = { Contacts?: XeroContact[] };

/* ---------------- local types & utils ---------------- */
type InvoiceStatus = "PAID" | "SENT" | "DRAFT" | "PAID BUT NOT SENT";

const isUUID = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-fA-F-]{36}$/.test(v);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function nowPlus(ms: number) {
  return new Date(Date.now() + ms);
}
function isExpired(expiresAt?: Date | string | null, skewSec = 60): boolean {
  if (!expiresAt) return true;
  const t =
    typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt.getTime();
  return Date.now() + skewSec * 1000 >= t;
}
function pickPhone(phones?: XeroContactPhone[] | null): string | null {
  if (!phones || phones.length === 0) return null;
  const pref = ["DEFAULT", "MOBILE", "DDI", "FAX"];
  const sorted = [...phones].sort(
    (a, b) => pref.indexOf(a.PhoneType || "") - pref.indexOf(b.PhoneType || "")
  );
  for (const p of sorted) {
    const num = (p.PhoneNumber || "").trim();
    if (num) {
      const cc = (p.PhoneCountryCode || "").trim();
      const area = (p.PhoneAreaCode || "").trim();
      return [cc ? `+${cc}` : "", area, num].filter(Boolean).join(" ").trim();
    }
  }
  return null;
}
function computeInvoiceStatus(
  sentToContact?: boolean | null,
  status?: string | null
): InvoiceStatus {
  const isPaid = (status || "").toUpperCase() === "PAID";
  const sent = !!sentToContact;
  if (isPaid) return sent ? "PAID" : "PAID BUT NOT SENT";
  return sent ? "SENT" : "DRAFT";
}
function buildSinceWhere(isoDate?: string): {
  where: string;
  sinceISO: string;
} {
  const trimmed = (isoDate || "").trim();
  if (!trimmed) return { where: DEFAULT_SINCE_WHERE, sinceISO: DEFAULT_SINCE_ISO };
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid since date. Use ISO format like 2025-01-01.");
  }
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const sinceISO = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
  return { where: `Date >= DateTime(${y}, ${m}, ${day})`, sinceISO };
}

/* ---------------- External: Xero helpers ---------------- */
async function refreshAccessToken(
  refresh_token: string
): Promise<XeroTokenResponse> {
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  const resp = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Xero token refresh failed (${resp.status}): ${body}`);
  }
  return (await resp.json()) as XeroTokenResponse;
}

/**
 * Discover contacts (by ContactID) from Xero Invoices.
 * Now restricted to ACCREC* (sales) documents so we only consider true client-side activity.
 */
async function collectInvoiceContactData(
  accessToken: string,
  tenantId: string,
  sinceWhere: string
) {
  const uniqueIds = new Set<string>();
  const fallbackNames = new Map<string, string>();
  const descSets = new Map<string, Set<string>>();
  const latestByContact = new Map<
    string,
    { ts: number; sent?: boolean | null; status?: string | null }
  >();

  let page = 1;
  const maxPages = 50;
  const perPageCounts: number[] = [];

  const doFetch = (p: number) => {
    const url = new URL(XERO_INVOICES_URL);
    url.searchParams.set("page", String(p));
    url.searchParams.set("where", sinceWhere);
    return fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    });
  };

  while (page <= maxPages) {
    const resp = await doFetch(page);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed invoices page ${page}: ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as XeroInvoicesResponse;
    const list = data.Invoices ?? [];
    perPageCounts.push(list.length);
    if (list.length === 0) break;

    for (const inv of list) {
      // ---- CHANGE #1: Only consider ACCREC* (sales) invoices/credits ----
      const invType = (inv.Type || "").toUpperCase();
      if (invType && !invType.startsWith("ACCREC")) {
        // Skip ACCPAY, ACCPAYCREDIT, or any non-sales document
        continue;
      }

      const c = inv.Contact;
      const id = (c?.ContactID || "").trim();
      if (!id) continue;

      uniqueIds.add(id);
      if (c?.Name) fallbackNames.set(id, c.Name);

      const items = inv.LineItems ?? [];
      if (Array.isArray(items) && items.length) {
        let set = descSets.get(id);
        if (!set) {
          set = new Set<string>();
          descSets.set(id, set);
        }
        for (const li of items) {
          const d = (li?.Description || "").toString().trim();
          if (d) set.add(d);
        }
      }

      const ts = Date.parse(inv.Date ?? "") || 0;
      const prev = latestByContact.get(id);
      if (!prev || ts >= prev.ts) {
        latestByContact.set(id, {
          ts,
          sent: inv.SentToContact ?? null,
          status: inv.Status ?? null,
        });
      }
    }
    page += 1;
  }

  const descriptions = new Map<string, string>();
  for (const [id, set] of descSets) {
    descriptions.set(id, Array.from(set).join(" | "));
  }

  const statusByContact = new Map<string, InvoiceStatus>();
  for (const [id, info] of latestByContact) {
    statusByContact.set(id, computeInvoiceStatus(info.sent, info.status));
  }

  return {
    ids: Array.from(uniqueIds),
    names: fallbackNames,
    descriptions,
    statusByContact,
    diag: { pagesFetched: perPageCounts.length, perPageCounts },
  };
}

async function fetchContactsByIds(
  accessToken: string,
  tenantId: string,
  ids: string[],
  batchSize = 100
): Promise<{ contacts: XeroContact[]; diag: { batches: number; batchSizes: number[] } }> {
  const all: XeroContact[] = [];
  const batchSizes: number[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    batchSizes.push(slice.length);
    const url = `${XERO_CONTACTS_URL}?IDs=${slice
      .map(encodeURIComponent)
      .join(",")}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `Failed contacts batch (${i}-${i + slice.length - 1}): ${resp.status} ${text}`
      );
    }
    const data = (await resp.json()) as XeroContactsResponse;
    if (data?.Contacts?.length) all.push(...data.Contacts);
  }

  return { contacts: all, diag: { batches: batchSizes.length, batchSizes } };
}

/* ---------------- DB: upsert client for a business ---------------- */
async function upsertClientForBusiness(
  client: PoolClient,
  params: {
    businessId: string;
    createdBy: string | null; // allow NULL if not a UUID
    xeroContactId: string; // must be UUID from Xero
    nameIn: string;
    emailIn: string | null;
    phoneIn: string | null;
    itemDescriptionIn: string | null;
    invoiceStatusIn: InvoiceStatus | null;
  }
): Promise<"inserted" | "updated"> {
  const {
    businessId,
    createdBy,
    xeroContactId,
    nameIn,
    emailIn,
    phoneIn,
    itemDescriptionIn,
    invoiceStatusIn,
  } = params;

  const name = (nameIn || "").trim() || "(Unknown Contact)";
  const email = (emailIn || "")?.trim() || null;
  const phone = (phoneIn || "")?.trim() || null;
  const itemDesc = (itemDescriptionIn || "").trim() || null;
  const invoiceStatus = invoiceStatusIn ?? null;

  // 1) UPDATE by xero_contact_id first
  const upByXero = await client.query<{ id: string }>(
    `
    UPDATE public.clients
    SET
      display_name     = COALESCE(NULLIF($3, ''), display_name),
      email            = COALESCE($4::citext, email),
      phone_number     = COALESCE(NULLIF($5, ''), phone_number),
      item_description = COALESCE(NULLIF($6, ''), item_description),
      invoice_status   = COALESCE($7::public.invoice_status, invoice_status),
      updated_at       = now()
    WHERE business_id     = $1
      AND xero_contact_id = $2::uuid
    RETURNING id
    `,
    [businessId, xeroContactId, name, email, phone, itemDesc, invoiceStatus]
  );
  if (upByXero.rowCount && upByXero.rowCount > 0) return "updated";

  // 2) INSERT (or merge on unique (business_id, email))
  const ins = await client.query<{ inserted: boolean }>(
    `
    INSERT INTO public.clients
      (business_id, created_by, display_name, email, phone_number, sentiment, item_description, invoice_status, xero_contact_id)
    VALUES
      ($1, $2, $3, $4::citext, $5, 'unreviewed', $6, $7::public.invoice_status, $8::uuid)
    ON CONFLICT (business_id, email)
    DO UPDATE SET
      display_name     = COALESCE(NULLIF(EXCLUDED.display_name, ''), public.clients.display_name),
      phone_number     = COALESCE(NULLIF(EXCLUDED.phone_number, ''), public.clients.phone_number),
      item_description = COALESCE(NULLIF(EXCLUDED.item_description, ''), public.clients.item_description),
      invoice_status   = COALESCE(EXCLUDED.invoice_status, public.clients.invoice_status),
      xero_contact_id  = COALESCE(public.clients.xero_contact_id, EXCLUDED.xero_contact_id),
      updated_at       = now()
    RETURNING (xmax = 0) AS inserted
    `,
    [
      businessId,
      createdBy,
      name,
      email,
      phone,
      itemDesc,
      invoiceStatus,
      xeroContactId,
    ]
  );

  return ins.rows[0]?.inserted ? "inserted" : "updated";
}

/* ---------------- diagnostics shape ---------------- */
type Diag = {
  step: string;
  tenantResolved: boolean;
  tokenRefreshed: boolean;
  invoices: { pagesFetched: number; perPageCounts: number[] };
  contacts: { batches: number; batchSizes: number[] };
  counts: {
    contactIdsFromInvoices: number;
    contactsFetched: number;
    customersIncluded: number;
    isCustomerTrue: number;
    isCustomerFalse: number;
    isCustomerNull: number;
  };
  samples: {
    firstInvoiceContactIds: string[];
    skippedNotCustomer: string[];
    skippedMissingContact: string[];
    upsertErrors: Array<{
      contactId: string;
      error: string;
      createdByWasUuid?: boolean;
    }>;
  };
  notes: string[];
};

/* ---------------- Route handler ---------------- */
export async function POST(req: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  const diag: Diag = {
    step: "start",
    tenantResolved: false,
    tokenRefreshed: false,
    invoices: { pagesFetched: 0, perPageCounts: [] },
    contacts: { batches: 0, batchSizes: [] },
    counts: {
      contactIdsFromInvoices: 0,
      contactsFetched: 0,
      customersIncluded: 0,
      isCustomerTrue: 0,
      isCustomerFalse: 0,
      isCustomerNull: 0,
    },
    samples: {
      firstInvoiceContactIds: [],
      skippedNotCustomer: [],
      skippedMissingContact: [],
      upsertErrors: [],
    },
    notes: [],
  };

  try {
    const body = (await req.json().catch(() => ({}))) as {
      businessId?: string;
      since?: string;
      date?: string;
    };
    const businessId = body.businessId?.trim();
    if (!isUUID(businessId)) {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Valid businessId is required." },
        { status: 400 }
      );
    }

    // Auth → set app.user_id for RLS; store created_by only if it's a UUID
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id || null;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    const createdByUuid = isUUID(userId) ? userId : null;
    if (!createdByUuid) {
      diag.notes.push(
        "created_by is not a UUID → storing NULL in clients.created_by"
      );
    }

    // Build "since"
    let sinceWhere = DEFAULT_SINCE_WHERE;
    let sinceISO = DEFAULT_SINCE_ISO;
    try {
      const built = buildSinceWhere(body?.since ?? body?.date);
      sinceWhere = built.where;
      sinceISO = built.sinceISO;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: message || "Invalid since date" },
        { status: 400 }
      );
    }

    // 1) Resolve tenant
    diag.step = "resolve-tenant";
    const xr = await client.query<{
      id: string;
      tenant_id: string;
      access_token: string;
      refresh_token: string;
      access_token_expires_at: string | Date | null;
      is_connected: boolean;
      is_primary: boolean;
    }>(
      `
      SELECT id, tenant_id::text, access_token, refresh_token, access_token_expires_at, is_connected, is_primary
      FROM integrations.xero_details
      WHERE business_id = $1 AND is_connected = TRUE
      ORDER BY is_primary DESC, last_refreshed_at DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [businessId]
    );
    if (xr.rowCount === 0) {
      return NextResponse.json(
        {
          error: "NO_XERO_CONNECTION",
          message: "No Xero connection for this business.",
        },
        { status: 404 }
      );
    }
    diag.tenantResolved = true;
    const detail = xr.rows[0];
    let access_token = detail.access_token;
    let refresh_token = detail.refresh_token;
    const tenantId = detail.tenant_id;

    // 2) Maybe refresh token
    diag.step = "maybe-refresh-token";
    if (isExpired(detail.access_token_expires_at)) {
      const refreshed = await refreshAccessToken(refresh_token);
      access_token = refreshed.access_token;
      refresh_token = refreshed.refresh_token;
      await client.query(
        `
        UPDATE integrations.xero_details
        SET access_token = $1, refresh_token = $2, access_token_expires_at = $3, last_refreshed_at = NOW()
        WHERE id = $4
        `,
        [
          access_token,
          refresh_token,
          nowPlus(refreshed.expires_in * 1000),
          detail.id,
        ]
      );
      diag.tokenRefreshed = true;
    }

    // 3) Discover contacts via invoices (ACCREC-only inside helper)
    diag.step = "discover-invoices";
    const discovered = await collectInvoiceContactData(
      access_token,
      tenantId,
      sinceWhere
    );

    const rawContactIds = discovered.ids;
    diag.invoices = discovered.diag;
    diag.counts.contactIdsFromInvoices = rawContactIds.length;
    diag.samples.firstInvoiceContactIds = rawContactIds.slice(0, 10);

    // ---- CHANGE #2: Filter to UUID ContactIDs before /Contacts + upserts ----
    const contactIds = rawContactIds.filter(isUUID);
    const invalidContactIds = rawContactIds.filter((id) => !isUUID(id));

    if (invalidContactIds.length) {
      diag.notes.push(
        `Ignored ${invalidContactIds.length} non-UUID contact IDs from invoices (e.g. ${invalidContactIds
          .slice(0, 5)
          .join(", ")})`
      );
    }

    if (contactIds.length === 0) {
      const countResult: QueryResult<{ cnt: number }> = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM public.clients WHERE business_id = $1 AND deleted_at IS NULL`,
        [businessId]
      );
      const total = countResult.rows[0]?.cnt ?? 0;

      return NextResponse.json(
        {
          businessId,
          tenantId,
          since: sinceISO,
          consideredFromInvoices: 0,
          contactsFetched: 0,
          customersOnly: 0,
          inserted: 0,
          updated: 0,
          totalClientsForBusiness: total,
          diag,
        },
        { status: 200 }
      );
    }

    // 4) Fetch full contacts for valid UUID IDs only
    diag.step = "fetch-contacts";
    const { contacts, diag: contactsDiag } = await fetchContactsByIds(
      access_token,
      tenantId,
      contactIds
    );
    diag.contacts = contactsDiag;
    diag.counts.contactsFetched = contacts.length;

    const contactMap = new Map<string, XeroContact>();
    let isTrue = 0;
    let isFalse = 0;
    let isNull = 0;

    for (const c of contacts) {
      const id = (c.ContactID || "").trim();
      if (!id) continue;
      contactMap.set(id, c);
      if (c.IsCustomer === true) isTrue += 1;
      else if (c.IsCustomer === false) isFalse += 1;
      else isNull += 1;
    }

    diag.counts.isCustomerTrue = isTrue;
    diag.counts.isCustomerFalse = isFalse;
    diag.counts.isCustomerNull = isNull;

    // 5) Upsert only true customers
    let inserted = 0;
    let updated = 0;
    let customersOnly = 0;
    const skippedNotCustomer: string[] = [];
    const skippedMissingContact: string[] = [];
    const upsertErrors: Array<{
      contactId: string;
      error: string;
      createdByWasUuid?: boolean;
    }> = [];

    for (const id of contactIds) {
      const full = contactMap.get(id);
      if (!full) {
        skippedMissingContact.push(id);
        continue;
      }
      if (full.IsCustomer !== true) {
        skippedNotCustomer.push(id);
        continue;
      }

      customersOnly += 1;

      const xeroContactId = (full.ContactID || "").trim();
      if (!isUUID(xeroContactId)) {
        // Should not happen after filter, but guard anyway.
        upsertErrors.push({
          contactId: id,
          error: "ContactID is not a UUID; skipping.",
          createdByWasUuid: !!createdByUuid,
        });
        continue;
      }

      const name =
        (full.Name || discovered.names.get(id) || "").trim() ||
        "(Unknown Contact)";
      const email = (full.EmailAddress || null)?.toString() ?? null;
      const phone = pickPhone(full.Phones) || null;
      const itemDescription = discovered.descriptions.get(id) || null;
      const invoiceStatus = discovered.statusByContact.get(id) ?? null;

      try {
        const res = await upsertClientForBusiness(client, {
          businessId,
          createdBy: createdByUuid,
          xeroContactId,
          nameIn: name,
          emailIn: email,
          phoneIn: phone,
          itemDescriptionIn: itemDescription,
          invoiceStatusIn: invoiceStatus,
        });
        if (res === "inserted") inserted += 1;
        else updated += 1;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        upsertErrors.push({
          contactId: id,
          error: message || "DB upsert failed",
          createdByWasUuid: !!createdByUuid,
        });
      }
    }

    diag.counts.customersIncluded = customersOnly;
    diag.samples.skippedNotCustomer = skippedNotCustomer.slice(0, 20);
    diag.samples.skippedMissingContact = skippedMissingContact.slice(0, 20);
    diag.samples.upsertErrors = upsertErrors.slice(0, 20);

    // 6) Summary
    const countResult: QueryResult<{ cnt: number }> = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM public.clients WHERE business_id = $1 AND deleted_at IS NULL`,
      [businessId]
    );
    const total = countResult.rows[0]?.cnt ?? 0;

    const summary = {
      businessId,
      sinceISO,
      consideredFromInvoices: contactIds.length,
      contactsFetched: contacts.length,
      customersOnly,
      inserted,
      updated,
      totalClientsForBusiness: total,
      diag,
    };

    console.debug("[XERO DIAG] Completed sync", summary);
    if (upsertErrors.length) {
      console.debug(
        "[XERO DIAG] upsertErrors (first 10):",
        upsertErrors.slice(0, 10)
      );
    }

    return NextResponse.json(summary, { status: 200 });
  } catch (err: unknown) {
    // ---- CHANGE #3: expose message + step to help debug mysterious failures ----
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(
      "[/api/xero/get-clients-from-xero] error:",
      e.stack ?? e.message ?? e
    );
    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: e.message,
        step: diag.step,
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
