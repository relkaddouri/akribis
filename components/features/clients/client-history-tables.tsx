"use client";

import { useRouter } from "next/navigation";
import { Download, FileText } from "lucide-react";
import type { SaleListItem } from "@/lib/server/sales-returns";
import type { InvoiceListItem } from "@/lib/server/invoices";
import { formatMad } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { SaleReturnBadge } from "@/components/features/sales/sale-return-badge";

const PAYMENT_LABELS: Record<SaleListItem["paymentMethod"], string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CREDIT: "Crédit client",
};

export type ClientSaleRow = SaleListItem & { summary: string };

const saleColumns: DataTableColumn<ClientSaleRow>[] = [
  {
    id: "date",
    header: "Date",
    sortValue: (sale) => sale.createdAt.getTime(),
    cell: (sale) => <span className="whitespace-nowrap">{sale.createdAt.toLocaleDateString("fr-FR")}</span>,
  },
  {
    id: "reference",
    header: "N° de vente",
    sortValue: (sale) => sale.reference,
    cell: (sale) => <span className="font-medium text-foreground">{sale.reference}</span>,
  },
  {
    id: "products",
    header: "Produits",
    cell: (sale) => <span className="text-muted-foreground">{sale.summary}</span>,
  },
  {
    id: "total",
    header: "Montant",
    align: "right",
    sortValue: (sale) => sale.totalAmount,
    cell: (sale) => <span className="tabular-nums">{formatMad(sale.totalAmount)}</span>,
  },
  {
    id: "payment",
    header: "Paiement",
    sortValue: (sale) => sale.paymentMethod,
    cell: (sale) => PAYMENT_LABELS[sale.paymentMethod],
  },
  {
    id: "status",
    header: "Statut",
    sortValue: (sale) => sale.returnStatus,
    cell: (sale) => <SaleReturnBadge status={sale.returnStatus} />,
  },
];

export function ClientSalesTable({ sales }: { sales: ClientSaleRow[] }) {
  const router = useRouter();

  return (
    <DataTable
      columns={saleColumns}
      data={sales}
      getRowId={(sale) => sale.id}
      selectable={false}
      onRowClick={(sale) => router.push(`/ventes/${sale.id}`)}
      emptyTitle="Aucun achat"
      emptyDescription="Les ventes de ce client apparaîtront ici."
    />
  );
}

const invoiceColumns: DataTableColumn<InvoiceListItem>[] = [
  {
    id: "number",
    header: "Numéro",
    sortValue: (invoice) => invoice.number,
    cell: (invoice) => (
      <span className="flex items-center gap-sp-sm font-medium text-foreground">
        <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        {invoice.number}
      </span>
    ),
  },
  {
    id: "date",
    header: "Date",
    sortValue: (invoice) => invoice.issuedAt.getTime(),
    cell: (invoice) => invoice.issuedAt.toLocaleDateString("fr-FR"),
  },
  {
    id: "total",
    header: "Total TTC",
    align: "right",
    sortValue: (invoice) => invoice.totalTtc,
    cell: (invoice) => <span className="tabular-nums">{formatMad(invoice.totalTtc)}</span>,
  },
  {
    id: "status",
    header: "Statut",
    sortValue: (invoice) => invoice.status,
    cell: (invoice) =>
      invoice.status === "cancelled" ? (
        <Badge variant="destructive">Annulée</Badge>
      ) : (
        <Badge variant="secondary">Émise</Badge>
      ),
  },
];

export function ClientInvoicesTable({ invoices }: { invoices: InvoiceListItem[] }) {
  const router = useRouter();

  return (
    <DataTable
      columns={invoiceColumns}
      data={invoices}
      getRowId={(invoice) => invoice.id}
      selectable={false}
      onRowClick={(invoice) => router.push(`/factures/${invoice.id}`)}
      emptyTitle="Aucune facture"
      emptyDescription="Les factures émises pour ce client apparaîtront ici."
      rowActions={(invoice) => (
        // A plain anchor, not a router push: this downloads a file.
        <a
          href={`/factures/${invoice.id}/pdf`}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Télécharger le PDF de ${invoice.number}`}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Download className="size-4" />
        </a>
      )}
    />
  );
}
