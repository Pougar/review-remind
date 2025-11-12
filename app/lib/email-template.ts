/**
 * Email template generator for review request emails
 * 
 * This module provides a reusable function to generate both HTML and plain text
 * versions of review request emails with consistent styling and formatting.
 */

/* ---------- Helper Functions ---------- */

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nl2br(s: string): string {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

/* ---------- Types ---------- */

export type EmailTemplateOptions = {
  /** Company logo URL (signed URL from storage) - optional */
  logoUrl?: string | null;
  /** Company/business display name */
  companyName: string;
  /** Client/customer name */
  clientName: string;
  /** Email subject line (with [customer] token already replaced) */
  emailSubject: string;
  /** Email body text (with [customer] token already replaced) */
  emailBody: string;
  /** URL for the "good/happy" review link */
  goodReviewHref: string;
  /** URL for the "bad/unsatisfied" review link */
  badReviewHref: string;
  /** Optional URL for thumb up image (if not provided, uses button fallback) */
  thumbUpUrl?: string | null;
  /** Optional URL for thumb down image (if not provided, uses button fallback) */
  thumbDownUrl?: string | null;
};

export type EmailTemplateResult = {
  /** HTML version of the email */
  html: string;
  /** Plain text version of the email */
  text: string;
};

/* ---------- Main Function ---------- */

/**
 * Generates HTML and plain text versions of a review request email
 * 
 * @param options - Configuration options for the email template
 * @returns Object containing both HTML and text versions of the email
 */
export function generateReviewEmail({
  logoUrl,
  companyName,
  clientName,
  emailSubject,
  emailBody,
  goodReviewHref,
  badReviewHref,
  thumbUpUrl,
  thumbDownUrl,
}: EmailTemplateOptions): EmailTemplateResult {
  // Escape HTML for safety
  const safeCompanyName = escapeHtml(companyName);
  const safeClientName = escapeHtml(clientName);
  const safeEmailBody = nl2br(emailBody);

  // Generate plain text version
  const text = `Hi ${clientName},

${emailBody}

Please let us know how we went:

Happy: ${goodReviewHref}
Unsatisfied: ${badReviewHref}

Best regards,
${companyName}
`;

  // Generate HTML version
  const hasThumbImages = thumbUpUrl && thumbDownUrl;

  const html = `
    <div style="background-color:#f4f4f5;padding:24px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:12px;padding:32px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
              <tr>
                <td align="center" style="padding-bottom:24px;">
                  ${
                    logoUrl
                      ? `<img src="${logoUrl}" alt="${safeCompanyName} logo" style="max-width:160px;height:auto;display:block;margin:0 auto 8px auto;" />`
                      : ""
                  }
                  <div style="font-size:18px;font-weight:600;color:#111827;">
                    ${safeCompanyName}
                  </div>
                </td>
              </tr>

              <tr>
                <td style="font-size:16px;line-height:1.6;color:#111827;">
                  <p style="margin:0 0 12px 0;">Hi ${safeClientName},</p>
                  <p style="margin:0 0 16px 0;">${safeEmailBody}</p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding:24px 0 16px 0;">
                  ${
                    hasThumbImages
                      ? `
                        <table cellpadding="0" cellspacing="0" role="presentation">
                          <tr>
                            <td align="center" style="padding-right:24px;">
                              <a href="${goodReviewHref}" style="text-decoration:none;">
                                <img
                                  src="${thumbUpUrl}"
                                  alt="Happy with our service"
                                  style="width:72px;height:72px;display:block;margin:0 auto;"
                                />
                                <div style="font-size:13px;color:#16a34a;margin-top:6px;">
                                  Happy
                                </div>
                              </a>
                            </td>
                            <td align="center" style="padding-left:24px;">
                              <a href="${badReviewHref}" style="text-decoration:none;">
                                <img
                                  src="${thumbDownUrl}"
                                  alt="Not satisfied with our service"
                                  style="width:72px;height:72px;display:block;margin:0 auto;"
                                />
                                <div style="font-size:13px;color:#dc2626;margin-top:6px;">
                                  Unsatisfied
                                </div>
                              </a>
                            </td>
                          </tr>
                        </table>
                      `
                      : `
                        <div style="margin:0;">
                          <a
                            href="${goodReviewHref}"
                            style="
                              background:#16a34a;
                              color:#ffffff;
                              padding:12px 24px;
                              text-decoration:none;
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
                            href="${badReviewHref}"
                            style="
                              background:#dc2626;
                              color:#ffffff;
                              padding:12px 24px;
                              text-decoration:none;
                              font-size:16px;
                              font-weight:bold;
                              border-radius:6px;
                              display:inline-block;
                            "
                          >
                            Unsatisfied
                          </a>
                        </div>
                      `
                  }
                </td>
              </tr>

              <tr>
                <td style="font-size:14px;line-height:1.6;color:#6b7280;padding-top:8px;">
                  <p style="margin:0;">
                    Best regards,<br />
                    ${safeCompanyName}
                  </p>
                </td>
              </tr>
            </table>

            <div style="font-size:11px;color:#9ca3af;padding-top:12px;">
              If you received this email in error, you can safely ignore it.
            </div>
          </td>
        </tr>
      </table>
    </div>
  `.trim();

  return { html, text };
}

