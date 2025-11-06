// app/api/google/get-reviews/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient } from "pg";
import { auth } from "@/app/lib/auth";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// ---- Google OAuth client creds (required for refresh)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

/* ---------------- Types ---------------- */

interface HttpError extends Error {
  code?: number;
}

interface GbpAccount {
  name?: string;        // "accounts/123..."
  accountName?: string; // human label
}

interface GbpLocation {
  name?: string; // "locations/456..." or "accounts/123/locations/456"
  title?: string;
  profile?: { description?: string };
  phoneNumbers?: { primaryPhone?: string };
  websiteUri?: string;
  metadata?: {
    placeId?: string;
    mapsUri?: string;
    newReviewUri?: string;
  };
}

type StarEnum = "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";

interface GbpReview {
  reviewId?: string;
  reviewer?: { displayName?: string };
  comment?: string;
  starRating?: StarEnum;
  createTime?: string; // ISO
}

interface ReviewsPage {
  reviews: GbpReview[];
  nextPageToken?: string;
  averageRating?: number;
  totalReviewCount?: number;
}

interface GoogleAccountRow {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null; // timestamptz as string
}

interface BizRow {
  id: string;
  user_id: string;
  display_name: string | null;
  google_review_link: string | null;
  maps_url: string | null;
  google_place_id: string | null;
}

/* ---------------- Utils ---------------- */

function safeTrim(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function starEnumToNumber(starRating?: StarEnum | null): number | null {
  if (!starRating) return null;
  const map: Record<StarEnum, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };
  return map[starRating] ?? null;
}

function slugifyLoose(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Try to parse a placeId from a Google "Write a review" link. */
function parsePlaceIdFromReviewLink(urlStr?: string | null): string | null {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    const pid = u.searchParams.get("placeid");
    return pid ? pid.trim() : null;
  } catch {
    return null;
  }
}

/** Make sure the Reviews API parent is accounts/{acct}/locations/{loc} */
function asReviewsParent(accountResource: string, locationName: string) {
  if (locationName.startsWith("accounts/")) return locationName;
  if (locationName.startsWith("locations/")) {
    return `${accountResource}/${locationName}`;
  }
  return `${accountResource}/locations/${locationName.replace(/^\/+/, "")}`;
}

/* ---------------- Google calls (no persistence) ---------------- */

async function gbpListAccounts(accessToken: string): Promise<GbpAccount[]> {
  const r = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const raw = await r.text().catch(() => "");
  console.log("[DEBUG][GBP] list accounts status=", r.status, "body=", raw);
  if (r.status === 401 || r.status === 403) {
    const err = new Error("GBP_UNAUTHORIZED") as HttpError;
    err.code = r.status;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`GBP_ACCOUNTS_${r.status}`) as HttpError;
    err.code = r.status;
    throw err;
  }
  const data: unknown = raw ? JSON.parse(raw) : {};
  const accounts = (data as { accounts?: GbpAccount[] })?.accounts ?? [];
  return accounts;
}

async function gbpListLocations(
  accessToken: string,
  accountResource: string,
  pageToken?: string
): Promise<{ locations: GbpLocation[]; nextPageToken?: string }> {
  const readMask = [
    "name",
    "title",
    "profile.description",
    "phoneNumbers.primaryPhone",
    "websiteUri",
    "metadata.placeId",
    "metadata.mapsUri",
    "metadata.newReviewUri",
  ].join(",");

  const url = new URL("https://mybusinessbusinessinformation.googleapis.com/v1/");
  url.pathname += `${accountResource}/locations`;
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("readMask", readMask);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  console.log("[DEBUG][GBP] list locations URL =", url.toString());

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const raw = await r.text().catch(() => "");
  console.log("[DEBUG][GBP] list locations status=", r.status, "body=", raw);
  if (r.status === 401 || r.status === 403) {
    const err = new Error("GBP_UNAUTHORIZED") as HttpError;
    err.code = r.status;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`GBP_LOCATIONS_${r.status}`) as HttpError;
    err.code = r.status;
    throw err;
  }
  const data: unknown = raw ? JSON.parse(raw) : {};
  const locations = (data as { locations?: GbpLocation[] })?.locations ?? [];
  const nextPageToken = (data as { nextPageToken?: string })?.nextPageToken ?? undefined;
  return { locations, nextPageToken };
}

