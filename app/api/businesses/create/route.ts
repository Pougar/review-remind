// app/api/businesses/create/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";

/* ========= DB ========= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

/* ========= Types ========= */
type DebugResponse<T = unknown> = {
  status: number;
  headers: Record<string, string>;
  data: T | null;
};

type AccountRow = {
  id: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type GbpAccounts = {
  accounts?: Array<{ name?: string; accountName?: string }>;
};

type GbpLocations = {
  locations?: Array<{
    title?: string;
    profile?: { description?: string };
    phoneNumbers?: { primaryPhone?: string };
    websiteUri?: string;
    metadata?: { placeId?: string; mapsUri?: string; newReviewUri?: string };
  }>;
};

type GbpInfo = {
  displayName: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  reviewLink: string | null;
  mapsUrl: string | null;
  placeId: string | null;
  accountResource?: string | null;
} | null;

class GbpUnauthorizedError extends Error {
  code?: number;
  constructor(code?: number) {
    super("GBP_UNAUTHORIZED");
    this.name = "GbpUnauthorizedError";
    this.code = code;
  }
}

/* ========= Small debug helpers ========= */
async function debugJsonResponse<T = unknown>(resp: Response, label: string): Promise<DebugResponse<T>> {
  const status = resp.status;
  const headersObj: Record<string, string> = {};
  try {
    for (const [k, v] of resp.headers.entries()) {
      headersObj[k] = v;
    }
  } catch (err: unknown) {
    console.warn(`[DEBUG] ${label}: couldn't read headers`, err);
  }

  let rawText: string | null = null;
  try {
    rawText = await resp.text();
  } catch (err: unknown) {
    console.warn(`[DEBUG] ${label}: couldn't read body text`, err);
  }

  console.log(`[DEBUG] ${label}: status=`, status);
  console.log(`[DEBUG] ${label}: headers=`, headersObj);
  console.log(`[DEBUG] ${label}: raw body=`, rawText);

  let data: T | null = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText) as T;
    } catch (err: unknown) {
      console.warn(`[DEBUG] ${label}: failed to parse JSON from raw body`, err);
    }
  }

  return { status, headers: headersObj, data };
}

function safeTrim(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  return null;
}

/* ========= Slug helper ========= */
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

/* ========= Insert business with retrying unique slug ========= */
async function insertBusinessWithUniqueSlug(
  client: PoolClient,
  userId: string,
  displayName: string,
  businessEmail?: string | null,
  description?: string | null
) {
  const base = slugify(displayName) || `biz-${Date.now().toString(36)}`;
  const MAX_TRIES = 50;

  for (let i = 0; i < MAX_TRIES; i++) {
    const trySlug = i === 0 ? base : `${base}-${i + 1}`;

    console.log(`[DEBUG] insertBusinessWithUniqueSlug: trying slug "${trySlug}" for user ${userId}`);

    const res = await client.query<{ id: string; slug: string }>(
      `
      INSERT INTO public.businesses (
        user_id,
        slug,
        display_name,
        business_email,
        description
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id, slug
      `,
      [userId, trySlug, displayName, businessEmail ?? null, description ?? null]
    );

    if (res.rows.length > 0) {
      console.log(`[DEBUG] insertBusinessWithUniqueSlug: success with slug "${trySlug}" ->`, res.rows[0]);
      return res.rows[0]; // { id, slug }
    } else {
      console.log(`[DEBUG] insertBusinessWithUniqueSlug: slug "${trySlug}" conflicted, retrying`);
    }
  }

  console.error("[ERROR] UNIQUE_SLUG_EXHAUSTED for user", userId);
  throw new Error("UNIQUE_SLUG_EXHAUSTED");
}

