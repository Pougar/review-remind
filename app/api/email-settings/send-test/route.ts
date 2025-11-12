import { NextRequest, NextResponse } from "next/server";
import { Pool, PoolClient } from "pg";
import { Resend } from "resend";
import { auth } from "@/app/lib/auth";
import { signMagicToken } from "@/app/lib/magic-token-signer";
import { supabaseAdmin } from "@/app/lib/supabaseServer";
import { generateReviewEmail } from "@/app/lib/email-template";

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

/* ---------- Constants ---------- */

const CUSTOMER_TOKEN_REGEX = /\[customer\]/gi;

const BASE_URL = process.env.APP_ORIGIN || "https://www.upreview.com.au";

// ✅ your verified sending domain (sanitize leading '@' if present)
const RAW_RESEND_DOMAIN =
  process.env.RESEND_DOMAIN || "reminders.upreview.com.au";
const RESEND_DOMAIN = RAW_RESEND_DOMAIN.replace(/^@+/, "");

// Fallback if nothing else works
const FALLBACK_FROM_EMAIL =
  process.env.RESEND_FROM || `no-reply@${RESEND_DOMAIN}`;

// Private bucket for company logos
const LOGO_BUCKET = "company-logos";
const LOGO_SIGNED_TTL = 60 * 60 * 24; // 24h

// Thumbs from env (public, can be any CDN/Supabase public bucket)
const THUMB_UP_URL = process.env.EMAIL_HAPPY_URL || "";
const THUMB_DOWN_URL = process.env.EMAIL_SAD_URL || "";

/* ---------- Helpers ---------- */

const isUUID = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(v);
const emailLooksValid = (s: string) => /^\S+@\S+\.\S+$/.test(s);

// Helper functions moved to email-template.ts

function describeError(err: unknown) {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
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

function makeSenderLocalPart(slug?: string | null): string | null {
  if (!slug) return null;
  const cleaned = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || null;
}

async function getLogoSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path || !path.trim()) return null;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(path, LOGO_SIGNED_TTL);

    if (error || !data?.signedUrl) {
      console.error("[send-test] createSignedUrl error:", error);
      return null;
    }

    return data.signedUrl;
  } catch (err) {
    console.error("[send-test] Supabase logo error:", err);
    return null;
  }
}

/* ---------- Types ---------- */

type ReqBody = {
  businessId?: string;
  toEmail?: string;
};

type TemplateRow = {
  business_display_name: string | null;
  business_email: string | null; // not used as sender
  business_slug: string | null;
  email_subject: string | null;
  email_body: string | null;
  company_logo_url: string | null; // path in private bucket (e.g. "bid/logo.png")
};

/* ---------- Route ---------- */

export async function POST(req: NextRequest) {
  // 1) Auth
  const session = await auth.api.getSession({ headers: req.headers });
  const senderUserId = session?.user?.id;
  if (!senderUserId) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Sign in required." },
      { status: 401 }
    );
  }

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
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [senderUserId]);

    const tplQ = await db.query<TemplateRow>(
      `
      SELECT
        b.display_name       AS business_display_name,
        b.business_email     AS business_email,
        b.slug               AS business_slug,
        et.email_subject     AS email_subject,
        et.email_body        AS email_body,
        b.company_logo_url   AS company_logo_url
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

  // 4) Per-business logo (signed URL from private bucket)
  const logoUrl = await getLogoSignedUrl(templateData.company_logo_url);

  // 5) Build From header using business slug

  const businessDisplayName = (
    templateData.business_display_name || "Our Team"
  ).trim();

  const slugLocal = makeSenderLocalPart(templateData.business_slug);
  const senderAddress = slugLocal
    ? `${slugLocal}@${RESEND_DOMAIN}`
    : FALLBACK_FROM_EMAIL;

  const fromHeader = `"${businessDisplayName}" <${senderAddress}>`;

  // 6) Build content

  const clientName = "Customer";
  const clientId = "test";

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

  const baseSubject =
    templateData.email_subject ||
    "We loved helping you! Please leave a review.";
  const baseBody =
    templateData.email_body ||
    "We hope you enjoyed our service! Please leave us a review.";

  const finalSubject = baseSubject.replace(CUSTOMER_TOKEN_REGEX, clientName);
  const finalBody = baseBody.replace(CUSTOMER_TOKEN_REGEX, clientName);

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

  // Generate email using shared template
  const { html, text } = generateReviewEmail({
    logoUrl,
    companyName: businessDisplayName,
    clientName,
    emailSubject: finalSubject,
    emailBody: finalBody,
    goodReviewHref: goodHref,
    badReviewHref: badHref,
    thumbUpUrl: THUMB_UP_URL || null,
    thumbDownUrl: THUMB_DOWN_URL || null,
  });

  // 7) Send
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
          "We couldn't send the test email. Please confirm your Resend domain, sender, and image URLs.",
        resendError: info.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      sentTo: destEmail,
      businessId,
      from: fromHeader,
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
