import Link from "next/link";
import { ForgotPasswordForm } from "@/components/features/auth/forgot-password-form";
import { AuthShell } from "@/components/features/auth/auth-shell";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Mot de passe oublié"
      subtitle="Entrez votre e-mail pour recevoir un lien de réinitialisation"
    >
      <ForgotPasswordForm />

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </AuthShell>
  );
}
