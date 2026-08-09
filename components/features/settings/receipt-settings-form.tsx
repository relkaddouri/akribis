"use client";

import { useActionState, useState } from "react";
import { updateReceiptSettingsAction, type ActionState } from "@/lib/server/pharmacy";
import type { ReceiptSettings } from "@/lib/validations/pharmacy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

export function ReceiptSettingsForm({ settings }: { settings: ReceiptSettings }) {
  const [state, formAction, pending] = useActionState(updateReceiptSettingsAction, initialState);
  const [showLogo, setShowLogo] = useState(settings.showLogo);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="showLogo" value={showLogo ? "on" : "off"} />

      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">Afficher le logo sur le ticket</p>
          <p className="text-sm text-muted-foreground">
            Nécessite qu&apos;un logo ait été téléversé dans l&apos;onglet Informations.
          </p>
        </div>
        <Switch checked={showLogo} onCheckedChange={setShowLogo} aria-label="Afficher le logo" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="legalNotice">Mentions légales</Label>
        <Textarea
          id="legalNotice"
          name="legalNotice"
          placeholder="Ex : TVA non applicable, article..."
          defaultValue={settings.legalNotice ?? ""}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="thankYouMessage">Message de remerciement</Label>
        <Textarea
          id="thankYouMessage"
          name="thankYouMessage"
          placeholder="Ex : Merci de votre visite, prompt rétablissement !"
          defaultValue={settings.thankYouMessage ?? ""}
          rows={2}
        />
      </div>

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && (
        <Alert>
          <AlertDescription>Paramétrage du ticket enregistré.</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Enregistrement..." : "Enregistrer"}
      </Button>
    </form>
  );
}
