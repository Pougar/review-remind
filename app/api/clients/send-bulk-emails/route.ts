// app/api/clients/send-bulk-emails/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { Resend } from "resend";
import { auth } from "@/app/lib/auth";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resend = new Resend(process.env.RESEND_API_KEY);

/* ---------- PG Pool singleton (typed global) ---------- */
const globalForPg = globalThis as unknown as { _pgPoolSendBulkBiz?: Pool };
function getPool(): Pool {
  if (!globalForPg._pgPoolSendBulkBiz) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");

    globalForPg._pgPoolSendBulkBiz = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPg._pgPoolSendBulkBiz;
}

/* ---------- Config ---------- */
const RAW_TOKEN_SECRET = process.env.SEND_REVIEW_LINK_SECRET;
if (!RAW_TOKEN_SECRET) {
  throw new Error("SEND_REVIEW_LINK_SECRET is not set");
}
const TOKEN_SECRET: string = RAW_TOKEN_SECRET;

const BASE_URL =
  process.env.APP_ORIGIN /* e.g. https://your-prod-domain.com */ ||
  "https://www.upreview.com.au";

/* ---------- Helpers ---------- */
function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function nl2br(s: string) {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

const CUSTOMER_TOKEN_REGEX = /\[customer\]/gi;

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);

// NOTE: must match verifyMagicToken()
function signLinkToken({
  businessId,
  clientId,
  exp,
}: {
  businessId: string;
  clientId: string;
  exp: number;
}): string {
  const payloadObj = { businessId, clientId, exp };
  const payloadJson = JSON.stringify(payloadObj);

  const sig = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(payloadJson)
    .digest("base64url");

  return Buffer.from(payloadJson).toString("base64url") + "." + sig;
}

/* ---------- Types ---------- */
type ReqBody = {
  businessId?: string;
  clientIds?: string[];
};

type TemplateRow = {
  business_display_name: string | null;
  business_email: string | null;
  email_subject: string | null;
  email_body: string | null;
};

type ClientRow = {
  id: string;
  display_name: string | null;
  email: string | null;
};

/** Minimal shape for Resend’s response to avoid `any` */
type ResendSendResult = {
  data?: { id?: string | null } | null;
  error?: { message?: string } | string | null;
};

