import { CircleCheck, ClipboardList, Download, PackageCheck, RotateCcw } from "lucide-react";
import type { OrderDetail } from "@/lib/server/orders";
import { formatCreditNumber, formatDeliveryNumber } from "@/lib/orders/numbering";
import { SUPPLIER_CREDIT_MOTIF_LABELS } from "@/lib/suppliers/credits";
import type { SupplierCreditMotifValue } from "@/lib/suppliers/credits";
import { formatMad } from "@/lib/invoices/totals";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type TimelineEntry = {
  key: string;
  at: Date;
  icon: typeof ClipboardList;
  iconClass: string;
  /** Plain-language headline — what actually happened. */
  title: string;
  /** The trade term, kept small for people who already use it. */
  jargon?: string;
  detail?: React.ReactNode;
  badge?: { label: string; className: string };
  /** Downloadable document for this entry, when it has one. */
  pdfHref?: string;
};

/**
 * The order's history in one chronological thread: created, then every
 * delivery and every credit note as they happened.
 *
 * Headlines are written in plain language — "Produits retournés — en
 * attente de confirmation fournisseur" rather than "Avoir émis" — with the
 * accounting term shown quietly beside it. A pharmacist shouldn't need to
 * read a ledger to follow their own order, but the people who do know the
 * vocabulary shouldn't lose it either.
 */
function buildTimeline(order: OrderDetail): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    {
      key: "created",
      at: order.createdAt,
      icon: ClipboardList,
      iconClass: "bg-muted text-muted-foreground",
      title: "Commande créée",
      detail: `${order.items.length} produit${order.items.length > 1 ? "s" : ""} · ${formatMad(order.totalAmount)}`,
    },
  ];

  for (const delivery of order.deliveries) {
    const units = delivery.lines.reduce((sum, line) => sum + line.quantiteRecue, 0);
    entries.push({
      key: `delivery-${delivery.id}`,
      at: delivery.dateReception,
      icon: PackageCheck,
      iconClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
      title: "Marchandise reçue",
      jargon: `Bon de livraison ${formatDeliveryNumber(delivery.numero)}`,
      detail: (
        <ul className="space-y-sp-xs">
          {delivery.lines.map((line, index) => (
            <li key={index}>
              {line.quantiteRecue} × {line.productName}
            </li>
          ))}
        </ul>
      ),
      badge: {
        label: `${units} unité${units > 1 ? "s" : ""}`,
        className: "bg-muted text-muted-foreground",
      },
      pdfHref: `/commandes/${order.id}/livraisons/${delivery.id}/pdf`,
    });
  }

  for (const credit of order.credits) {
    const motifLabel =
      SUPPLIER_CREDIT_MOTIF_LABELS[credit.motif as SupplierCreditMotifValue] ?? credit.motif;
    const settled = credit.statut === "recu";

    entries.push({
      key: `credit-${credit.id}`,
      at: credit.dateEmission,
      icon: settled ? CircleCheck : RotateCcw,
      iconClass: settled
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        : "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
      title: settled
        ? "Produits retournés — remboursement confirmé par le fournisseur"
        : "Produits retournés — en attente de confirmation fournisseur",
      jargon: `Avoir ${formatCreditNumber(credit.numero)}`,
      detail: (
        <>
          <p>
            {motifLabel} · {formatMad(credit.montant)}
          </p>
          {credit.lieRappelLot && (
            <p className="text-destructive">Lié à un rappel de lot officiel</p>
          )}
          {settled && credit.dateReception && (
            <p>Confirmé le {credit.dateReception.toLocaleDateString("fr-FR")}</p>
          )}
        </>
      ),
      badge: settled
        ? {
            label: "Confirmé",
            className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
          }
        : {
            label: "En attente",
            className: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
          },
    });
  }

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function OrderTimeline({ order }: { order: OrderDetail }) {
  const entries = buildTimeline(order);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suivi de la commande</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-sp-lg">
          {entries.map((entry, index) => {
            const Icon = entry.icon;
            const isLast = index === entries.length - 1;

            const body = (
              <div className="min-w-0 flex-1 space-y-sp-xs pb-sp-xs">
                <div className="flex flex-wrap items-center justify-between gap-sp-sm">
                  <p className="font-medium text-foreground">{entry.title}</p>
                  {entry.badge && (
                    <span
                      className={cn(
                        "shrink-0 rounded-4xl px-sp-sm py-sp-xs text-xs font-medium whitespace-nowrap",
                        entry.badge.className,
                      )}
                    >
                      {entry.badge.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {entry.at.toLocaleString("fr-FR")}
                  {entry.jargon ? ` · ${entry.jargon}` : ""}
                </p>
                {entry.detail && (
                  <div className="text-sm text-muted-foreground">{entry.detail}</div>
                )}
                {entry.pdfHref && (
                  // Plain anchor, not <Link>: this downloads a file.
                  <a
                    href={entry.pdfHref}
                    className="inline-flex items-center gap-sp-xs text-xs font-medium text-primary hover:underline"
                  >
                    <Download className="size-3.5" strokeWidth={1.75} />
                    Bon de livraison (PDF)
                  </a>
                )}
              </div>
            );

            return (
              <li key={entry.key} className="flex gap-sp-md">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      entry.iconClass,
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                  </span>
                  {/* The connecting thread; omitted after the last entry so
                      the timeline doesn't trail into nothing. */}
                  {!isLast && <span className="mt-sp-xs w-px flex-1 bg-border" />}
                </div>

                {body}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
