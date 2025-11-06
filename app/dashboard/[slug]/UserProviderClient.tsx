"use client";

import { UserProvider } from "@/app/lib/UserContext";

export default function UserProviderClient({
  name,
  display,
  children,
}: {
  name: string;
  display: string | null;
  children: React.ReactNode;
}) {
  return <UserProvider name={name} display={display}>{children}</UserProvider>;
}
