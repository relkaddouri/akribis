import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatVariation, type Variation } from "@/lib/dashboard/periods";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function VariationBadge({
  variation,
  comparisonLabel,
}: {
  variation: Variation;
  comparisonLabel: string;
}) {
  const formatted = formatVariation(variation);
  const Icon =
    variation.direction === "up" ? ArrowUpRight : variation.direction === "down" ? ArrowDownRight : ArrowRight;

  return (
    <p className="mt-sp-sm flex flex-wrap items-center gap-sp-xs text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-sp-xs rounded-4xl px-sp-sm py-sp-xs font-medium",
          variation.direction === "up" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
          variation.direction === "down" && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
          variation.direction === "flat" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3" strokeWidth={2} aria-hidden />
        {/* No percentage when the previous period was zero: there's no
            baseline to divide by, so any number would be invented. */}
        {formatted ?? "Nouveau"}
      </span>
      <span className="text-muted-foreground">{comparisonLabel}</span>
    </p>
  );
}

export function StatCard({
  label,
  value,
  hint,
  variation,
  comparisonLabel = "vs période précédente",
}: {
  label: string;
  value: string;
  hint?: string;
  /** Omitted for point-in-time metrics, which have no previous-period equivalent. */
  variation?: Variation;
  comparisonLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-normal">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value}</p>
        {variation && <VariationBadge variation={variation} comparisonLabel={comparisonLabel} />}
        {hint && <p className="text-muted-foreground mt-sp-xs text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}
