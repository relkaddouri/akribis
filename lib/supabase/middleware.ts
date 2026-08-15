import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionRoleFromUser } from "@/lib/auth/roles";
import { CONFIG_ERROR_PATH, resolveAuthRedirect } from "@/lib/auth/access-control";

/**
 * Environment variables the middleware cannot work without.
 *
 * `NEXT_PUBLIC_*` values are inlined into the bundle at build time, so a
 * missing one is not something the running server can recover from — it is
 * baked in as `undefined`, and `createServerClient` throws on every single
 * request. That surfaced as MIDDLEWARE_INVOCATION_FAILED on every page,
 * with no clue as to which variable was at fault.
 */
export function missingSupabaseConfig(env: {
  url: string | undefined;
  anonKey: string | undefined;
}): string[] {
  const missing: string[] = [];
  // Empty strings count: a variable set to "" in a dashboard is a far more
  // common mistake than one that is genuinely absent.
  if (!env.url?.trim()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.anonKey?.trim()) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return missing;
}

/**
 * Refreshes the Supabase session cookies on every request and redirects
 * unauthenticated/unauthorized visitors away from protected routes.
 * Must run in middleware (not just layouts) so pages can't be reached
 * before the redirect happens.
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing = missingSupabaseConfig({ url, anonKey });
  if (missing.length > 0) {
    // Already on the error page: letting it through, or the redirect below
    // would bounce the page against itself for ever.
    if (request.nextUrl.pathname.startsWith(CONFIG_ERROR_PATH)) {
      return NextResponse.next({ request });
    }
    console.error(
      `[middleware] Configuration incomplète — variable(s) manquante(s) : ${missing.join(", ")}. ` +
        "Les variables NEXT_PUBLIC_* sont figées au build : redéployez après les avoir ajoutées.",
    );
    const configErrorUrl = request.nextUrl.clone();
    configErrorUrl.pathname = CONFIG_ERROR_PATH;
    configErrorUrl.search = "";
    return NextResponse.redirect(configErrorUrl);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    url!,
    anonKey!,
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
