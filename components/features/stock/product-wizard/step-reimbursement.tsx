"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { WizardState } from "./types";

export function StepReimbursement({
  state,
  errors,
  onChange,
}: {
  state: WizardState;
  errors: Record<string, string>;
  onChange: <K extends keyof WizardState>(field: K, value: WizardState[K]) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">Produit remboursable</p>
          <p className="text-sm text-muted-foreground">Active la base de remboursement ci-dessous.</p>
        </div>
        <Switch
          checked={state.remboursable}
          onCheckedChange={(checked) => onChange("remboursable", checked === true)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseRemboursement" className={cn(!state.remboursable && "text-muted-foreground")}>
          Base de remboursement
        </Label>
        <Input
          id="baseRemboursement"
          type="number"
          min={0}
          step="0.01"
          value={state.baseRemboursement}
          onChange={(e) => onChange("baseRemboursement", e.target.value)}
          disabled={!state.remboursable}
        />
        {errors.baseRemboursement && <p className="text-sm text-destructive">{errors.baseRemboursement}</p>}
      </div>
    </div>
  );
}
