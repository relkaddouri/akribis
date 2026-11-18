"use client";

import { Banknote } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * La saisie d'un montant en espèces, à la caisse.
 *
 * Grand, cadré à droite, avec des coupures en accès direct : on la remplit
 * debout, souvent d'une main, l'autre tenant les billets. Les montants
 * proposés sont ceux d'un fond de caisse d'officine — on en choisit un
 * neuf fois sur dix, et le clavier ne sert que pour le reste.
 */
export function MontantInput({
  id,
  valeur,
  onChange,
  raccourcis,
  autoFocus = false,
}: {
  id: string;
  valeur: string;
  onChange: (valeur: string) => void;
  /** Coupures proposées. Vide = pas de raccourcis (comptage à l'aveugle). */
  raccourcis?: number[];
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-sp-sm">
      <div className="relative">
        <Banknote
          className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          id={id}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          autoFocus={autoFocus}
          value={valeur}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0,00"
          className={cn(
            "h-20 w-full rounded-xl bg-muted/60 pl-14 pr-20 text-right",
            "font-heading text-4xl font-extrabold tabular-nums text-foreground",
            "outline-none transition-colors placeholder:text-muted-foreground/50",
            "focus:bg-muted focus:ring-2 focus:ring-ring",
          )}
        />
        <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 font-heading text-lg font-bold text-muted-foreground">
          MAD
        </span>
      </div>

      {raccourcis && raccourcis.length > 0 && (
        <div className="flex flex-wrap gap-sp-xs">
          {raccourcis.map((montant) => (
            <Button
              key={montant}
              type="button"
              variant={valeur === String(montant) ? "secondary" : "outline"}
              size="sm"
              className="tabular-nums"
              onClick={() => onChange(String(montant))}
            >
              {montant.toLocaleString("fr-FR")}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
