import { FlaskConical, HeartPulse, Stethoscope, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProduitCategorieValue } from "@/lib/validations/catalogue";

/**
 * La catégorie PRD d'une fiche, en pastille colorée.
 *
 * Une couleur par famille, parce que c'est ce qu'on balaie dans une liste
 * de 5 918 lignes : le mot met une demi-seconde à lire, la teinte se
 * reconnaît sans lecture. Et parce que cette catégorie n'est pas
 * décorative — c'est elle qui détermine le taux de TVA.
 *
 * Le choix des teintes n'est pas libre : l'émeraude est la couleur de
 * marque (statut actif, succès) et l'ambre signale déjà « à compléter »
 * partout ailleurs. Les trois familles prennent donc bleu / violet /
 * ardoise, distinctes de ces deux-là comme entre elles.
 *
 * Chaque variante porte sa déclinaison sombre, selon le motif déjà employé
 * dans le projet (`bg-X-100 text-X-700` / `dark:bg-X-950 dark:text-X-300`).
 */

const STYLES: Record<
  ProduitCategorieValue,
  { label: string; icon: typeof FlaskConical; className: string }
> = {
  PHARMACEUTIQUE: {
    label: "Pharmaceutique",
    icon: FlaskConical,
    className:
      "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900",
  },
  PARAPHARMACEUTIQUE: {
    label: "Parapharmaceutique",
    icon: HeartPulse,
    className:
      "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900",
  },
  DISPOSITIF_MEDICAL: {
    label: "Dispositif médical",
    icon: Stethoscope,
    className:
      "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  },
};

/** Une fiche sans catégorie : le taux de TVA n'en découle pas encore. */
const A_CLASSER = {
  label: "À classer",
  icon: TriangleAlert,
  className:
    "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
};

export function CategorieBadge({
  categorie,
  /** Sans le libellé : pour une colonne étroite où l'icône suffit. */
  iconOnly = false,
  className,
}: {
  categorie: string | null | undefined;
  iconOnly?: boolean;
  className?: string;
}) {
  const style = categorie ? STYLES[categorie as ProduitCategorieValue] : undefined;
  // Une valeur inconnue (enum élargi côté base, client pas encore à jour)
  // retombe sur « À classer » plutôt que de casser la ligne.
  const { label, icon: Icon, className: tone } = style ?? A_CLASSER;

  return (
    <span
      title={iconOnly ? label : undefined}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tone,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}
