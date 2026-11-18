import "server-only";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  getEffectiveRoleFromUser,
  getPharmacyIdFromUser,
  getSessionRoleFromUser,
  isAdminRole,
  isPharmacyRole,
  type AdminRole,
  type PharmacyRole,
} from "@/lib/auth/roles";
import {
  LOGIN_PATH,
  DEFAULT_AUTHENTICATED_PATH,
  DEFAULT_ADMIN_PATH,
  NO_ROLE_LOGIN_PATH,
} from "@/lib/auth/access-control";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: PharmacyRole;
  pharmacyId: string;
};

/** An Akribis staff member. No pharmacy — see the note in lib/auth/roles.ts. */
export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
};

/**
 * The verified Supabase user, falling back to the cookie-cached session
 * when the network is what failed rather than the credentials.
 */
async function readAuthUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user: verifiedUser },
    error: getUserError,
  } = await supabase.auth.getUser();

  if (verifiedUser) return verifiedUser;

  if (getUserError && isAuthRetryableFetchError(getUserError)) {
    // Same reasoning as lib/supabase/middleware.ts: a network failure
    // reaching Supabase isn't proof the user logged out, so fall back to
    // the session cached in cookies rather than kicking them to /login.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user ?? null;
  }

  return null;
}

function displayName(user: User): string | null {
  return typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null;
}

/**
 * Reads the current *pharmacy* session from Supabase Auth. Returns null
 * when no one is signed in, when a signed-in account is missing
 * role/pharmacy claims (e.g. mid-invite, before an admin finished
 * provisioning it), or when the signed-in account is Akribis staff —
 * they have no pharmacy, so every caller of this function, all of which
 * scope their queries by `pharmacyId`, must not receive them.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  return toSessionUser(await readAuthUser());
}

function toSessionUser(user: User | null): SessionUser | null {
  if (!user) return null;

  const role = getSessionRoleFromUser(user);
  const pharmacyId = getPharmacyIdFromUser(user);
  if (!isPharmacyRole(role) || !pharmacyId) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    name: displayName(user),
    role,
    pharmacyId,
  };
}

/**
 * Where to send a signed-in account a guard turned away. Never plain
 * /login: the middleware bounces anyone with a role off that page, so an
 * account the guard rejects would come straight back here. An account
 * with no usable role is sent to /login with an explanation, and the
 * middleware lets it stay there.
 */
function homeForSignedInUser(user: User): string {
  const role = getEffectiveRoleFromUser(user);
  if (isAdminRole(role)) return DEFAULT_ADMIN_PATH;
  if (isPharmacyRole(role)) return DEFAULT_AUTHENTICATED_PATH;
  return NO_ROLE_LOGIN_PATH;
}

/**
 * For Server Components/Actions: redirects to /login if not signed in, and
 * a signed-in account that is not a pharmacy user to its own home.
 */
export async function requireUser(): Promise<SessionUser> {
  const authUser = await readAuthUser();
  if (!authUser) redirect(LOGIN_PATH);
  const user = toSessionUser(authUser);
  if (!user) redirect(homeForSignedInUser(authUser));
  return user;
}

/**
 * For Server Components/Actions: redirects non-owners back to the
 * dashboard. Defense in depth alongside the middleware — never rely on
 * the UI hiding a link as the only protection for an owner-only action.
 */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "owner") redirect(DEFAULT_AUTHENTICATED_PATH);
  return user;
}

export async function getAdminUser(): Promise<AdminUser | null> {
  return toAdminUser(await readAuthUser());
}

function toAdminUser(user: User | null): AdminUser | null {
  if (!user) return null;

  const role = getSessionRoleFromUser(user);
  if (!isAdminRole(role)) return null;

  return { id: user.id, email: user.email ?? "", name: displayName(user), role };
}

/**
 * The gate for the whole Akribis back-office. Every admin page and every
 * admin server action calls this — the middleware already turns away
 * pharmacists at /admin, but a server action is reachable by POST without
 * ever loading a page, so it can't be the only check.
 *
 * A signed-in pharmacist is sent to their dashboard rather than /login:
 * they are authenticated, just not staff, and bouncing them to a login
 * form they're already past would read as a broken app.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const authUser = await readAuthUser();
  if (!authUser) redirect(LOGIN_PATH);
  const admin = toAdminUser(authUser);
  if (admin) return admin;

  redirect(homeForSignedInUser(authUser));
}

/** Where to send someone right after they sign in. */
export async function landingPathForCurrentUser(): Promise<string> {
  const admin = await getAdminUser();
  return admin ? DEFAULT_ADMIN_PATH : DEFAULT_AUTHENTICATED_PATH;
}
