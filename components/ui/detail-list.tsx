import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Read-only spec-sheet layout: one field per row, label in a fixed left
 * column, value in the rest.
 *
 * Replaces a two-column grid of stacked label/value pairs, which read
 * badly for three reasons: nothing told the eye whether to read across or
 * down; a long value wrapped straight into the next field with no
 * boundary; and values never lined up, so scanning for one meant reading
 * all of them. A fixed label column puts every value on the same
 * left edge, and a hairline per row gives each field an edge of its own.
 *
 * Kept in components/ui, without any catalogue vocabulary, so the supplier
 * and product sheets can move onto it later.
 */

export function DetailList({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y divide-border/60">{children}</dl>;
}

export function DetailRow({
  label,
  value,
  /** Free text that can run to several lines — line breaks are preserved. */
  prose = false,
}: {
  label: string;
  value: React.ReactNode;
  prose?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";

  return (
    <div className="grid gap-x-sp-md gap-y-0.5 py-sp-sm sm:grid-cols-[13rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0",
          // Empty fields stay in place — a pharmacist needs to see what is
          // missing — but faded, so filled data is what the eye lands on.
          empty ? "text-muted-foreground/50" : "text-foreground",
          // Cap the measure even when the card is full width: a line of
          // indications running 200 characters is unreadable however wide
          // the container is.
          prose && !empty && "max-w-prose whitespace-pre-wrap",
          !prose && "font-medium",
        )}
      >
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

/**
 * Yes/no as a glyph plus a word. "Prescription requise : Non" in the same
 * ink as everything else forces you to read it; a checked "Oui" is caught
 * at a glance, which is the point for prescription and cold chain.
 */
export function YesNo({ value }: { value: boolean }) {
  if (!value) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Minus className="size-3.5" strokeWidth={2} aria-hidden />
        Non
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-primary">
      <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
      Oui
    </span>
  );
}

/**
 * A long text that already has a heading above it — a monograph, a notice.
 * Full width, no label column: repeating the heading as a label wastes the
 * left column and pushes a document-length text into two thirds of the row.
 */
export function DetailBlock({ value }: { value: string | null }) {
  if (!value) {
    return <p className="py-sp-sm text-muted-foreground/50">—</p>;
  }
  return (
    <p className="max-w-prose py-sp-xs leading-relaxed whitespace-pre-wrap text-foreground">
      {value}
    </p>
  );
}

/** A titled block of rows. The title is what makes a long tab scannable. */
export function DetailGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-sp-xs">
      {/* The rule is what separates one group from the next once the card
          is full width — a grey caption alone was lost among the rows. */}
      <div className="flex items-center gap-sp-sm">
        <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">{title}</h3>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <DetailList>{children}</DetailList>
    </section>
  );
}
