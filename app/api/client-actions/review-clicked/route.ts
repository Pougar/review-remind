// app/api/client-actions/review-clicked/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient } from "pg";
import { verifyMagicToken } from "@/app/lib/magic-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   PG Pool (singleton across HMR) — typed, no eslint-disable
   ============================================================ */
const globalForPg = globalThis as unknown as {
  _pgPoolReviewClickedPublicFinal?: Pool;
};
function getPool(): Pool {
  if (!globalForPg._pgPoolReviewClickedPublicFinal) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    globalForPg._pgPoolReviewClickedPublicFinal = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolReviewClickedPublicFinal;
}

/* ============================================================
   Helpers
   ============================================================ */

// strict UUID test
const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

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

// Safe JSON reader (avoid any)
async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as unknown as T;
  } catch {
    return null;
  }
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
  const body = (await readJson<ReqBody>(req)) ?? {};
  const rawBusinessId = (body.businessId ?? "").trim();
  const rawClientId = (body.clientId ?? "").trim();
  const rawToken = (body.token ?? "").trim();

  // ---- 2. Basic validation
  if (!isUUID(rawBusinessId)) {
    return badRequest("Valid businessId is required.", { field: "businessId" });
  }
  if (!isClientIdPublicValid(rawClientId)) {
    return badRequest("Valid clientId is required.", { field: "clientId" });
  }
  if (!rawToken) {
    return badRequest("token is required.", { field: "token" });
  }

  const businessId = rawBusinessId;
  const clientId = rawClientId;
  const token = rawToken;

  // ---- 3. Verify token authenticity and expiry
  const check = verifyMagicToken({ token, businessId, clientId });
  if (!check.ok) {
    return forbidden(check.error);
  }

  // ---- 4. Special case: preview/test links (skip DB)
  if (clientId === "test") {
    const resp: RespBody = { already: false };
    return NextResponse.json(resp, { status: 200 });
  }

  // ---- 5. DB ops (public flow; ensure RLS policies allow what we do)
  const pool = getPool();
  const db: PoolClient = await pool.connect();

  try {
    await db.query("BEGIN");

    // Verify the client actually exists under this business
    const clientQ = await db.query<ClientRow>(
      `
      SELECT c.id, c.business_id
      FROM public.clients c
      WHERE c.id = $1 AND c.business_id = $2
      LIMIT 1
      `,
      [clientId, businessId]
    );

    if (clientQ.rowCount === 0) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Client not found for this business." },
        { status: 404 }
      );
    }

    // Check that we actually sent them an invite email
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

    // Already submitted a review?
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

    // Have we ALREADY recorded a 'link_clicked'?
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

    // Log a fresh 'link_clicked'
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
        jsonb_build_object('ip', $3::text, 'ua', $4::text)
      )
      `,
      [businessId, clientId, ip, ua]
    );

    await db.query("COMMIT");

    const resp: RespBody = { already };
    return NextResponse.json(resp, { status: 200 });
  } catch (err: unknown) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* ignore rollback error */
    }

    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/client-actions/review-clicked] error:", msg);

    if (msg.toLowerCase().includes("row-level security")) {
      return serverError(
        "Permission denied by row-level security. The public review link may need an RLS policy for reading client info, checking prior reviews, and logging review_clicked."
      );
    }

    return serverError();
  } finally {
    db.release();
  }
}
