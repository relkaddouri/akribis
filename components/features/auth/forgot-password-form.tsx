"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { forgotPasswordAction, type ActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);

  if (state.success) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-emerald-50 px-4 py-6 text-center">
        <CheckCircle2 className="size-8 text-primary" strokeWidth={1.5} />
        <p className="text-sm text-foreground">
          Si un compte existe avec cet e-mail, vous recevrez un lien de réinitialisation.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Envoi..." : "Envoyer le lien de réinitialisation"}
      </Button>
    </form>
  );
}
