"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { SectionTitle, SwitchField, TextField } from "./field";
import type { StepProps } from "./types";

/** PRD 5.1 — prix et fiscalité. Ces valeurs sont nationales : une pharmacie ne les modifie pas. */
export function StepPricing({ state, errors, onChange }: StepProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Alert className="sm:col-span-2">
        <AlertDescription>
          Ces prix sont réglementés et s&apos;appliquent à toutes les pharmacies. Le prix
          d&apos;achat réellement facturé, lui, reste propre à chaque officine.
        </AlertDescription>
      </Alert>

      <TextField
        id="ppv"
        label="PPV"
        value={state.ppv}
        error={errors.ppv}
        inputMode="decimal"
        hint="Prix public de vente, en dirhams"
        onChange={(value) => onChange("ppv", value)}
      />
      <TextField
        id="pph"
        label="PPH"
        value={state.pph}
        error={errors.pph}
        inputMode="decimal"
        hint="Prix pharmacien, en dirhams"
        onChange={(value) => onChange("pph", value)}
      />
      <TextField
        id="tvaVente"
        label="TVA vente (%)"
        value={state.tvaVente}
        error={errors.tvaVente}
        inputMode="decimal"
        onChange={(value) => onChange("tvaVente", value)}
      />
      <TextField
        id="tvaAchat"
        label="TVA achat (%)"
        value={state.tvaAchat}
        error={errors.tvaAchat}
        inputMode="decimal"
        onChange={(value) => onChange("tvaAchat", value)}
      />

      <SectionTitle>Remboursement</SectionTitle>

      <SwitchField
        label="Produit remboursable"
        description="Pris en charge par l'assurance maladie."
        checked={state.remboursable}
        onChange={(checked) => onChange("remboursable", checked)}
      />

      {/* Hidden rather than disabled when not reimbursable: two fields that
          only ever apply to a reimbursed product would otherwise sit there
          inviting entries nothing would use. */}
      {state.remboursable && (
        <>
          <TextField
            id="tauxRemboursement"
            label="Taux de remboursement (%)"
            value={state.tauxRemboursement}
            error={errors.tauxRemboursement}
            inputMode="decimal"
            hint="70 ou 0 dans le référentiel CNOPS"
            onChange={(value) => onChange("tauxRemboursement", value)}
          />
          <TextField
            id="prixBaseRemboursement"
            label="Prix base de remboursement"
            value={state.prixBaseRemboursement}
            error={errors.prixBaseRemboursement}
            inputMode="decimal"
            hint="Un montant en dirhams, pas un pourcentage"
            onChange={(value) => onChange("prixBaseRemboursement", value)}
          />
        </>
      )}
    </div>
  );
}
