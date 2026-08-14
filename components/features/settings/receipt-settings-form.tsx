"use client";

import { useActionState, useState } from "react";
import { updateReceiptSettingsAction, type ActionState } from "@/lib/server/pharmacy";
import type { PharmacySettings } from "@/lib/server/pharmacy";
import type { ReceiptSettings } from "@/lib/validations/pharmacy";
import type { Receipt } from "@/lib/server/sales";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReceiptDocument } from "@/components/features/pos/receipt-document";

const initialState: ActionState = {};

/** Stand-in sale, so the preview shows a plausible ticket rather than an empty shell. */
const SAMPLE_RECEIPT: Receipt = {
  id: "preview",
  createdAt: new Date("2026-08-10T14:32:00"),
  paymentMethod: "CASH",
  totalAmount: 78.5,
  clientName: "Fatima Zahra",
  items: [
    { productId: "1", productName: "Doliprane 500mg", quantity: 3, unitPrice: 15.5, lineTotal: 46.5 },
    { productId: "2", productName: "Amoxicilline 500mg", quantity: 1, unitPrice: 32, lineTotal: 32 },
  ],
  priceDrifts: [],
};

export function ReceiptSettingsForm({
  settings,
  pharmacy,
}: {
  settings: ReceiptSettings;
  pharmacy: PharmacySettings;
}) {
  const [state, formAction, pending] = useActionState(updateReceiptSettingsAction, initialState);

  // Controlled rather than defaultValue: the preview beside the form has to
  // track what's being typed, not the last saved value.
  const [showLogo, setShowLogo] = useState(settings.showLogo);
  const [legalNotice, setLegalNotice] = useState(settings.legalNotice ?? "");
  const [thankYouMessage, setThankYouMessage] = useState(settings.thankYouMessage ?? "");

  return (
    <div className="grid gap-sp-lg lg:grid-cols-[1fr_auto]">
      <form action={formAction} className="space-y-sp-lg">
        <input type="hidden" name="showLogo" value={showLogo ? "on" : "off"} />

        <div className="flex items-center justify-between gap-sp-md rounded-lg bg-muted/50 px-sp-md py-sp-sm">
          <div>
            <p className="text-sm font-medium">Afficher le logo sur le ticket</p>
            <p className="text-sm text-muted-foreground">
              Nécessite qu&apos;un logo ait été téléversé dans l&apos;onglet Informations.
            </p>
          </div>
          <Switch checked={showLogo} onCheckedChange={setShowLogo} aria-label="Afficher le logo" />
        </div>

        <div className="space-y-sp-sm">
          <Label htmlFor="legalNotice">Mentions légales</Label>
          <Textarea
            id="legalNotice"
            name="legalNotice"
            placeholder="Ex : TVA non applicable, article..."
            value={legalNotice}
            onChange={(event) => setLegalNotice(event.target.value)}
            rows={3}
          />
        </div>

        <div className="space-y-sp-sm">
          <Label htmlFor="thankYouMessage">Message de remerciement</Label>
          <Textarea
            id="thankYouMessage"
            name="thankYouMessage"
            placeholder="Ex : Merci de votre visite, prompt rétablissement !"
            value={thankYouMessage}
            onChange={(event) => setThankYouMessage(event.target.value)}
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

      <aside className="space-y-sp-sm">
        <div>
          <p className="text-sm font-medium text-foreground">Aperçu du ticket</p>
          <p className="text-xs text-muted-foreground">
            Rendu réel, mis à jour pendant la saisie. Données de vente fictives.
          </p>
        </div>
        {/* Renders the very same component the till prints, so what the
            pharmacist validates here is what comes out of the printer.
            Hidden from print: the wrapper's `display: none` also takes the
            nested `data-print-area` out, so printing the settings page
            can't emit this sample ticket. */}
        <div className="[&_[data-print-area]]:shadow-soft print:hidden">
          <ReceiptDocument
            receipt={SAMPLE_RECEIPT}
            branding={{
              pharmacyName: pharmacy.name,
              address: pharmacy.address,
              phone: pharmacy.phone,
              ice: pharmacy.ice,
              logoUrl: pharmacy.logoUrl,
              showLogo,
              legalNotice: legalNotice.trim() || null,
              thankYouMessage: thankYouMessage.trim() || null,
            }}
          />
        </div>
      </aside>
    </div>
  );
}
