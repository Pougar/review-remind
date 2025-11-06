// app/api/email-settings/send-test/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { Resend } from "resend";
import { auth } from "@/app/lib/auth";
import { signMagicToken } from "@/app/lib/magic-token-signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   Resend
   ============================================================ */
const resend = new Resend(process.env.RESEND_API_KEY);

/* ============================================================
   PG Pool (singleton across HMR)
   ============================================================ */
declare global {
  // eslint-disable-next-line no-var
  var _pgPoolSendTestEmailBiz: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPoolSendTestEmailBiz) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPoolSendTestEmailBiz = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false }, // keep consistent
      max: 5,
    });
  }
  return global._pgPoolSendTestEmailBiz;
}

/* ============================================================
   Helpers
   ============================================================ */

const isUUID = (v?: string | null) =>
  !!v && /^[0-9a-fA-F-]{36}$/.test(v);

const emailLooksValid = (s: string) => /^\S+@\S+\.\S+$/.test(s);

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

function describeError(err: unknown) {
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
    };
  }
  if (typeof err === "string") {
    return { message: err, stack: undefined };
  }
  try {
    return { message: JSON.stringify(err), stack: undefined };
  } catch {
    return { message: "Unknown error", stack: undefined };
  }
}

// We'll personalise [customer] → "Customer" in the preview email
const CUSTOMER_TOKEN_REGEX = /\[customer\]/gi;

// Where the CTA buttons in the email should send people
const BASE_URL =
  process.env.APP_ORIGIN /* e.g. https://yourdomain.com */ ||
  "https://www.upreview.com.au";

/* ============================================================
   Types
   ============================================================ */

type ReqBody = {
  businessId?: string;
  toEmail?: string;
};

type TemplateRow = {
  business_display_name: string | null;
  business_email: string | null;
  email_subject: string | null;
  email_body: string | null;
};

/* ============================================================
   Route
   ============================================================ */

