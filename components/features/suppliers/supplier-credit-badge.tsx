import { cn } from "@/lib/utils";
import type { SupplierCreditStatusValue } from "@/lib/suppliers/credits";

/**
 * Plain-language status. "Émis" and "Reçu" are the accounting terms; what a
 * pharmacist wants to know is whether the supplier has agreed yet.
 */
export const CREDIT_STATUS_LABELS: Record<SupplierCreditStatusValue, string> = {
  emis: "En attente",
  recu: "Confirmé",
};

const STYLES: Record<SupplierCreditStatusValue, string> = {
  emis: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  recu: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

export function SupplierCreditBadge({ statut }: { statut: SupplierCreditStatusValue }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-4xl px-sp-sm py-sp-xs text-xs font-medium whitespace-nowrap",
        STYLES[statut],
      )}
    >
      {CREDIT_STATUS_LABELS[statut]}
    </span>
  );
}
