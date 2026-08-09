"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardState } from "./types";

export function StepPricing({
  state,
  errors,
  onChange,
}: {
  state: WizardState;
  errors: Record<string, string>;
  onChange: <K extends keyof WizardState>(field: K, value: WizardState[K]) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="price">Prix de vente</Label>
        <Input
          id="price"
          type="number"
          min={0}
          step="0.01"
          value={state.price}
          onChange={(e) => onChange("price", e.target.value)}
          required
        />
        {errors.price && <p className="text-sm text-destructive">{errors.price}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="pph">PPH (Prix Public Hospitalier)</Label>
        <Input
          id="pph"
          type="number"
          min={0}
          step="0.01"
          value={state.pph}
          onChange={(e) => onChange("pph", e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tvaVente">TVA vente (%)</Label>
        <Input
          id="tvaVente"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={state.tvaVente}
          onChange={(e) => onChange("tvaVente", e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tvaAchat">TVA achat (%)</Label>
        <Input
          id="tvaAchat"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={state.tvaAchat}
          onChange={(e) => onChange("tvaAchat", e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="quantityInStock">Quantité en stock</Label>
        <Input
          id="quantityInStock"
          type="number"
          min={0}
          value={state.quantityInStock}
          onChange={(e) => onChange("quantityInStock", e.target.value)}
          required
        />
        {errors.quantityInStock && <p className="text-sm text-destructive">{errors.quantityInStock}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="lowStockThreshold">Seuil d&apos;alerte stock bas</Label>
        <Input
          id="lowStockThreshold"
          type="number"
          min={0}
          value={state.lowStockThreshold}
          onChange={(e) => onChange("lowStockThreshold", e.target.value)}
          required
        />
        {errors.lowStockThreshold && <p className="text-sm text-destructive">{errors.lowStockThreshold}</p>}
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="nearestExpiryDate">Date de péremption la plus proche</Label>
        <Input
          id="nearestExpiryDate"
          type="date"
          value={state.nearestExpiryDate}
          onChange={(e) => onChange("nearestExpiryDate", e.target.value)}
        />
      </div>
    </div>
  );
}
