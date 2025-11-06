// app/dashboard/[slug]/[business_slug]/layout.tsx
import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { UserProvider } from "@/app/lib/UserContext";
import { checkSessionServer } from "@/app/lib/checkSessionServer";
import { LogoUrlProvider } from "@/app/lib/logoUrlClient";
import TopNav from "@/app/ui/dashboard/TopNav";
import { enforceBusinessOnboardingOrRedirect } from "@/app/lib/onboarding-flow-guard";
import { ROUTES } from "@/app/lib/constants";
;

interface Props {
  children: ReactNode;
  params: Promise<{ slug: string; bslug: string }>;
}

export default async function DashboardBusinessLayout({ children, params }: Props) {
  const { slug, bslug } = await params;

  const result = await checkSessionServer(slug);
  if (!result.valid) redirect(ROUTES.LOG_IN);

  // 👇 Simple, API-driven guard
  await enforceBusinessOnboardingOrRedirect({
    userId: result.user_id,
    slug,
    businessSlug: bslug,
  });

  return (
    <UserProvider value={{ name: slug, display: result.display_name }}>
      <LogoUrlProvider userId={result.user_id}>
        <TopNav />
        <div className="pt-20 px-4 md:px-12">{children}</div>
      </LogoUrlProvider>
    </UserProvider>
  );
}
