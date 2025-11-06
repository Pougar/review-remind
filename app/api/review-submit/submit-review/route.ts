// app/api/public/submit-review/route.ts
import { NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { verifyMagicToken } from "@/app/lib/magic-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   PG Pool (singleton across HMR)
   ============================================================ */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolPublicSubmitReview: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolPublicSubmitReview) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolPublicSubmitReview = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolPublicSubmitReview;
}

/* ============================================================
   Helpers
   ============================================================ */

type ReviewType = "good" | "bad";

const isUUID = (v?: string | null) =>
  !!v && /^[0-9a-fA-F-]{36}$/.test(v);

const isClientIdPublicValid = (cid?: string | null) => {
  if (!cid) return false;
  if (cid === "test") return true;
  return isUUID(cid);
};

function cleanText(v: unknown): string {
  return String(v ?? "").trim();
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: "INVALID_INPUT", message, ...extra },
    { status: 400 }
  );
}

function forbidden(message: string) {
  return NextResponse.json(
    { error: "INVALID_TOKEN", message },
    { status: 403 }
  );
}

function serverError(message = "Server error") {
  return NextResponse.json(
    { error: "SERVER_ERROR", message },
    { status: 500 }
  );
}

/* ============================================================
   Route
   ============================================================ */

export async function POST(req: Request) {
  // ---- parse body ----
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const rawBusinessId = (body?.businessId ?? "").trim();
  const rawClientId = (body?.clientId ?? "").trim();
  const token = (body?.token ?? "").trim();

  const reviewType = body?.reviewType as ReviewType | undefined; // "good" | "bad"
  const reviewRaw = body?.review ?? "";
  const starsRaw = body?.stars;

  // ---- validation ----
  if (!isUUID(rawBusinessId)) {
    return badRequest("businessId is required and must be a valid uuid.", {
      field: "businessId",
    });
  }

  if (!isClientIdPublicValid(rawClientId)) {
    return badRequest("clientId must be a valid uuid (or 'test').", {
      field: "clientId",
    });
  }

  if (reviewType !== "good" && reviewType !== "bad") {
    return badRequest("reviewType must be 'good' or 'bad'.", {
      field: "reviewType",
    });
  }

  const review = cleanText(reviewRaw);
  if (!review) {
    return badRequest("review text is required.", {
      field: "review",
    });
  }

  // optional stars 0–5 (numeric(2,1) in DB)
  let stars: number | null = null;
  if (
    typeof starsRaw === "number" &&
    Number.isFinite(starsRaw) &&
    starsRaw >= 0 &&
    starsRaw <= 5
  ) {
    stars = starsRaw;
  }

  const businessId = rawBusinessId;
  const clientId = rawClientId;
  const isTestClient = clientId === "test";

  // ---- token verification (skip in test mode) ----
  if (!isTestClient) {
    if (!token) {
      return badRequest("token is required for non-test clients.", {
        field: "token",
      });
    }

    const check = verifyMagicToken({
      token,
      businessId,
      clientId,
    });

    if (!check.ok) {
      return forbidden(check.error);
    }
  }

  // ---- shortcut for preview/test client ----
  // In test mode we DO NOT persist anything.
  if (isTestClient) {
    return NextResponse.json({ ok: true, mode: "test" }, { status: 200 });
  }

  // Past this point we write to DB (public flow, no BetterAuth session).
  // RLS must explicitly allow:
  //   - SELECT clients for (businessId, clientId)
  //   - SELECT reviews for (businessId, clientId)
  //   - INSERT INTO reviews
  //   - UPDATE clients.sentiment
  //   - INSERT INTO client_actions (review_submitted)
  //
  const pool = getPool();
  const db: PoolClient = await pool.connect();

  try {
    await db.query("BEGIN");

    // 1. Check that this client exists for this business and is not soft-deleted
    const clientExistsQ = await db.query<{ id: string }>(
      `
      SELECT c.id
      FROM public.clients c
      WHERE c.id = $1
        AND c.business_id = $2
      LIMIT 1
      `,
      [clientId, businessId]
    );

    if (clientExistsQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "NOT_FOUND",
          message: "Client not found for this business.",
        },
        { status: 404 }
      );
    }

    // 2. Have they ALREADY submitted a review?
    // We define "already submitted" as:
    //   there is already at least one non-deleted review row
    //   in public.reviews for this (businessId, clientId).
    const existingReviewQ = await db.query<{ id: string }>(
      `
      SELECT r.id
      FROM public.reviews r
      WHERE r.business_id = $1
        AND r.client_id = $2
      LIMIT 1
      `,
      [businessId, clientId]
    );

    const alreadySubmitted = (existingReviewQ.rowCount ?? 0) > 0;

    if (alreadySubmitted) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        { error: "REVIEW_ALREADY_SUBMITTED" },
        { status: 409 }
      );
    }

    // 3. Insert a brand new review row for this client
    //    reviews schema:
    //    id uuid PK DEFAULT gen_random_uuid()
    //    business_id uuid
    //    client_id uuid
    //    review text
    //    stars numeric(2,1)
    //    happy boolean
    //    g_review_id uuid NULL
    //    created_at timestamptz DEFAULT now()
    //    updated_at timestamptz DEFAULT now()
    //    deleted_at timestamptz
    //
    const happy = reviewType === "good";

    await db.query(
      `
      INSERT INTO public.reviews (
        business_id,
        client_id,
        review,
        stars,
        happy,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::text,
        $4::numeric,
        $5::boolean,
        NOW(),
        NOW()
      )
      `,
      [businessId, clientId, review, stars, happy]
    );

    // 4. Update client sentiment based on reviewType
    //    clients schema:
    //    sentiment public.sentiment_enum NOT NULL DEFAULT 'unreviewed'
    //    updated_at timestamptz NOT NULL DEFAULT now()
    //
    // We assume 'good'/'bad' are valid values in public.sentiment_enum.
    await db.query(
      `
      UPDATE public.clients
      SET
        sentiment  = $1::public.sentiment_enum,
        updated_at = NOW()
      WHERE id = $2
        AND business_id = $3
      `,
      [reviewType, clientId, businessId]
    );

    // 5. Log an action in client_actions
    //    client_actions schema:
    //      id uuid DEFAULT gen_random_uuid()
    //      business_id uuid
    //      client_id uuid
    //      actor_id text (NULL here)
    //      action public.client_action_type
    //      meta jsonb
    //      created_at timestamptz DEFAULT now()
    //
    // We use 'review_submitted' as the value for action.
    await db.query(
      `
      INSERT INTO public.client_actions (
        business_id,
        client_id,
        actor_id,
        action,
        meta
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        NULL,
        'review_submitted'::public.client_action_type,
        jsonb_build_object(
          'stars', $3::numeric,
          'happy', $4::boolean
        )
      )
      `,
      [businessId, clientId, stars, happy]
    );

    await db.query("COMMIT");

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* ignore */
    }

    console.error("[POST /api/public/submit-review] error:", err?.stack || err);
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("row-level security")) {
      return serverError(
        "Permission denied by row-level security. Public review submission may need a relaxed policy."
      );
    }

    return serverError();
  } finally {
    db.release();
  }
}
