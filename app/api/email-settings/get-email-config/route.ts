// app/api/email-settings/get-email-config/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns email configuration (thumb image URLs) for client-side use
 * This allows the email preview to use the same images as the actual emails
 */
export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      thumbUpUrl: process.env.EMAIL_HAPPY_URL || null,
      thumbDownUrl: process.env.EMAIL_SAD_URL || null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}