async function fetchReviewsPage(
  accessToken: string,
  parentLocationResource: string, // MUST be accounts/{acct}/locations/{loc}
  pageToken?: string
): Promise<ReviewsPage> {
  const base = `https://mybusiness.googleapis.com/v4/${parentLocationResource}/reviews`;
  const url = new URL(base);
  url.searchParams.set("pageSize", "50");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const raw = await r.text().catch(() => "");
  console.log("[DEBUG][GBP] reviews status=", r.status, "body=", raw);

  if (r.status === 401 || r.status === 403) {
    const err = new Error("GBP_REVIEWS_UNAUTHORIZED") as HttpError;
    err.code = r.status;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`GBP_REVIEWS_${r.status}`) as HttpError;
    err.code = r.status;
    throw err;
  }
  const data: unknown = raw ? JSON.parse(raw) : {};
  return {
    reviews: (data as { reviews?: GbpReview[] })?.reviews ?? [],
    nextPageToken: (data as { nextPageToken?: string })?.nextPageToken ?? undefined,
    averageRating:
      (data as { averageRating?: number })?.averageRating ?? undefined,
    totalReviewCount:
      (data as { totalReviewCount?: number })?.totalReviewCount ?? undefined,
  };
}

/* ---------------- NEW: token refresh helper ---------------- */

type EnsureTokenOk =
  | { ok: true; accessToken: string }
  | {
      ok: false;
      reason: "NO_ACCESS_TOKEN" | "NO_REFRESH_TOKEN" | "REFRESH_FAILED";
      debug?: unknown;
    };

async function ensureGoogleAccessTokenFor(userId: string): Promise<EnsureTokenOk> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { ok: false, reason: "REFRESH_FAILED", debug: "Missing GOOGLE_CLIENT_ID/SECRET" };
  }

  const { rows } = await pool.query<GoogleAccountRow>(
    `
    SELECT "id","accessToken","refreshToken","accessTokenExpiresAt"
    FROM auth.account
    WHERE "providerId"='google' AND "userId"=$1
    ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC NULLS LAST, "id" DESC
    LIMIT 1
    `,
    [userId]
  );

  const acct = rows[0];
  if (!acct?.accessToken) return { ok: false, reason: "NO_ACCESS_TOKEN" };

  const expMs = acct.accessTokenExpiresAt ? new Date(acct.accessTokenExpiresAt).getTime() : 0;
  const needsRefresh = !expMs || Date.now() >= expMs - 60_000;

  if (!needsRefresh) {
    return { ok: true, accessToken: acct.accessToken };
  }

  if (!acct.refreshToken) return { ok: false, reason: "NO_REFRESH_TOKEN" };

  const rsp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: acct.refreshToken,
    }),
  });

  let json: unknown = {};
  try {
    json = await rsp.json();
  } catch {
    /* ignore */
  }

  const access_token = (json as { access_token?: string })?.access_token;
  const expires_in = Number((json as { expires_in?: number })?.expires_in ?? 3600);

  if (!rsp.ok || !access_token) {
    return { ok: false, reason: "REFRESH_FAILED", debug: json };
  }

  const newAccess = access_token;
  const newExpMs = Date.now() + expires_in * 1000;

  await pool.query(
    `UPDATE auth.account SET "accessToken"=$1, "accessTokenExpiresAt"=to_timestamp($2/1000.0) WHERE "id"=$3`,
    [newAccess, newExpMs, acct.id]
  );

  return { ok: true, accessToken: newAccess };
}

/* ---------------- DB write (business-centric) ---------------- */

async function upsertOneReviewByBusiness(
  client: PoolClient,
  businessId: string,
  r: GbpReview
): Promise<void> {
  const google_review_id = r.reviewId ?? null;
  const author_name = safeTrim(r.reviewer?.displayName) ?? null;
  const review_txt = safeTrim(r.comment) ?? null;
  const stars_num = starEnumToNumber(r.starRating ?? null);
  const published_at = r.createTime ? new Date(r.createTime) : null;

  await client.query(
    `
    INSERT INTO public.google_reviews (
      business_id, google_review_id, author_name, review, stars, published_at
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (business_id, google_review_id)
    DO UPDATE SET
      author_name  = EXCLUDED.author_name,
      review       = EXCLUDED.review,
      stars        = EXCLUDED.stars,
      published_at = EXCLUDED.published_at,
      updated_at   = now()
    `,
    [businessId, google_review_id, author_name, review_txt, stars_num, published_at]
  );
}

/* ---------------- Route ---------------- */

type ReqBody = { business_id?: string };

