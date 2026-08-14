import type { OrderStatus } from "@/lib/db/generated/enums";
import { cn } from "@/lib/utils";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  BROUILLON: "Brouillon",
  ENVOYEE: "Envoyée",
  PARTIELLEMENT_RECUE: "Partiellement reçue",
  RECUE: "Reçue",
  CLOTUREE: "Clôturée",
};

/**
 * Colour tracks how far along the order is, so the list reads at a glance:
 * grey while it hasn't left, blue once it's with the supplier, orange when
 * goods are still outstanding, green when complete, dark grey once closed.
 *
 * Written as explicit tints rather than Badge variants — the palette here
 * is a progression, which the semantic variants (default/secondary/
 * destructive) can't express.
 */
const STATUS_STYLES: Record<OrderStatus, string> = {
  BROUILLON: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  ENVOYEE: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  PARTIELLEMENT_RECUE: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  RECUE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  CLOTUREE: "bg-gray-700 text-gray-100 dark:bg-gray-950 dark:text-gray-300",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-4xl px-sp-sm py-sp-xs text-xs font-medium whitespace-nowrap",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
