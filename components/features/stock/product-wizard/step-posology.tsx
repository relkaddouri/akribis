"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WizardState } from "./types";

export function StepPosology({
  state,
  onChange,
}: {
  state: WizardState;
  errors: Record<string, string>;
  onChange: <K extends keyof WizardState>(field: K, value: WizardState[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="posologieEnfant">Posologie enfant</Label>
          <Input
            id="posologieEnfant"
            value={state.posologieEnfant}
            onChange={(e) => onChange("posologieEnfant", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="posologieAdulte">Posologie adulte</Label>
          <Input
            id="posologieAdulte"
            value={state.posologieAdulte}
            onChange={(e) => onChange("posologieAdulte", e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="monographie">Monographie</Label>
        <Textarea
          id="monographie"
          rows={8}
          value={state.monographie}
          onChange={(e) => onChange("monographie", e.target.value)}
        />
      </div>
    </div>
  );
}
