// app/lib/onboarding-flow-guard.ts
import "server-only";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { API, ROUTES, type Stage } from "@/app/lib/constants";

// Build a base origin without needing headers (works in dev/prod)
function baseUrl() {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return (fromEnv || "http://localhost:3000").replace(/\/$/, "");
}

export async function enforceBusinessOnboardingOrRedirect(params: {
  userId: string;
  slug: string;         // user slug
  businessSlug: string; // business slug
}) {
  const { userId, slug, businessSlug } = params;
  if (!userId || !slug || !businessSlug) return;

  // Typed: `headers()` returns ReadonlyHeaders; Promise.resolve keeps future-compat
  const hdrs = await Promise.resolve(headers());
  const cookie = hdrs.get("cookie") ?? "";
  const abs = (path: string) => `${baseUrl()}${path}`;

  // 1) Resolve businessId from slug
  const idRes = await fetch(abs(API.GET_BUSINESS_ID_BY_SLUG), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    cache: "no-store",
    body: JSON.stringify({ businessSlug, userId }),
  });

  if (idRes.status === 404) {
    redirect(`${ROUTES.DASHBOARD}/${encodeURIComponent(slug)}`);
  }
  if (!idRes.ok) return; // fail-open or redirect if you prefer

  const { id: businessId } = (await idRes.json().catch(() => ({}))) as { id?: string };
  if (!businessId) {
    redirect(`${ROUTES.DASHBOARD}/${encodeURIComponent(slug)}`);
  }

  // 2) Check onboarding stage
  const stageRes = await fetch(abs(API.CHECK_BUSINESS_STAGE), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    cache: "no-store",
    body: JSON.stringify({ businessId, userId }),
  });

  if (!stageRes.ok) {
    redirect(
      `${ROUTES.DASHBOARD}/${encodeURIComponent(slug)}/add-business/link-google?bid=${encodeURIComponent(
        businessId
      )}`
    );
  }

  const { stage } = (await stageRes.json().catch(() => ({}))) as { stage?: Stage };
  if (!stage || stage === "already_linked") return; // proceed

  const base = `${ROUTES.DASHBOARD}/${encodeURIComponent(slug)}/add-business`;
  if (stage === "link_google") {
    redirect(`${base}/link-google?bid=${encodeURIComponent(businessId)}`);
  } else if (stage === "link-xero") {
    redirect(`${base}/link-xero?bid=${encodeURIComponent(businessId)}`);
  } else {
    redirect(`${base}/business-details?bid=${encodeURIComponent(businessId)}`);
  }
}
