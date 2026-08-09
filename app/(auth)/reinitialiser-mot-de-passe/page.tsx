import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isResetLinkInvalid } from "@/lib/auth/password-reset";
import { ResetPasswordForm } from "@/components/features/auth/reset-password-form";
import { AuthShell } from "@/components/features/auth/auth-shell";
import { Button } from "@/components/ui/button";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // getUser() re-verifies against Supabase rather than trusting the
  // cookie alone — appropriate here since this page is about to let the
  // visitor set a new password, unlike general navigation elsewhere in
  // the app which tolerates a stale-but-cached session during a network
  // blip (see lib/auth/session.ts).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const invalid = isResetLinkInvalid({ error, hasSession: !!user });

  return (
    <AuthShell
      title="Réinitialiser le mot de passe"
      subtitle={invalid ? "Ce lien n'est plus valide" : "Choisissez un nouveau mot de passe"}
    >
      {invalid ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-destructive/10 px-4 py-6 text-center">
            <AlertTriangle className="size-8 text-destructive" strokeWidth={1.5} />
            <p className="text-sm text-foreground">
              Ce lien a expiré ou n&apos;est plus valide. Demandez-en un nouveau pour continuer.
            </p>
          </div>
          <Button asChild className="w-full">
            <Link href="/mot-de-passe-oublie">Demander un nouveau lien</Link>
          </Button>
        </div>
      ) : (
        <ResetPasswordForm />
      )}
    </AuthShell>
  );
}
