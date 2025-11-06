"use client";

import { createContext, useContext } from "react";

export interface UserContextValue {
  /** URL-safe slug (DB: myusers.name) */
  name: string;
  /** Human-readable name (DB: myusers.display_name) */
  display: string | null;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

type ProviderProps =
  | { value: UserContextValue; children: React.ReactNode }
  | { name: string; display: string | null; children: React.ReactNode };

export function UserProvider(props: ProviderProps) {
  const value =
    "value" in props ? props.value : { name: props.name, display: props.display };
  const { children } = props;
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within a UserProvider");
  return ctx; // { name, display }
}
