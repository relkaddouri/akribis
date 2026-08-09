import type { User } from "@supabase/supabase-js";

export const ROLES = ["owner", "assistant"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Role and pharmacy live in `app_metadata`, which is only writable via
 * the Admin API (service role key) — unlike `user_metadata`, it can't be
 * tampered with by the signed-in user themselves.
 */
export function getSessionRoleFromUser(user: Pick<User, "app_metadata"> | null): Role | null {
  const role = user?.app_metadata?.role;
  return isRole(role) ? role : null;
}

export function getPharmacyIdFromUser(user: Pick<User, "app_metadata"> | null): string | null {
  const pharmacyId = user?.app_metadata?.pharmacy_id;
  return typeof pharmacyId === "string" && pharmacyId.length > 0 ? pharmacyId : null;
}
