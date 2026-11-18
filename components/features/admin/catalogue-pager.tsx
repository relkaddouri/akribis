import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_CATALOGUE_PATH } from "@/lib/auth/access-control";
import type { CatalogueNeighbour } from "@/lib/server/catalogue";

/**
 * Previous / next fiche, in the catalogue's own alphabetical order — the
 * same order as the list, so "suivant" is the row that was underneath.
 *
 * At either end the button stays visible but disabled rather than
 * disappearing: a control that vanishes moves the one next to it, and the
 * admin ends up clicking the wrong one.
 */
export function CataloguePager({
  precedent,
  suivant,
}: {
  precedent: CatalogueNeighbour | null;
  suivant: CatalogueNeighbour | null;
}) {
  return (
    <div className="flex items-center gap-sp-xs">
      <PagerButton produit={precedent} direction="precedent" />
      <PagerButton produit={suivant} direction="suivant" />
    </div>
  );
}

function PagerButton({
  produit,
  direction,
}: {
  produit: CatalogueNeighbour | null;
  direction: "precedent" | "suivant";
}) {
  const isPrevious = direction === "precedent";
  const Icon = isPrevious ? ChevronLeft : ChevronRight;
  const word = isPrevious ? "Précédent" : "Suivant";

  const shell =
    "flex h-8 items-center gap-1 rounded-lg border border-input px-sp-sm text-sm font-medium transition-colors";

  if (!produit) {
    return (
      <span
        aria-disabled
        title={`Aucune fiche ${isPrevious ? "avant" : "après"} celle-ci`}
        className={cn(shell, "cursor-not-allowed text-muted-foreground/50")}
      >
        {isPrevious && <Icon className="size-4" strokeWidth={2} aria-hidden />}
        <span className="hidden sm:inline">{word}</span>
        {!isPrevious && <Icon className="size-4" strokeWidth={2} aria-hidden />}
      </span>
    );
  }

  return (
    <Link
      href={`${ADMIN_CATALOGUE_PATH}/${produit.id}`}
      // The neighbour's name in the tooltip, not on the button: fiche names
      // run to 40 characters and would resize the header on every product.
      title={`${word} — ${produit.nom}`}
      aria-label={`${word} : ${produit.nom}`}
      className={cn(shell, "text-foreground hover:bg-muted")}
    >
      {isPrevious && <Icon className="size-4" strokeWidth={2} aria-hidden />}
      <span className="hidden sm:inline">{word}</span>
      {!isPrevious && <Icon className="size-4" strokeWidth={2} aria-hidden />}
    </Link>
  );
}