/* ========= Google Business Profile helper (FIXED URL) ========= */
async function gbpPrimaryLocationInfo(accessToken: string): Promise<GbpInfo> {
  console.log("[DEBUG][GBP] Starting gbpPrimaryLocationInfo");

  // ---- 1. List accounts ----
  console.log("[DEBUG][GBP] Fetching accounts...");
  const acctResp = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (acctResp.status === 401 || acctResp.status === 403) {
    console.error("[ERROR][GBP] accounts call unauthorized", acctResp.status);
    throw new GbpUnauthorizedError(acctResp.status);
  }

  const acctDebug = await debugJsonResponse<GbpAccounts>(acctResp, "GBP accounts");
  if (acctDebug.status < 200 || acctDebug.status >= 300) {
    console.error("[ERROR][GBP] accounts call not ok", acctDebug.status, acctDebug.data);
    throw new Error(`GBP_ACCOUNTS_${acctDebug.status}`);
  }

  const acctJson = acctDebug.data;
  const firstAccount = acctJson?.accounts?.[0];

  console.log("[DEBUG][GBP] firstAccount =", firstAccount);

  if (!firstAccount) {
    console.warn("[WARN][GBP] No accounts found for this Google user. Returning null.");
    return null;
  }

  const accountResourceName: string | undefined = firstAccount.name; // e.g. "accounts/10929925..."
  const accountHumanName: string =
    (firstAccount.accountName && firstAccount.accountName) || (firstAccount.name ?? "My Business");

  console.log("[DEBUG][GBP] accountResourceName =", accountResourceName);
  console.log("[DEBUG][GBP] accountHumanName =", accountHumanName);

  // ---- 2. List locations for that account ----
  const readMask = [
    "title",
    "profile.description",
    "phoneNumbers.primaryPhone",
    "websiteUri",
    "metadata.placeId",
    "metadata.mapsUri",
    "metadata.newReviewUri",
  ].join(",");

  if (!accountResourceName) {
    console.warn("[WARN][GBP] No accountResourceName, cannot query locations. Returning fallback.");
    return {
      displayName: accountHumanName,
      description: null,
      phone: null,
      website: null,
      reviewLink: null,
      mapsUrl: null,
      placeId: null,
      accountResource: firstAccount.name ?? null,
    };
  }

  // Do not encode accountResourceName; the API expects /v1/accounts/123/locations
  const locUrl =
    `https://mybusinessbusinessinformation.googleapis.com/v1/` +
    `${accountResourceName}/locations` +
    `?pageSize=1&readMask=${encodeURIComponent(readMask)}`;

  console.log("[DEBUG][GBP] Fetching locations from:", locUrl);

  const locResp = await fetch(locUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (locResp.status === 401 || locResp.status === 403) {
    console.error("[ERROR][GBP] locations call unauthorized", locResp.status);
    throw new GbpUnauthorizedError(locResp.status);
  }

  const locDebug = await debugJsonResponse<GbpLocations>(locResp, "GBP locations");

  if (locDebug.status < 200 || locDebug.status >= 300) {
    console.error("[ERROR][GBP] locations call not ok", locDebug.status, locDebug.data);
    throw new Error(`GBP_LOCATIONS_${locDebug.status}`);
  }

  const locJson = locDebug.data;
  const loc = locJson?.locations?.[0];

  console.log("[DEBUG][GBP] first location =", loc);

  // Build safe fallbacks
  const displayName = safeTrim(loc?.title) || safeTrim(accountHumanName) || "My Business";
  const description: string | null = safeTrim(loc?.profile?.description) ?? null;
  const phone: string | null = (loc?.phoneNumbers && safeTrim(loc.phoneNumbers.primaryPhone)) || null;
  const website: string | null = safeTrim(loc?.websiteUri) ?? null;
  const placeId: string | null = safeTrim(loc?.metadata?.placeId) ?? null;

  const reviewLink: string | null =
    safeTrim(loc?.metadata?.newReviewUri) ??
    (placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : null);

  const mapsUrl: string | null = safeTrim(loc?.metadata?.mapsUri) ?? null;

  const result: GbpInfo = {
    displayName,
    description,
    phone,
    website,
    reviewLink,
    mapsUrl,
    placeId,
    accountResource: accountResourceName,
  };

  console.log("[DEBUG][GBP] Parsed gbpPrimaryLocationInfo result =", result);

  return result;
}

/* ========= Route ========= */
type CreateBody = { userId?: string };

async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let client: PoolClient | null = null;

  console.log("[DEBUG]/api/businesses/create: incoming request");

  try {
    // 1) Session check
    const session = await auth.api.getSession({ headers: req.headers });
    const sessionUserId = session?.user?.id;

    console.log("[DEBUG]/api/businesses/create: sessionUserId =", sessionUserId);

    if (!sessionUserId) {
      console.warn("[WARN]/api/businesses/create: UNAUTHENTICATED");
      return NextResponse.json({ error: "UNAUTHENTICATED", message: "Sign in required." }, { status: 401 });
    }

    // 2) Optional userId in body must match session
    const body = await readJson<CreateBody>(req);
    console.log("[DEBUG]/api/businesses/create: request body =", body ?? {});

    const inputUserId: string | undefined = body?.userId;
    if (inputUserId && inputUserId !== sessionUserId) {
      console.warn(
        "[WARN]/api/businesses/create: FORBIDDEN user mismatch",
        "inputUserId=", inputUserId,
        "sessionUserId=", sessionUserId
      );
      return NextResponse.json({ error: "FORBIDDEN", message: "User mismatch." }, { status: 403 });
    }
    const userId = inputUserId ?? sessionUserId;

    // 3) Begin DB transaction + set RLS context
    console.log("[DEBUG]/api/businesses/create: connecting to DB...");
    client = await pool.connect();
    console.log("[DEBUG]/api/businesses/create: BEGIN txn; setting app.user_id =", userId);

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    // 4) Most recent Google account for this user
    console.log("[DEBUG]/api/businesses/create: fetching latest google account for userId =", userId);

    const acctRes = await client.query<AccountRow>(
      `
      SELECT id,
             "accountId",
             "providerId",
             "userId",
             "accessToken",
             "refreshToken",
             "accessTokenExpiresAt",
             "createdAt",
             "updatedAt"
      FROM auth.account
      WHERE "providerId" = 'google'
        AND "userId" = $1
      ORDER BY "updatedAt" DESC NULLS LAST,
               "createdAt" DESC NULLS LAST,
               "id" DESC
      LIMIT 1
      `,
      [userId]
    );

    console.log("[DEBUG]/api/businesses/create: acctRes.rowCount =", acctRes.rowCount);

    const provider: AccountRow | undefined = acctRes.rows[0];

    console.log("[DEBUG]/api/businesses/create: provider summary =", {
      id: provider?.id,
      providerId: provider?.providerId,
      userId: provider?.userId,
      hasAccessToken: !!provider?.accessToken,
      hasRefreshToken: !!provider?.refreshToken,
      accessTokenExpiresAt: provider?.accessTokenExpiresAt,
      createdAt: provider?.createdAt,
      updatedAt: provider?.updatedAt,
    });

    if (!provider) {
      console.warn("[WARN]/api/businesses/create: No Google connection found for this user.");
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "NOT_FOUND", message: "No Google connection found for this user." },
        { status: 404 }
      );
    }

    if (!provider.accessToken) {
      console.warn("[WARN]/api/businesses/create: Google row found but missing accessToken");
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "NO_ACCESS_TOKEN", message: "No access token stored. Please reconnect Google." },
        { status: 400 }
      );
    }

    // 5) Call GBP to derive info (name, desc, phone, review link...)
    console.log("[DEBUG]/api/businesses/create: calling gbpPrimaryLocationInfo...");
    let gbpInfo: GbpInfo = null;
    try {
      gbpInfo = await gbpPrimaryLocationInfo(provider.accessToken);
    } catch (e: unknown) {
      const code = (e as { code?: number } | null)?.code;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[ERROR]/api/businesses/create: gbpPrimaryLocationInfo threw", code, message);

      if (code === 401 || code === 403 || message === "GBP_UNAUTHORIZED") {
        console.warn("[WARN]/api/businesses/create: GBP_UNAUTHORIZED");
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "GBP_UNAUTHORIZED", message: "Google token invalid/expired. Please reconnect Google." },
          { status: 401 }
        );
      }
      // fallback: continue with null gbpInfo
      gbpInfo = null;
    }

    console.log("[DEBUG]/api/businesses/create: gbpInfo =", gbpInfo);

    // Build values for INSERT
    const displayName = safeTrim(gbpInfo?.displayName) || "My Business";
    const description: string | null = safeTrim(gbpInfo?.description) ?? null;
    // GBP API does NOT reliably expose an email field
    const businessEmail: string | null = null;

    console.log("[DEBUG]/api/businesses/create: final business fields before insert =", {
      displayName,
      description,
      businessEmail,
    });

    // 6) Insert business with unique slug
    const bizRow = await insertBusinessWithUniqueSlug(client, userId, displayName, businessEmail, description);
    console.log("[DEBUG]/api/businesses/create: bizRow from insertBusinessWithUniqueSlug =", bizRow);

    const newBusinessId = bizRow.id;

    // 6b) Extra GBP metadata
    console.log("[DEBUG]/api/businesses/create: updating GBP extras for business id =", newBusinessId);

    await client.query(
      `
      UPDATE public.businesses
      SET
        google_review_link = $2,
        phone              = $3,
        website            = $4,
        maps_url           = $5,
        google_place_id    = $6
      WHERE id = $1
      `,
      [
        newBusinessId,
        gbpInfo?.reviewLink ?? null,
        gbpInfo?.phone ?? null,
        gbpInfo?.website ?? null,
        gbpInfo?.mapsUrl ?? null,
        gbpInfo?.placeId ?? null,
      ]
    );

    // 7) Insert default email template
    const defaultSubject = "Please leave us a review!";
    const defaultBody =
      "We would really appreciate it if you left us a review. Please share your feedback using the buttons below.";

    console.log("[DEBUG]/api/businesses/create: inserting default email_template for business id =", newBusinessId);

    await client.query(
      `
      INSERT INTO public.email_templates (business_id, email_subject, email_body)
      VALUES ($1, $2, $3)
      `,
      [newBusinessId, defaultSubject, defaultBody]
    );

    // 8) Commit
    console.log("[DEBUG]/api/businesses/create: COMMIT");
    await client.query("COMMIT");

    console.log("[DEBUG]/api/businesses/create: success response ->", { businessId: newBusinessId, slug: bizRow.slug });

    return NextResponse.json({ businessId: newBusinessId, slug: bizRow.slug }, { status: 200 });
  } catch (e: unknown) {
    const emsg = e instanceof Error ? e.message : String(e);
    const estack = e instanceof Error ? e.stack : undefined;

    console.error("[FATAL]/api/businesses/create: top-level catch", emsg, estack);

    try {
      if (client) {
        console.log("[DEBUG]/api/businesses/create: ROLLBACK due to error");
        await client.query("ROLLBACK");
      }
    } catch (rollbackErr: unknown) {
      const rmsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      const rstack = rollbackErr instanceof Error ? rollbackErr.stack : undefined;
      console.error("[ERROR]/api/businesses/create: rollback failed", rmsg, rstack);
    }

    return NextResponse.json(
      {
        error: "INTERNAL",
        message: "Could not create business from Google.",
        debug: {
          message: emsg ?? null,
          stack: estack ?? null,
        },
      },
      { status: 500 }
    );
  } finally {
    if (client) {
      console.log("[DEBUG]/api/businesses/create: releasing DB client");
      client.release();
    } else {
      console.log("[DEBUG]/api/businesses/create: no DB client to release (likely failed before connect)");
    }
  }
}
