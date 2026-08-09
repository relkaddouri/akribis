"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/auth/roles";

export type DashboardUser = {
  name: string | null;
  email: string;
  role: Role;
};

const DashboardUserContext = createContext<DashboardUser | null>(null);

/**
 * Makes the signed-in user available to client components anywhere under
 * the dashboard layout (e.g. DashboardHeader's avatar menu) without every
 * page having to re-fetch requireUser() just to pass it down — mirrors
 * how OfflineProvider already threads pharmacyId/userId the same way.
 */
export function DashboardUserProvider({
  user,
  children,
}: {
  user: DashboardUser;
  children: React.ReactNode;
}) {
  return <DashboardUserContext.Provider value={user}>{children}</DashboardUserContext.Provider>;
}

export function useDashboardUser(): DashboardUser {
  const user = useContext(DashboardUserContext);
  if (!user) {
    throw new Error("useDashboardUser must be used within a DashboardUserProvider");
  }
  return user;
}