export async function POST(req: NextRequest) {
  // 1) Auth
  const session = await auth.api.getSession({ headers: req.headers });
  const authedUserId = session?.user?.id;
  if (!authedUserId) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Sign in required." },
      { status: 401 }
    );
  }

  // 2) Input
  const body = (await req.json().catch(() => ({}))) as ReqBody;
  const rawBusinessId = body?.businessId?.trim();
  const clientIds = Array.isArray(body?.clientIds) ? body.clientIds : [];

  if (!isUUID(rawBusinessId)) {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "Valid businessId is required." },
      { status: 400 }
    );
  }
  if (clientIds.length === 0) {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "clientIds[] is required." },
      { status: 400 }
    );
  }

  const businessId: string = rawBusinessId!;
  const pool = getPool();
  const db: PoolClient = await pool.connect();

  let templateData: TemplateRow | null = null;
  let clients: ClientRow[] = [];

  try {
    await db.query("BEGIN");
    // Attach BetterAuth user ID for RLS on this connection
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [
      authedUserId,
    ]);

    // 3) Fetch business + template (email_templates is optional)
    const tmplQ = await db.query<TemplateRow>(
      `
      SELECT
        b.display_name AS business_display_name,
        b.business_email AS business_email,
        COALESCE(t.email_subject, 'Please leave us a review!') AS email_subject,
        COALESCE(
          t.email_body,
          'We would really appreciate if you left us a review. Please leave your feedback using the buttons below.'
        ) AS email_body
      FROM public.businesses b
      LEFT JOIN public.email_templates t
        ON t.business_id = b.id
      WHERE b.id = $1
      LIMIT 1
      `,
      [businessId]
    );

    if (tmplQ.rowCount === 0) {
      await db.query("ROLLBACK");
      db.release();
      return NextResponse.json(
        {
          error: "NOT_ALLOWED_OR_NOT_FOUND",
          message:
            "You do not have access to this business or it does not exist.",
        },
        { status: 403 }
      );
    }
    templateData = tmplQ.rows[0];

    // 4) Limit to the requested clients that actually belong to this business
    const clientsQ = await db.query<ClientRow>(
      `
      SELECT
        c.id,
        c.display_name AS display_name,
        c.email
      FROM public.clients c
      WHERE c.business_id = $1
        AND c.id = ANY($2)
      `,
      [businessId, clientIds]
    );

    clients = clientsQ.rows;

    await db.query("COMMIT");
  } catch (err: unknown) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    db.release();
    console.error("[/api/send-bulk-emails] initial SELECT error:", err);
    return NextResponse.json(
      { error: "SERVER_ERROR", message: "Could not prepare bulk email." },
      { status: 500 }
    );
  } finally {
    // release the main connection
    db.release();
  }

  if (!templateData) {
    return NextResponse.json(
      { error: "TEMPLATE_NOT_FOUND", message: "No template available." },
      { status: 404 }
    );
  }

  // Template values
  const businessDisplayName =
    (templateData.business_display_name || "Our Team").trim();
  const businessEmail = templateData.business_email || "";

  const baseSubject =
    templateData.email_subject || "Please leave us a review!";
  const baseBody =
    templateData.email_body ||
    "We would really appreciate if you left us a review. Please leave your feedback using the buttons below.";

  // Prefer the business's own email address, fallback to sandbox
  // (Removed previous unused `fromHeader` var to satisfy linter.)

  // Prepare result structure
  const foundIds = new Set(clients.map((c) => c.id));
  const missingIds = clientIds.filter((id) => !foundIds.has(id));
  const results: {
    sent: { clientId: string; email: string }[];
    failed: { clientId: string; error: string }[];
    missing: string[];
  } = { sent: [], failed: [], missing: missingIds };

  async function sendOne(client: ClientRow) {
    if (!client.email) {
      throw new Error("Client has no email");
    }

    const clientName = (client.display_name || "Customer").trim();

    // 1. Personalise the copy
    const subj = baseSubject.replace(CUSTOMER_TOKEN_REGEX, clientName);
    const bodyCore = baseBody.replace(CUSTOMER_TOKEN_REGEX, clientName);

    // 2. Build per-client signed token (MUST match verifyMagicToken expectations)
    const expiresAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const token = signLinkToken({
      businessId,
      clientId: client.id,
      exp: expiresAtMs,
    });

    // 3. Build the CTA links
    const goodHref = `${BASE_URL}/submit-review/${encodeURIComponent(
      client.id
    )}?type=good&businessId=${encodeURIComponent(
      businessId
    )}&token=${encodeURIComponent(token)}`;

    const badHref = `${BASE_URL}/submit-review/${encodeURIComponent(
      client.id
    )}?type=bad&businessId=${encodeURIComponent(
      businessId
    )}&token=${encodeURIComponent(token)}`;

    // 4. Email bodies
    const text = `Hi ${clientName},

${bodyCore}

Happy with our service? Please leave us a public review:
${goodHref}

Not happy? Tell us privately so we can fix it:
${badHref}

Best regards,
${businessDisplayName}
`;

    const html = `
      <p>Hi ${escapeHtml(clientName)},</p>

      <p>${nl2br(bodyCore)}</p>

      <div style="margin:24px 0;">
        <a
          href="${goodHref}"
          style="
            background:#16a34a;
            color:#ffffff;
            padding:12px 24px;
            text-decoration:none;
            font-family:Arial, sans-serif;
            font-size:16px;
            font-weight:bold;
            border-radius:6px;
            display:inline-block;
            margin-right:12px;
          "
        >
          Happy
        </a>

        <a
          href="${badHref}"
          style="
            background:#dc2626;
            color:#ffffff;
            padding:12px 24px;
            text-decoration:none;
            font-family:Arial, sans-serif;
            font-size:16px;
            font-weight:bold;
            border-radius:6px;
            display:inline-block;
          "
        >
          Unsatisfied
        </a>
      </div>

      <p>
        Best regards,<br>
        ${escapeHtml(businessDisplayName)}
      </p>
    `.trim();

    // 5. FORCE a known-good "from" while in sandbox mode.
    const sandboxFromHeader = `${businessDisplayName} <${
      businessEmail || "onboarding@resend.dev"
    }>`; // if custom email not verified, provider will ignore/override

    // 6. Actually send, and CAPTURE the result (typed, no `any`)
    const sendResult: ResendSendResult = await resend.emails.send({
      from: sandboxFromHeader,
      to: [client.email],
      subject: subj || "We’d love your feedback!",
      text,
      html,
    });

    const messageId = sendResult.data?.id ?? undefined;
    const errorMsg =
      typeof sendResult.error === "string"
        ? sendResult.error
        : sendResult.error?.message;

    if (errorMsg || !messageId) {
      throw new Error(errorMsg || "Email provider did not accept the send request");
    }

    // 7. Log to client_actions ONLY IF we actually sent successfully
    const dbc = await getPool().connect();
    try {
      await dbc.query("BEGIN");
      await dbc.query(`SELECT set_config('app.user_id', $1, true)`, [
        authedUserId,
      ]);

      await dbc.query(
        `
        INSERT INTO public.client_actions (
          business_id,
          client_id,
          actor_id,
          action,
          meta
        )
        VALUES ($1, $2, $3, 'email_sent', jsonb_build_object(
          'email', $4::text,
          'subject', $5::text,
          'expiresAtMs', $6::bigint,
          'messageId', $7::text
        ))
        `,
        [
          businessId,
          client.id,
          authedUserId,
          client.email,
          subj || "We’d love your feedback!",
          expiresAtMs,
          messageId || null,
        ]
      );

      await dbc.query("COMMIT");
    } catch (err: unknown) {
      try {
        await dbc.query("ROLLBACK");
      } catch {}
      throw err;
    } finally {
      dbc.release();
    }
  }

  // Fan out over clients with small concurrency
  const CONCURRENCY = 5;
  let cursor = 0;

  async function worker() {
    while (cursor < clients.length) {
      const idx = cursor++;
      const c = clients[idx];
      try {
        await sendOne(c);
        results.sent.push({ clientId: c.id, email: c.email || "" });
      } catch (err: unknown) {
        results.failed.push({
          clientId: c.id,
          error: err instanceof Error ? err.message : "Send failed",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, clients.length) }, () => worker())
  );

  return NextResponse.json(
    {
      success: true,
      ...results,
    },
    { status: 200 }
  );
}