export async function POST(req: NextRequest) {
  // 1) Auth / RLS context
  const session = await auth.api.getSession({ headers: req.headers });
  const senderUserId = session?.user?.id;
  if (!senderUserId) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Sign in required." },
      { status: 401 }
    );
  }
  const authedUserId: string = senderUserId;

  // 2) Parse input
  const { businessId: rawBusinessId, toEmail: rawToEmail } =
    ((await req.json().catch(() => ({}))) as ReqBody) ?? {};

  const businessId = (rawBusinessId || "").trim();
  const destEmail = (rawToEmail || "").trim();

  if (!isUUID(businessId)) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "Valid businessId (uuid) is required.",
      },
      { status: 400 }
    );
  }

  if (!destEmail || !emailLooksValid(destEmail)) {
    return NextResponse.json(
      {
        error: "INVALID_EMAIL",
        message: "Please provide a valid destination email.",
      },
      { status: 400 }
    );
  }

  // 3) DB read with RLS
  const pool = getPool();
  const db: PoolClient = await pool.connect();

  let templateData: TemplateRow | null = null;

  try {
    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [
      authedUserId,
    ]);

    // pull per-business template + business metadata
    const tplQ = await db.query<TemplateRow>(
      `
      SELECT
        b.display_name       AS business_display_name,
        b.business_email     AS business_email,
        et.email_subject     AS email_subject,
        et.email_body        AS email_body
      FROM public.businesses b
      LEFT JOIN public.email_templates et
        ON et.business_id = b.id
      WHERE b.id = $1::uuid
      LIMIT 1
      `,
      [businessId]
    );

    if ((tplQ.rowCount ?? 0) === 0) {
      await db.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "NOT_ALLOWED_OR_NOT_FOUND",
          message: "Business not found or you do not have access.",
        },
        { status: 403 }
      );
    }

    templateData = tplQ.rows[0];
    await db.query("COMMIT");
  } catch (err: unknown) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    db.release();

    const info = describeError(err);
    console.error("[/api/email-settings/send-test] DB error:", info);

    const msg = info.message.toLowerCase();
    if (msg.includes("row-level security")) {
      return NextResponse.json(
        {
          error: "RLS_DENIED",
          message: "Permission denied by row-level security.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: "Could not load email template for this business.",
      },
      { status: 500 }
    );
  } finally {
    db.release();
  }

  if (!templateData) {
    return NextResponse.json(
      {
        error: "NO_TEMPLATE",
        message: "No template data could be loaded.",
      },
      { status: 404 }
    );
  }

  // 4) Build preview email content
  // For test emails we don't have a real client record.
  // We'll just pretend recipient is "Customer" and clientId = "test"
  const clientName = "Customer";
  const clientId = "test";

  // Generate a signed token for the preview link
  let signedToken: string;
  try {
    signedToken = signMagicToken({
      businessId,
      clientId,
    });
  } catch (err: unknown) {
    const info = describeError(err);
    console.error("[/api/email-settings/send-test] token error:", info);
    return NextResponse.json(
      {
        error: "TOKEN_ERROR",
        message:
          "Could not create signed link token. Check LINK_SIGNING_SECRET in env.",
      },
      { status: 500 }
    );
  }

  const businessDisplayName = (
    templateData.business_display_name || "Our Team"
  ).trim();

  const rawFromEmail = (templateData.business_email || "").trim().toLowerCase();

  // If it's a consumer mailbox (gmail/outlook/etc) Resend will reject it.
  // For preview, fall back to the sandbox sender instead of throwing.
  const looksLikePublicMailbox =
    rawFromEmail.endsWith("@gmail.com") ||
    rawFromEmail.endsWith("@yahoo.com") ||
    rawFromEmail.endsWith("@outlook.com") ||
    rawFromEmail.endsWith("@hotmail.com") ||
    rawFromEmail === "";

  const fromHeader = looksLikePublicMailbox
    ? `${businessDisplayName} <onboarding@resend.dev>`
    : `${businessDisplayName} <${rawFromEmail}>`;

  const baseSubject =
    templateData.email_subject ||
    "We loved helping you! Please leave a review.";
  const baseBody =
    templateData.email_body ||
    "We hope you enjoyed our service! Please leave us a review.";

  const finalSubject = baseSubject.replace(CUSTOMER_TOKEN_REGEX, clientName);
  const finalBody = baseBody.replace(CUSTOMER_TOKEN_REGEX, clientName);

  const text = `Hi ${clientName},

${finalBody}

Best regards,
${businessDisplayName}
`;

  const goodHref = `${BASE_URL}/submit-review/${encodeURIComponent(
    clientId
  )}?type=good&businessId=${encodeURIComponent(
    businessId
  )}&token=${encodeURIComponent(signedToken)}`;

  const badHref = `${BASE_URL}/submit-review/${encodeURIComponent(
    clientId
  )}?type=bad&businessId=${encodeURIComponent(
    businessId
  )}&token=${encodeURIComponent(signedToken)}`;

  const html = `
    <p>Hi ${escapeHtml(clientName)},</p>

    <p>${nl2br(finalBody)}</p>

    <div style="margin:24px 0;">
      <!-- Happy / Positive button -->
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

      <!-- Unsatisfied / Negative button -->
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

  // 5) Send via Resend
  try {
    await resend.emails.send({
      from: fromHeader,
      to: [destEmail],
      subject: finalSubject || "We’d love your feedback!",
      text,
      html,
    });
  } catch (err: unknown) {
    const info = describeError(err);
    console.error("[/api/email-settings/send-test] Resend error:", info);

    return NextResponse.json(
      {
        error: "SEND_FAILED",
        message:
          "We couldn't send the test email. If you're using Gmail/Outlook/etc as the From address, you need to verify a custom domain in Resend or we'll fall back to the sandbox sender.",
        resendError: info.message,
      },
      { status: 500 }
    );
  }

  // 6) Respond success / preview
  return NextResponse.json(
    {
      success: true,
      sentTo: destEmail,
      businessId,
      subjectPreview: finalSubject,
      bodyPreview: finalBody,
      linksPreview: {
        happy: goodHref,
        unsatisfied: badHref,
      },
    },
    { status: 200 }
  );
}
