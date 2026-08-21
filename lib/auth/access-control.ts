import { isAdminRole, type Role } from "@/lib/auth/roles";

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
/** Akribis back-office. Nothing under it belongs to a pharmacy. */
export const ADMIN_PATH = "/admin";
export const ADMIN_CATALOGUE_PATH = "/admin/catalogue";
export const ADMIN_JOURNAL_PATH = "/admin/journal";
/** Where an Akribis admin lands — they have no pharmacy dashboard to go to. */
export const DEFAULT_ADMIN_PATH = ADMIN_CATALOGUE_PATH;
/** Shown when the middleware finds the app misconfigured. Never protected. */
export const CONFIG_ERROR_PATH = "/erreur-configuration";
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
  ADMIN_PATH,
] as const;

/** Pages only meant for signed-out visitors (login, signup). */
const GUEST_ONLY_PATHS = [LOGIN_PATH, SIGNUP_PATH] as const;

/**
 * Route prefixes only the pharmacy owner may reach: pharmacy settings and
 * detailed financial statistics are off-limits to assistants.
 */
export const OWNER_ONLY_PREFIXES = [SETTINGS_PATH, "/dashboard/stats"] as const;

/** Route prefixes only Akribis staff may reach. */
export const ADMIN_ONLY_PREFIXES = [ADMIN_PATH] as const;

/**
 * Prefix match on whole path segments: `/admin` covers `/admin` and
 * `/admin/catalogue`, but not `/administration-des-ventes`. A bare
 * `startsWith` would hand any future route whose name merely *begins*
 * with an existing module's name that module's access rules — which for
 * `/admin` would mean opening the Akribis back-office to a route nobody
 * intended to put there.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Note that this is the registry the middleware works from: a new module
 * is invisible to it until its root is added to PROTECTED_PREFIXES.
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isOwnerOnlyPath(pathname: string): boolean {
  return OWNER_ONLY_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function canAccess(role: Role | null, pathname: string): boolean {
  if (!isProtectedPath(pathname)) return true;
  if (!role) return false;

  // The barrier runs both ways. An Akribis admin is not a pharmacist and
  // has no `pharmacy_id`, so letting them into a pharmacy route wouldn't
  // just be a privacy problem — every scoped query would have nothing to
  // scope by.
  if (isAdminOnlyPath(pathname)) return isAdminRole(role);
  if (isAdminRole(role)) return false;

  if (isOwnerOnlyPath(pathname)) return role === "owner";
  return true;
}

/** Home page for a role — where to send someone who is in the wrong space. */
export function defaultPathForRole(role: Role | null): string {
  return isAdminRole(role) ? DEFAULT_ADMIN_PATH : DEFAULT_AUTHENTICATED_PATH;
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
    if (canAccess(role, pathname)) return null;
    // Sending them to their own space rather than a 403 page: a pharmacist
    // who lands on /admin has followed a stale link, and an admin who
    // lands on /dashboard has no dashboard to be shown.
    return defaultPathForRole(role);
  }

  if ((GUEST_ONLY_PATHS as readonly string[]).includes(pathname) && isAuthenticated) {
    return defaultPathForRole(role);
  }

  return null;
}
