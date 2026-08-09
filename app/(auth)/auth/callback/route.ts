import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for Supabase email links (invite, magic link, password
 * reset): exchanges the one-time `code` for a session cookie, then sends
 * the user on to `next` (defaults to the dashboard).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // Expired/already-used/invalid code: send the visitor on to `next`
    // anyway (rather than a bare /login) with an error flag, so pages
    // like /reinitialiser-mot-de-passe can show a specific "this link
    // expired" message instead of a silent bounce.
    return NextResponse.redirect(`${origin}${next}?error=invalid_link`);
  }

  return NextResponse.redirect(`${origin}/login`);
}
