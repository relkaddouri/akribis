import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SALE_RETURN_STATUS_LABELS,
  type SaleReturnStatusValue,
} from "@/lib/sales/returns";

/**
 * The at-a-glance marker on a sales row. A returned sale has to stand out
 * without opening it, so partial and total returns get distinct colours
 * rather than sharing one generic "returned" chip.
 */
const STYLES: Record<SaleReturnStatusValue, string> = {
  none: "bg-muted text-muted-foreground",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  full: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function SaleReturnBadge({ status }: { status: SaleReturnStatusValue }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-sp-xs rounded-4xl px-sp-sm py-sp-xs text-xs font-medium whitespace-nowrap",
        STYLES[status],
      )}
    >
      {status !== "none" && <RotateCcw className="size-3" strokeWidth={2} aria-hidden />}
      {SALE_RETURN_STATUS_LABELS[status]}
    </span>
  );
}
