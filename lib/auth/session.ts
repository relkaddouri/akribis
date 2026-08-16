import "server-only";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
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
  const user = await readAuthUser();
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

/** For Server Components/Actions: redirects to /login if not signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_PATH);
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
  const user = await readAuthUser();
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
  const admin = await getAdminUser();
  if (admin) return admin;

  const pharmacyUser = await getSessionUser();
  redirect(pharmacyUser ? DEFAULT_AUTHENTICATED_PATH : LOGIN_PATH);
}

/** Where to send someone right after they sign in. */
export async function landingPathForCurrentUser(): Promise<string> {
  const admin = await getAdminUser();
  return admin ? DEFAULT_ADMIN_PATH : DEFAULT_AUTHENTICATED_PATH;
}
