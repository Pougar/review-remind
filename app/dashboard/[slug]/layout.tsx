// app/dashboard/[slug]/layout.tsx
import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { UserProvider } from "@/app/lib/UserContext";
import { checkSessionServer } from "@/app/lib/checkSessionServer";

interface DashboardLayoutProps {
  children: ReactNode;
  // keep this as a Promise to match your previous validator shape
  params: Promise<{ slug: string }>;
}

export default async function DashboardLayout({ children, params }: DashboardLayoutProps) {
  const { slug } = await params;

  // Validate the session using cookies from the current request (no direct DB work here)
  const result = await checkSessionServer(slug);
  if (!result.valid) {
    console.log(result.reason);
    redirect("/log-in");
  }

  return (
    <UserProvider value={{ name: slug, display: result.display_name }}>
      {/* if you want a top nav like before, import and add it here */}
      {/* <TopNav /> */}
      <div className="pt-20 px-4 md:px-12">{children}</div>
    </UserProvider>
  );
}
