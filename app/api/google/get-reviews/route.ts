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

// ---- NEW: Google OAuth client creds (required for refresh)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

/* ---------------- Utils ---------------- */

function safeTrim(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function starEnumToNumber(starRating?: string | null): number | null {
  if (!starRating) return null;
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
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
  if (locationName.startsWith("accounts/")) return locationName; // already full path
  if (locationName.startsWith("locations/")) {
    return `${accountResource}/${locationName}`; // accounts/{acct}/locations/{loc}
  }
  return `${accountResource}/locations/${locationName.replace(/^\/+/, "")}`;
}

/* ---------------- Google calls (no persistence) ---------------- */

async function gbpListAccounts(accessToken: string) {
  const r = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const raw = await r.text().catch(() => "");
  console.log("[DEBUG][GBP] list accounts status=", r.status, "body=", raw);
  if (r.status === 401 || r.status === 403) {
    const err: any = new Error("GBP_UNAUTHORIZED");
    err.code = r.status;
    throw err;
  }
  if (!r.ok) {
    const err: any = new Error(`GBP_ACCOUNTS_${r.status}`);
    err.code = r.status;
    throw err;
  }
  const data = raw ? JSON.parse(raw) : {};
  return (data?.accounts ?? []) as Array<{ name?: string; accountName?: string }>;
}

async function gbpListLocations(
  accessToken: string,
  accountResource: string,
  pageToken?: string
) {
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
    const err: any = new Error("GBP_UNAUTHORIZED");
    err.code = r.status;
    throw err;
  }
  if (!r.ok) {
    const err: any = new Error(`GBP_LOCATIONS_${r.status}`);
    err.code = r.status;
    throw err;
  }
  const data = raw ? JSON.parse(raw) : {};
  return { locations: data?.locations ?? [], nextPageToken: data?.nextPageToken ?? undefined };
}

async function fetchReviewsPage(
  accessToken: string,
  parentLocationResource: string, // MUST be accounts/{acct}/locations/{loc}
  pageToken?: string
) {
  const base = `https://mybusiness.googleapis.com/v4/${parentLocationResource}/reviews`;
  const url = new URL(base);
  url.searchParams.set("pageSize", "50");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const raw = await r.text().catch(() => "");
  console.log("[DEBUG][GBP] reviews status=", r.status, "body=", raw);

  if (r.status === 401 || r.status === 403) {
    const err: any = new Error("GBP_REVIEWS_UNAUTHORIZED");
    err.code = r.status;
    throw err;
  }
  if (!r.ok) {
    const err: any = new Error(`GBP_REVIEWS_${r.status}`);
    err.code = r.status;
    throw err;
  }
  const data = raw ? JSON.parse(raw) : {};
  return {
    reviews: data?.reviews ?? [],
    nextPageToken: data?.nextPageToken ?? undefined,
    averageRating: data?.averageRating ?? undefined,
    totalReviewCount: data?.totalReviewCount ?? undefined,
  };
}

/* ---------------- NEW: token refresh helper ---------------- */

type GoogleAccountRow = {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null; // timestamptz as string
};

async function ensureGoogleAccessTokenFor(userId: string): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; reason: "NO_ACCESS_TOKEN" | "NO_REFRESH_TOKEN" | "REFRESH_FAILED"; debug?: any }
> {
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

  const expMs = acct.expiresAt ? new Date(acct.expiresAt).getTime() : 0;
  const needsRefresh = !expMs || Date.now() >= expMs - 60_000; // refresh if unknown or <60s left

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

  const json = await rsp.json().catch(() => ({}));
  if (!rsp.ok || !json?.access_token) {
    return { ok: false, reason: "REFRESH_FAILED", debug: json };
  }

  const newAccess = json.access_token as string;
  const newExpMs = Date.now() + (Number(json.expires_in ?? 3600) * 1000);

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
  r: any
) {
  const google_review_id = r.reviewId ?? null;
  const author_name = safeTrim(r.reviewer?.displayName) ?? null;
  const review_txt = safeTrim(r.comment) ?? null;
  const stars_num = starEnumToNumber(r.starRating);
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

    const body = await req.json().catch(() => ({} as any));
    const businessId: string | undefined = body?.business_id;
    if (!businessId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_id is required in body." },
        { status: 400 }
      );
    }

    // ---- NEW: ensure we have a fresh Google access token (refresh if needed)
    const tokenResult = await ensureGoogleAccessTokenFor(sessionUserId);
    if (!tokenResult.ok) {
      const map = {
        NO_ACCESS_TOKEN: [400, "Reconnect Google to continue."],
        NO_REFRESH_TOKEN: [400, "Reconnect Google with offline access to continue."],
        REFRESH_FAILED: [401, "Google token expired and refresh failed. Reconnect Google."],
      } as const;
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
    const bizRow = await client.query(
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

    const displayName = bizRow.rows[0].display_name as string | null;
    const hintPlaceId =
      (bizRow.rows[0].google_place_id as string | null) ??
      parsePlaceIdFromReviewLink(bizRow.rows[0].google_review_link as string | null);

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
    let chosenAccount: string | null = null;

    for (const acct of accounts) {
      const acctName = acct.name!; // "accounts/1092..."
      let pageToken: string | undefined;

      do {
        const page = await gbpListLocations(accessToken, acctName, pageToken);
        const locs = page.locations || [];

        let candidate =
          hintPlaceId
            ? locs.find((l: any) => l?.metadata?.placeId === hintPlaceId)
            : null;

        if (!candidate && displayName) {
          const want = slugifyLoose(displayName);
          candidate = locs.find((l: any) => slugifyLoose(String(l?.title || "")) === want);
        }

        if (!candidate && locs.length) {
          candidate = locs[0];
        }

        if (candidate?.name) {
          chosenResource = asReviewsParent(acctName, String(candidate.name));
          chosenAccount = acctName;
          console.log("[DEBUG][GBP] chosen reviews parent =", chosenResource, "acct=", chosenAccount);
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
    const all: any[] = [];
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
    } catch (err: any) {
      if (err?.code === 401 || err?.code === 403 || err?.message === "GBP_REVIEWS_UNAUTHORIZED") {
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
          debug: { code: err?.code ?? null, message: err?.message ?? null },
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
  } catch (e: any) {
    try {
      await client?.query("ROLLBACK");
    } catch {}
    console.error("[FATAL]/api/google/get-reviews(business):", e?.message, e?.stack);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not sync Google reviews." },
      { status: 500 }
    );
  } finally {
    client?.release?.();
  }
}
