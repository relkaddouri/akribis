"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";
import { listSales, type SaleListItem } from "@/lib/server/sales-returns";
import { SALE_RETURN_STATUS_LABELS, SALE_RETURN_STATUSES } from "@/lib/sales/returns";
import { formatMad } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { SaleReturnBadge } from "@/components/features/sales/sale-return-badge";
import {
  LIBELLES_CREANCE,
  STATUTS_CREANCE,
  StatutCreanceBadge,
} from "@/components/features/sales/statut-creance-badge";

const SEARCH_DEBOUNCE_MS = 300;

const PAYMENT_LABELS: Record<SaleListItem["paymentMethod"], string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CREDIT: "Crédit client",
};

const columns: DataTableColumn<SaleListItem>[] = [
  {
    id: "date",
    header: "Date",
    sortValue: (sale) => sale.createdAt.getTime(),
    cell: (sale) => (
      <span className="whitespace-nowrap">{sale.createdAt.toLocaleString("fr-FR")}</span>
    ),
  },
  {
    id: "reference",
    header: "N° de vente",
    sortValue: (sale) => sale.reference,
    cell: (sale) => <span className="font-medium text-foreground">{sale.reference}</span>,
  },
  {
    id: "client",
    header: "Client",
    sortValue: (sale) => (sale.clientName ?? "").toLowerCase(),
    cell: (sale) =>
      sale.clientName ?? <span className="text-muted-foreground">Client de passage</span>,
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
    id: "creance",
    header: "Statut créance",
    // Trié pour que les créances à traiter remontent avant les ventes
    // ordinaires : c'est la raison d'être de la colonne.
    sortValue: (sale) => (sale.statutCreance === "AUCUNE" ? "zzz" : sale.statutCreance),
    cell: (sale) =>
      sale.statutCreance === "AUCUNE" ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-col items-start gap-0.5">
          <StatutCreanceBadge statut={sale.statutCreance} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {sale.insurerNom ? `${sale.insurerNom} · ` : ""}
            {formatMad(sale.montantPartAssurance)}
          </span>
        </div>
      ),
  },
  {
    id: "status",
    header: "Statut",
    sortValue: (sale) => sale.returnStatus,
    cell: (sale) => (
      <div className="flex items-center gap-sp-xs">
        <SaleReturnBadge status={sale.returnStatus} />
        {sale.invoiced && <Badge variant="outline">Facturée</Badge>}
      </div>
    ),
  },
];

/**
 * Status and payment are filtered client-side through the DataTable's own
 * dropdowns — the same standardised control the orders list uses. The
 * date range and the text search stay server-side, since neither can be
 * expressed as a predicate over an already-fetched page.
 */
const filters: DataTableFilter<SaleListItem>[] = [
  {
    id: "status",
    label: "Statut",
    options: SALE_RETURN_STATUSES.map((status) => ({
      label: SALE_RETURN_STATUS_LABELS[status],
      value: status,
    })),
    predicate: (sale, value) => sale.returnStatus === value,
  },
  {
    id: "creance",
    label: "Statut créance",
    // « Aucune » d'abord : filtrer sur les ventes sans tiers payant est le
    // besoin symétrique, et il faut pouvoir revenir au cas ordinaire.
    options: [
      { label: "Sans tiers payant", value: "AUCUNE" },
      ...STATUTS_CREANCE.map((statut) => ({ label: LIBELLES_CREANCE[statut], value: statut })),
    ],
    predicate: (sale, value) => sale.statutCreance === value,
  },
  {
    id: "payment",
    label: "Paiement",
    options: [
      { label: "Espèces", value: "CASH" },
      { label: "Carte", value: "CARD" },
      { label: "Crédit client", value: "CREDIT" },
    ],
    predicate: (sale, value) => sale.paymentMethod === value,
  },
];

export function SalesView() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const salesQuery = useQuery({
    queryKey: ["sales", { search, from, to }],
    queryFn: () => listSales({ search, from: from || undefined, to: to || undefined }),
  });

  const hasDateFilter = from !== "" || to !== "";

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Ventes"
        icon={<Receipt />}
        actions={
          <Button asChild>
            {/* This page is read-only history; taking money still happens
                at the till, so the action hands off to the POS rather
                than opening a sale form here. */}
            <Link href="/dashboard/pos">
              <Plus className="size-4" />
              Nouvelle vente
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-sp-md rounded-xl bg-card p-sp-md shadow-soft">
        <div className="min-w-56 flex-1 space-y-sp-xs">
          <Label htmlFor="sales-search">Recherche</Label>
          <Input
            id="sales-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Nom du client ou n° de vente (VTE-…)"
          />
        </div>
        <div className="space-y-sp-xs">
          <Label htmlFor="sales-from">Du</Label>
          <Input
            id="sales-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-sp-xs">
          <Label htmlFor="sales-to">Au</Label>
          <Input
            id="sales-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        {(hasDateFilter || searchInput) && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearchInput("");
              setFrom("");
              setTo("");
            }}
          >
            Réinitialiser
          </Button>
        )}
      </div>

      {salesQuery.isError && (
        <p className="text-destructive text-sm">Impossible de charger les ventes.</p>
      )}

      <DataTable
        columns={columns}
        data={salesQuery.data ?? []}
        getRowId={(sale) => sale.id}
        isLoading={salesQuery.isLoading}
        filters={filters}
        selectable={false}
        onRowClick={(sale) => router.push(`/ventes/${sale.id}`)}
        emptyTitle="Aucune vente"
        emptyDescription="Les ventes encaissées à la caisse apparaîtront ici."
      />
    </div>
  );
}
