import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (error) {
    /**
     * An unhandled throw here fails the whole request with
     * MIDDLEWARE_INVOCATION_FAILED — a blank 500 on every page, with no
     * indication of what broke. Whatever goes wrong, one refresh of a
     * session cookie is not worth taking the entire application down.
     *
     * The request is allowed through rather than blocked: every protected
     * page independently calls `requireUser()` (and `requireOwner()` for
     * owner-only ones), so authentication is still enforced one layer
     * down. Redirecting everything to an error page instead would turn a
     * transient Supabase hiccup into a total outage — the opposite of
     * what this catch is for.
     *
     * `await` above matters: without it the promise escapes the try and
     * the catch never fires.
     */
    console.error(
      `[middleware] Échec inattendu sur ${request.nextUrl.pathname} — requête laissée passer, ` +
        "les gardes de page prennent le relais.",
      error,
    );
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets, so the Supabase session
     * cookie stays fresh across navigations, while skipping files that
     * never need auth checks.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
