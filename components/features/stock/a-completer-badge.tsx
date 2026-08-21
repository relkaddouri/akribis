import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * L'orange « À compléter » : un champ vide qui coûte quelque chose.
 *
 * Partagé par la TVA manquante d'un produit remboursable et par le prix
 * de vente resté à zéro, pour que les deux se reconnaissent d'un coup
 * d'œil comme le même genre de trou. Les champs simplement optionnels
 * gardent leur tiret discret : si tout ce qui est vide devenait orange,
 * l'orange ne voudrait plus rien dire.
 */
export function AComplete({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-sp-sm py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200",
        "dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
        className,
      )}
    >
      <TriangleAlert className="size-3.5" strokeWidth={2} aria-hidden />
      À compléter
    </span>
  );
}
