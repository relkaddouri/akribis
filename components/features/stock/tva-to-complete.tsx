"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { setProductTva } from "@/lib/server/stock-entry";
import { suggestedTva, suggestedTvaReason, type TvaField } from "@/lib/stock/tva";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A TVA that is missing on a reimbursable product — shown as a gap to close,
 * not as an em dash.
 *
 * The difference matters: an absent laboratoire is information nobody has,
 * while an absent TVA on a reimbursable product silently skews what gets
 * billed to the insurer. So this one gets an orange badge and a one-click
 * fix, and the merely optional fields keep their quiet dash.
 *
 * The suggestion is applied on click, never pre-filled: 7 % and 20 % are the
 * usual Moroccan rates, not a fact about this particular product.
 */
export function TvaToComplete({
  productId,
  field,
  categorie,
}: {
  productId: string;
  field: TvaField;
  categorie: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const taux = suggestedTva(categorie);
  const raison = suggestedTvaReason(categorie);
  const libelle = field === "tvaVente" ? "TVA vente" : "TVA achat";

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await setProductTva(productId, field, taux);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-sp-sm">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-sp-sm py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
            <TriangleAlert className="size-3.5" strokeWidth={2} aria-hidden />
            À compléter
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Ce produit est remboursable : sans {libelle.toLowerCase()}, la part assurance sera
          calculée de travers.
        </TooltipContent>
      </Tooltip>

      <Button size="sm" variant="outline" disabled={pending} onClick={apply}>
        {pending && <Loader2 className="animate-spin" />}
        Appliquer {taux} %
      </Button>

      <span className="text-xs text-muted-foreground">{raison}</span>

      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