export async function POST(req: NextRequest) {
  let client: PoolClient | null = null;

  try {
    console.log("[DEBUG]/api/google/get-reviews(business): incoming request");

    const session = await auth.api.getSession({ headers: req.headers });
    const sessionUserId = session?.user?.id;
    if (!sessionUserId) {
      return NextResponse.json(
        { error: "UNAUTHENTICATED", message: "Sign in required." },
        { status: 401 }
      );
    }

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      parsed = {};
    }
    const body = (parsed ?? {}) as ReqBody;
    const businessId: string | undefined = body.business_id;
    if (!businessId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_id is required in body." },
        { status: 400 }
      );
    }

    // Ensure we have a fresh Google access token (refresh if needed)
    const tokenResult = await ensureGoogleAccessTokenFor(sessionUserId);
    if (!tokenResult.ok) {
      const map: Record<
        EnsureTokenOk extends infer T
          ? T extends { ok: false; reason: infer R }
            ? R & string
            : never
          : never,
        [number, string]
      > = {
        NO_ACCESS_TOKEN: [400, "Reconnect Google to continue."],
        NO_REFRESH_TOKEN: [400, "Reconnect Google with offline access to continue."],
        REFRESH_FAILED: [401, "Google token expired and refresh failed. Reconnect Google."],
      };
      const [status, msg] = map[tokenResult.reason] ?? [400, "Could not obtain Google token."];
      return NextResponse.json(
        { error: tokenResult.reason, message: msg, debug: tokenResult.debug ?? null },
        { status }
      );
    }
    const accessToken = tokenResult.accessToken;

    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [sessionUserId]);

    // Verify ownership + fetch hints
    const bizRow = await client.query<BizRow>(
      `
      SELECT id, user_id, display_name, google_review_link, maps_url, google_place_id
      FROM public.businesses
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [businessId, sessionUserId]
    );
    if (bizRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Business not found or not owned by you." },
        { status: 403 }
      );
    }

    const displayName = bizRow.rows[0].display_name;
    const hintPlaceId =
      bizRow.rows[0].google_place_id ??
      parsePlaceIdFromReviewLink(bizRow.rows[0].google_review_link);

    // Discover a valid Reviews parent without touching integrations.google_locations
    const accounts = await gbpListAccounts(accessToken);
    if (!accounts.length || !accounts[0]?.name) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "GBP_NO_ACCOUNT", message: "No Google Business Profile account found." },
        { status: 404 }
      );
    }

    let chosenResource: string | null = null;

    for (const acct of accounts) {
      const acctName = String(acct.name); // "accounts/1092..."
      let pageToken: string | undefined;

      do {
        const page = await gbpListLocations(accessToken, acctName, pageToken);
        const locs: GbpLocation[] = page.locations;

        let candidate: GbpLocation | undefined =
          hintPlaceId
            ? locs.find((l) => l?.metadata?.placeId === hintPlaceId)
            : undefined;

        if (!candidate && displayName) {
          const want = slugifyLoose(displayName);
          candidate = locs.find((l) => slugifyLoose(String(l?.title || "")) === want);
        }

        if (!candidate && locs.length) {
          candidate = locs[0];
        }

        if (candidate?.name) {
          chosenResource = asReviewsParent(acctName, String(candidate.name));
          console.log("[DEBUG][GBP] chosen reviews parent =", chosenResource, "acct=", acctName);
          break;
        }

        pageToken = page.nextPageToken;
      } while (!chosenResource && pageToken);

      if (chosenResource) break;
    }

    if (!chosenResource) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "GBP_NO_LOCATION_FOUND",
          message: "Could not resolve a Google Business Profile location for this business.",
        },
        { status: 404 }
      );
    }

    // Fetch all reviews
    const all: GbpReview[] = [];
    let averageRating: number | undefined;
    let totalReviewCount: number | undefined;
    let pageToken: string | undefined;

    try {
      do {
        const page = await fetchReviewsPage(accessToken, chosenResource, pageToken);
        if (averageRating === undefined && page.averageRating !== undefined) {
          averageRating = page.averageRating;
        }
        if (totalReviewCount === undefined && page.totalReviewCount !== undefined) {
          totalReviewCount = page.totalReviewCount;
        }
        if (page.reviews?.length) all.push(...page.reviews);
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (err: unknown) {
      const e = err as HttpError | Error;
      if ((e as HttpError)?.code === 401 || (e as HttpError)?.code === 403 || e.message === "GBP_REVIEWS_UNAUTHORIZED") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: "GBP_UNAUTHORIZED",
            message:
              "Google token invalid/expired, missing scope, or this account cannot manage this location.",
          },
          { status: 401 }
        );
      }
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "GBP_FETCH_FAILED",
          message: "Could not fetch reviews from Google Business Profile.",
          debug: { code: (e as HttpError)?.code ?? null, message: e.message ?? null },
        },
        { status: 502 }
      );
    }

    // Upsert reviews keyed by business_id
    for (const r of all) {
      await upsertOneReviewByBusiness(client, businessId, r);
    }

    await client.query("COMMIT");
    return NextResponse.json(
      {
        businessId,
        total_reviews_returned: all.length,
        averageRating: averageRating ?? null,
        totalReviewCount: totalReviewCount ?? null,
      },
      { status: 200 }
    );
  } catch (e: unknown) {
    try {
      await client?.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[FATAL]/api/google/get-reviews(business):", msg, stack);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not sync Google reviews." },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
