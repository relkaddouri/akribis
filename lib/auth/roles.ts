import type { User } from "@supabase/supabase-js";

/**
 * Roles held by someone who works *inside* a pharmacy. They always carry a
 * `pharmacy_id` claim, and every query they make is scoped to it.
 */
export const PHARMACY_ROLES = ["owner", "assistant"] as const;
export type PharmacyRole = (typeof PHARMACY_ROLES)[number];

/**
 * The Akribis staff role — already referenced by lib/server/publications.ts,
 * which notes that authoring the actualités feed "is an admin_akribis
 * concern". This is that role.
 *
 * Deliberately NOT a member of the Prisma `UserRole` enum, and no row in
 * `public.users`: that table exists to attach pharmacy work (sales,
 * inventory sessions, read receipts) to a person within one tenant, and
 * every row requires a `pharmacy_id`. An Akribis admin belongs to no
 * pharmacy and records no pharmacy work — giving them a fake one would put
 * a non-pharmacist inside a tenant's data. Their role lives only where the
 * role already lives: Supabase `app_metadata`, writable solely through the
 * service-role Admin API.
 */
export const ADMIN_ROLE = "admin_akribis" as const;
export type AdminRole = typeof ADMIN_ROLE;

export const ROLES = [...PHARMACY_ROLES, ADMIN_ROLE] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isPharmacyRole(value: Role | null): value is PharmacyRole {
  return value === "owner" || value === "assistant";
}

export function isAdminRole(value: Role | null): value is AdminRole {
  return value === ADMIN_ROLE;
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
