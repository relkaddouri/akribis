"use client";

import { SectionTitle, TextAreaField } from "./field";
import type { StepProps } from "./types";

/** PRD 5.1 — informations descriptives, celles qui s'affichent au comptoir. */
export function StepDescriptive({ state, onChange }: StepProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextAreaField
        id="description"
        label="Description"
        value={state.description}
        onChange={(value) => onChange("description", value)}
      />
      <TextAreaField
        id="indications"
        label="Indications"
        value={state.indications}
        placeholder="Douleurs légères à modérées, états fébriles..."
        onChange={(value) => onChange("indications", value)}
      />
      <TextAreaField
        id="excipients"
        label="Excipients"
        rows={2}
        hint="Utile pour les allergies et les intolérances"
        value={state.excipients}
        onChange={(value) => onChange("excipients", value)}
      />

      <SectionTitle>Posologie</SectionTitle>

      <TextAreaField
        id="posologieAdulte"
        label="Posologie adulte"
        rows={2}
        value={state.posologieAdulte}
        onChange={(value) => onChange("posologieAdulte", value)}
      />
      <TextAreaField
        id="posologieEnfant"
        label="Posologie enfant"
        rows={2}
        value={state.posologieEnfant}
        onChange={(value) => onChange("posologieEnfant", value)}
      />

      <SectionTitle>Contre-indications</SectionTitle>

      {/* Trois champs distincts, comme le demande le PRD : une contre-indication
          à la conduite ne se déduit pas d'une contre-indication à la grossesse. */}
      <TextAreaField
        id="contreIndicationGrossesse"
        label="Grossesse"
        rows={2}
        value={state.contreIndicationGrossesse}
        onChange={(value) => onChange("contreIndicationGrossesse", value)}
      />
      <TextAreaField
        id="contreIndicationAllaitement"
        label="Allaitement"
        rows={2}
        value={state.contreIndicationAllaitement}
        onChange={(value) => onChange("contreIndicationAllaitement", value)}
      />
      <TextAreaField
        id="contreIndicationConduite"
        label="Conduite de véhicules"
        rows={2}
        value={state.contreIndicationConduite}
        onChange={(value) => onChange("contreIndicationConduite", value)}
      />

      <SectionTitle>Monographie</SectionTitle>

      <TextAreaField
        id="monographie"
        label="Monographie"
        rows={6}
        value={state.monographie}
        onChange={(value) => onChange("monographie", value)}
      />
    </div>
  );
}
