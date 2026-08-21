import { cn } from "@/lib/utils";
import type { StatutCreanceValue } from "@/lib/server/sales-returns";

/**
 * L'état d'une créance de tiers payant, en pastille.
 *
 * `AUCUNE` ne s'affiche pas : c'est la vente ordinaire, la grande
 * majorité des lignes. Une pastille « aucune créance » sur chacune ferait
 * du bruit là où la colonne existe précisément pour repérer l'exception.
 */

export const STATUTS_CREANCE = [
  "EN_ATTENTE_BORDEREAU",
  "DANS_BORDEREAU",
  "ACCEPTEE",
  "REJETEE",
  "PAYEE",
] as const;

export const LIBELLES_CREANCE: Record<StatutCreanceValue, string> = {
  AUCUNE: "Aucune créance",
  EN_ATTENTE_BORDEREAU: "À mettre en bordereau",
  DANS_BORDEREAU: "Dans un bordereau",
  ACCEPTEE: "Acceptée",
  REJETEE: "Rejetée",
  PAYEE: "Payée",
};

/**
 * L'ambre pour ce qui attend un geste de l'officine, l'ardoise pour ce qui
 * est parti et attend une réponse, le rouge pour un rejet — de l'argent
 * qu'il faut aller rechercher — et l'émeraude pour ce qui est encaissé.
 */
const TONS: Record<string, string> = {
  EN_ATTENTE_BORDEREAU:
    "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  DANS_BORDEREAU:
    "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  ACCEPTEE:
    "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900",
  REJETEE:
    "bg-red-100 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
  PAYEE:
    "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
};

export function StatutCreanceBadge({
  statut,
  className,
}: {
  statut: StatutCreanceValue;
  className?: string;
}) {
  if (statut === "AUCUNE") return null;

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONS[statut] ?? TONS.DANS_BORDEREAU,
        className,
      )}
    >
      {LIBELLES_CREANCE[statut]}
    </span>
  );
}
