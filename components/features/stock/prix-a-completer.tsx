"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setProductPrix } from "@/lib/server/stock-entry";
import { prixSuggere } from "@/lib/stock/prix";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AComplete } from "@/components/features/stock/a-completer-badge";

/**
 * Un prix de vente resté à zéro — réclamé, pas affiché comme « 0,00 DH ».
 *
 * « 0,00 DH » se lit comme un prix. C'en est un, techniquement : le produit
 * passe en caisse et rapporte zéro dirham, à chaque vente, sans que rien
 * n'attire l'œil. C'est ce qui est arrivé à toute la parapharmacie, dont
 * les fiches n'ont pas de PPV.
 *
 * La suggestion s'applique au clic, jamais d'avance : le prix indicatif du
 * catalogue est une indication, le prix de vente est une décision de
 * l'officine.
 */
export function PrixACompleter({
  productId,
  ppv,
  prixVenteIndicatif,
}: {
  productId: string;
  ppv: number | null;
  prixVenteIndicatif: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const suggestion = prixSuggere({ ppv, prixVenteIndicatif });

  function apply(montant: number) {
    setError(null);
    startTransition(async () => {
      const result = await setProductPrix(productId, montant);
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
          <span>
            <AComplete />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Sans prix de vente, ce produit passe en caisse à 0,00 DH — vendu, mais gratuitement.
        </TooltipContent>
      </Tooltip>

      {suggestion && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => apply(suggestion.montant)}
          >
            {pending && <Loader2 className="animate-spin" />}
            Appliquer{" "}
            {suggestion.montant.toLocaleString("fr-MA", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            DH
          </Button>
          <span className="text-xs text-muted-foreground">{suggestion.origine}</span>
        </>
      )}

      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
