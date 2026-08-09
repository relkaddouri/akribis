import Link from "next/link";
import { LoginForm } from "@/components/features/auth/login-form";
import { AuthShell } from "@/components/features/auth/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;

  return (
    <AuthShell title="Bon retour" subtitle="Connectez-vous pour accéder à votre pharmacie">
      {reset === "success" && (
        <Alert>
          <AlertDescription>
            Mot de passe réinitialisé avec succès. Connectez-vous avec votre nouveau mot de passe.
          </AlertDescription>
        </Alert>
      )}

      <LoginForm />

      <p className="text-center text-sm text-muted-foreground">
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="font-medium text-primary hover:underline">
          Créer un compte
        </Link>
      </p>

      <div className="border-t border-border/60 pt-6 text-center text-sm text-muted-foreground">
        Besoin d&apos;aide ?{" "}
        <a href="mailto:contact@akribis.ma" className="text-primary hover:underline">
          Contactez le support
        </a>
      </div>
    </AuthShell>
  );
}
