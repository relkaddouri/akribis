"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { listSupplierCredits, type SupplierCreditListItem } from "@/lib/server/supplier-credits";
import {
  SUPPLIER_CREDIT_MOTIFS,
  SUPPLIER_CREDIT_MOTIF_LABELS,
  SUPPLIER_CREDIT_STATUSES,
} from "@/lib/suppliers/credits";
import { formatOrderNumber, formatCreditNumber } from "@/lib/orders/numbering";
import { formatMad } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import {
  CREDIT_STATUS_LABELS,
  SupplierCreditBadge,
} from "@/components/features/suppliers/supplier-credit-badge";

const columns: DataTableColumn<SupplierCreditListItem>[] = [
  {
    id: "numero",
    header: "Numéro",
    sortValue: (credit) => credit.numero,
    cell: (credit) => (
      <span className="font-medium tabular-nums text-foreground">
        {formatCreditNumber(credit.numero)}
      </span>
    ),
  },
  {
    id: "supplier",
    header: "Fournisseur",
    sortValue: (credit) => credit.supplierName.toLowerCase(),
    cell: (credit) => credit.supplierName,
  },
  {
    id: "order",
    header: "Commande liée",
    sortValue: (credit) => credit.orderNumero ?? 0,
    cell: (credit) =>
      credit.orderNumero !== null ? (
        formatOrderNumber(credit.orderNumero)
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "motif",
    header: "Motif",
    sortValue: (credit) => credit.motif,
    cell: (credit) => (
      <span className="flex items-center gap-sp-xs">
        {SUPPLIER_CREDIT_MOTIF_LABELS[credit.motif]}
        {credit.lieRappelLot && <Badge variant="destructive">Rappel de lot</Badge>}
      </span>
    ),
  },
  {
    id: "statut",
    header: "Statut",
    sortValue: (credit) => credit.statut,
    cell: (credit) => <SupplierCreditBadge statut={credit.statut} />,
  },
  {
    id: "montant",
    header: "Montant",
    align: "right",
    sortValue: (credit) => credit.montant,
    cell: (credit) => <span className="tabular-nums">{formatMad(credit.montant)}</span>,
  },
  {
    id: "date",
    header: "Date",
    sortValue: (credit) => credit.dateEmission.getTime(),
    cell: (credit) => (
      <span className="whitespace-nowrap">
        {credit.dateEmission.toLocaleDateString("fr-FR")}
      </span>
    ),
  },
];

export function SupplierCreditsView() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const creditsQuery = useQuery({
    queryKey: ["supplier-credits"],
    queryFn: () => listSupplierCredits(),
  });
  const credits = useMemo(() => creditsQuery.data ?? [], [creditsQuery.data]);

  const filters: DataTableFilter<SupplierCreditListItem>[] = useMemo(() => {
    // Supplier options come from the data, so the dropdown never offers a
    // supplier with no claims against them.
    const suppliers = new Map(credits.map((credit) => [credit.supplierId, credit.supplierName]));

    return [
      {
        id: "statut",
        label: "Statut",
        options: SUPPLIER_CREDIT_STATUSES.map((statut) => ({
          label: CREDIT_STATUS_LABELS[statut],
          value: statut,
        })),
        predicate: (credit, value) => credit.statut === value,
      },
      {
        id: "supplier",
        label: "Fournisseur",
        options: [...suppliers.entries()]
          .map(([id, name]) => ({ label: name, value: id }))
          .sort((a, b) => a.label.localeCompare(b.label, "fr")),
        predicate: (credit, value) => credit.supplierId === value,
      },
      {
        id: "motif",
        label: "Motif",
        options: SUPPLIER_CREDIT_MOTIFS.map((motif) => ({
          label: SUPPLIER_CREDIT_MOTIF_LABELS[motif],
          value: motif,
        })),
        predicate: (credit, value) => credit.motif === value,
      },
    ];
  }, [credits]);

  // A range, which the dropdown filters can't express.
  const visible = useMemo(() => {
    if (!from && !to) return credits;
    const fromTime = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
    return credits.filter((credit) => {
      const time = credit.dateEmission.getTime();
      return time >= fromTime && time <= toTime;
    });
  }, [credits, from, to]);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Avoirs fournisseurs"
        subtitle="Produits retournés et réclamations"
        icon={<RotateCcw />}
        backHref="/commandes"
        backLabel="Commandes"
      />

      <div className="flex flex-wrap items-end gap-sp-md rounded-xl bg-card p-sp-md shadow-soft">
        <div className="space-y-sp-xs">
          <Label htmlFor="credits-from">Du</Label>
          <Input
            id="credits-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-sp-xs">
          <Label htmlFor="credits-to">Au</Label>
          <Input
            id="credits-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        {(from || to) && (
          <Button
            variant="ghost"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Réinitialiser la période
          </Button>
        )}
      </div>

      {creditsQuery.isError && (
        <p className="text-destructive text-sm">Impossible de charger les avoirs.</p>
      )}

      <DataTable
        columns={columns}
        data={visible}
        getRowId={(credit) => credit.id}
        isLoading={creditsQuery.isLoading}
        searchPlaceholder="Rechercher par fournisseur ou numéro..."
        searchFields={(credit) => [credit.supplierName, String(credit.numero)]}
        filters={filters}
        selectable={false}
        onRowClick={(credit) => router.push(`/commandes/avoirs/${credit.id}`)}
        emptyTitle="Aucun avoir"
        emptyDescription="Signalez un problème depuis une commande livrée pour en créer un."
      />
    </div>
  );
}
