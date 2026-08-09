import "server-only";
import { redirect } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getPharmacyIdFromUser, getSessionRoleFromUser, type Role } from "@/lib/auth/roles";
import { LOGIN_PATH, DEFAULT_AUTHENTICATED_PATH } from "@/lib/auth/access-control";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  pharmacyId: string;
};

/**
 * Reads the current session from Supabase Auth. Returns null when no one
 * is signed in, or when a signed-in account is missing role/pharmacy
 * claims (e.g. mid-invite, before an admin finished provisioning it).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user: verifiedUser },
    error: getUserError,
  } = await supabase.auth.getUser();

  let user = verifiedUser;
  if (!user && getUserError && isAuthRetryableFetchError(getUserError)) {
    // Same reasoning as lib/supabase/middleware.ts: a network failure
    // reaching Supabase isn't proof the user logged out, so fall back to
    // the session cached in cookies rather than kicking them to /login.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    user = session?.user ?? null;
  }

  if (!user) return null;

  const role = getSessionRoleFromUser(user);
  const pharmacyId = getPharmacyIdFromUser(user);
  if (!role || !pharmacyId) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    name: typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null,
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
