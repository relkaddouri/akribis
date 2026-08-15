import type { Role } from "@/lib/auth/roles";

export const LOGIN_PATH = "/login";
export const SIGNUP_PATH = "/inscription";
export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";
export const SETTINGS_PATH = "/parametres";
export const NEWS_PATH = "/actualites";
export const INVOICES_PATH = "/factures";
export const SALES_PATH = "/ventes";
export const REMINDERS_PATH = "/rappels";
export const ORDERS_PATH = "/commandes";
export const INVENTORY_PATH = "/inventaire";
export const FORGOT_PASSWORD_PATH = "/mot-de-passe-oublie";
/**
 * Deliberately NOT in GUEST_ONLY_PATHS below: completing a password
 * reset link authenticates the visitor via a short-lived recovery
 * session, so treating this page as "guest only" would bounce them to
 * the dashboard before they can actually set a new password.
 */
export const RESET_PASSWORD_PATH = "/reinitialiser-mot-de-passe";

/**
 * Route prefixes that require a signed-in session. The actualités feed is
 * readable by owner and assistant alike, so it's protected but not
 * owner-only.
 */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  SETTINGS_PATH,
  NEWS_PATH,
  INVOICES_PATH,
  SALES_PATH,
  REMINDERS_PATH,
  ORDERS_PATH,
  INVENTORY_PATH,
] as const;

/** Pages only meant for signed-out visitors (login, signup). */
const GUEST_ONLY_PATHS = [LOGIN_PATH, SIGNUP_PATH] as const;

/**
 * Route prefixes only the pharmacy owner may reach: pharmacy settings and
 * detailed financial statistics are off-limits to assistants.
 */
export const OWNER_ONLY_PREFIXES = [SETTINGS_PATH, "/dashboard/stats"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isOwnerOnlyPath(pathname: string): boolean {
  return OWNER_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function canAccess(role: Role | null, pathname: string): boolean {
  if (!isProtectedPath(pathname)) return true;
  if (!role) return false;
  if (isOwnerOnlyPath(pathname)) return role === "owner";
  return true;
}

/**
 * Pure decision function used by the middleware (and directly by tests):
 * given the current request path and session, returns the path to
 * redirect to, or null if the request should proceed as-is.
 */
export function resolveAuthRedirect(params: {
  pathname: string;
  isAuthenticated: boolean;
  role: Role | null;
}): string | null {
  const { pathname, isAuthenticated, role } = params;

  if (isProtectedPath(pathname)) {
    if (!isAuthenticated) return LOGIN_PATH;
    if (isOwnerOnlyPath(pathname) && role !== "owner") return DEFAULT_AUTHENTICATED_PATH;
    return null;
  }

  if ((GUEST_ONLY_PATHS as readonly string[]).includes(pathname) && isAuthenticated) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  return null;
}
