import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionRoleFromUser } from "@/lib/auth/roles";
import { resolveAuthRedirect } from "@/lib/auth/access-control";

/**
 * Refreshes the Supabase session cookies on every request and redirects
 * unauthenticated/unauthorized visitors away from protected routes.
 * Must run in middleware (not just layouts) so pages can't be reached
 * before the redirect happens.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user: verifiedUser },
    error: getUserError,
  } = await supabase.auth.getUser();

  let user = verifiedUser;
  if (!user && getUserError && isAuthRetryableFetchError(getUserError)) {
    // getUser() couldn't reach Supabase to re-verify the session — that's
    // a connectivity problem, not proof the visitor is logged out.
    // Falling back to the locally cached session (from the cookie, not
    // re-verified) keeps them in the app instead of bouncing them to
    // /login every time the network blips, which would defeat the
    // offline-first data layer. If the access token has actually
    // expired, getSession() can't refresh it without network either, so
    // this correctly falls through to "not authenticated" below.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    user = session?.user ?? null;
  }

  const redirectPath = resolveAuthRedirect({
    pathname: request.nextUrl.pathname,
    isAuthenticated: !!user,
    role: getSessionRoleFromUser(user),
  });

  if (redirectPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = redirectPath;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
