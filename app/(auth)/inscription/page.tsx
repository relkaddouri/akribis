import Link from "next/link";
import { SignUpForm } from "@/components/features/auth/signup-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignUpPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Créer votre pharmacie sur Akribis</CardTitle>
          <CardDescription>
            Ce compte sera le titulaire (owner) de la pharmacie créée.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground text-sm">
            Déjà un compte ?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Se connecter
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
