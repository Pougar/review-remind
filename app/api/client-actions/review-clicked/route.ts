// app/api/client-actions/review-clicked/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { verifyMagicToken } from "@/app/lib/magic-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   PG Pool (singleton across HMR)
   ============================================================ */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolReviewClickedPublicFinal: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolReviewClickedPublicFinal) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolReviewClickedPublicFinal = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPoolReviewClickedPublicFinal;
}

/* ============================================================
   Helpers
   ============================================================ */

// strict UUID test
const isUUID = (v?: string | null) =>
  !!v && /^[0-9a-fA-F-]{36}$/.test(v);

// allow preview client "test"
const isClientIdPublicValid = (cid?: string | null) => {
  if (!cid) return false;
  if (cid === "test") return true;
  return isUUID(cid);
};

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

function serverError(message = "Could not register review click.") {
  return NextResponse.json(
    { error: "SERVER_ERROR", message },
    { status: 500 }
  );
}

/* ============================================================
   Types
   ============================================================ */

type ReqBody = {
  businessId?: string;
  clientId?: string;
  token?: string;
};

// we only really need id + business_id for existence check
type ClientRow = {
  id: string;
  business_id: string;
};

type RespBody =
  | { already: boolean }
  | {
      error:
        | "EMAIL_NOT_SENT"
        | "REVIEW_ALREADY_SUBMITTED"
        | "NOT_FOUND"
        | "INVALID_INPUT"
        | "INVALID_TOKEN"
        | "SERVER_ERROR";
      message?: string;
    };

/* ============================================================
   Route
   ============================================================ */

export async function POST(req: NextRequest) {
  // ---- 1. Parse body
  const body = (await req.json().catch(() => ({}))) as ReqBody;
  const rawBusinessId = (body?.businessId || "").trim();
  const rawClientId = (body?.clientId || "").trim();
  const rawToken = (body?.token || "").trim();

  // ---- 2. Basic validation
  if (!isUUID(rawBusinessId)) {
    return badRequest("Valid businessId is required.", {
      field: "businessId",
    });
  }
  if (!isClientIdPublicValid(rawClientId)) {
    return badRequest("Valid clientId is required.", {
      field: "clientId",
    });
  }
  if (!rawToken) {
    return badRequest("token is required.", { field: "token" });
  }

  const businessId = rawBusinessId;
  const clientId = rawClientId;
  const token = rawToken;

  // ---- 3. Verify token authenticity and expiry
  // Uses your updated verifyMagicToken, which:
  //   - checks HMAC against JSON payload
  //   - checks exp (ms or sec)
  //   - checks businessId/clientId match
  //   - special-cases clientId === "test"
  const check = verifyMagicToken({
    token,
    businessId,
    clientId,
  });

  if (!check.ok) {
    return forbidden(check.error);
  }

  // ---- 4. Special case: preview/test links
  // "test" is allowed to skip DB entirely.
  if (clientId === "test") {
    const resp: RespBody = { already: false };
    return NextResponse.json(resp, { status: 200 });
  }

  // Past here: real UUID client. We now touch the DB with no BetterAuth
  // session. Your RLS must explicitly allow:
  // - SELECT on clients for this (businessId, clientId)
  // - SELECT on client_actions for email_sent / review_clicked
  // - SELECT on reviews for checking if already submitted
  // - INSERT into client_actions for review_clicked
  //
  // Typically you'd add a special RLS policy for these public flows.

  const pool = getPool();
  const db: PoolClient = await pool.connect();

  try {
    await db.query("BEGIN");

    // ---- 5. Verify the client actually exists under this business
    const clientQ = await db.query<ClientRow>(
      `
      SELECT
        c.id,
        c.business_id
      FROM public.clients c
      WHERE c.id = $1
        AND c.business_id = $2
      LIMIT 1
      `,
      [clientId, businessId]
    );

    if (clientQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "NOT_FOUND",
          message: "Client not found for this business.",
        },
        { status: 404 }
      );
    }

    // ---- 6. Check that we actually sent them an invite email
    // We infer this by existence of an 'email_sent' action in client_actions.
    const emailSentQ = await db.query(
      `
      SELECT 1
      FROM public.client_actions a
      WHERE a.business_id = $1
        AND a.client_id = $2
        AND a.action = 'email_sent'::public.client_action_type
      LIMIT 1
      `,
      [businessId, clientId]
    );

    const wasEmailed = (emailSentQ.rowCount ?? 0) > 0;
    if (!wasEmailed) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "EMAIL_NOT_SENT",
          message:
            "This review link is not active for you (no invite email recorded).",
        },
        { status: 403 }
      );
    }

    // ---- 7. Check if they've already submitted a review.
    // We treat "already submitted" as:
    //   there is at least one row in public.reviews
    //   for this (businessId, clientId) that isn't soft-deleted.
    const submittedQ = await db.query(
      `
      SELECT 1
      FROM public.reviews r
      WHERE r.business_id = $1
        AND r.client_id = $2
      LIMIT 1
      `,
      [businessId, clientId]
    );

    const alreadySubmitted = (submittedQ.rowCount ?? 0) > 0;
    if (alreadySubmitted) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "REVIEW_ALREADY_SUBMITTED",
          message: "You've already submitted a review for this visit.",
        },
        { status: 403 }
      );
    }

    // ---- 8. Have we ALREADY recorded a 'review_clicked'?
    const alreadyQ = await db.query(
      `
      SELECT 1
      FROM public.client_actions a
      WHERE a.client_id = $1
        AND a.business_id = $2
        AND a.action = 'link_clicked'::public.client_action_type
      LIMIT 1
      `,
      [clientId, businessId]
    );

    const already = (alreadyQ.rowCount ?? 0) > 0;

    // ---- 9. Log a fresh 'review_clicked' event for analytics/audit
    // We store IP + UA in meta for context.
    // actor_id stays NULL because this is a public, unauthenticated hit.
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "";
    const ua = req.headers.get("user-agent") || "";

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
        'link_clicked'::public.client_action_type,
        jsonb_build_object(
          'ip', $3::text,
          'ua', $4::text
        )
      )
      `,
      [businessId, clientId, ip, ua]
    );

    await db.query("COMMIT");

    // ---- 10. Send the response
    const resp: RespBody = { already };
    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* ignore rollback error */
    }

    console.error("[/api/client-actions/review-clicked] error:", err);

    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("row-level security")) {
      return serverError(
        "Permission denied by row-level security. The public review link may need an RLS policy for reading client info, checking prior reviews, and logging review_clicked."
      );
    }

    return serverError();
  } finally {
    db.release();
  }
}
