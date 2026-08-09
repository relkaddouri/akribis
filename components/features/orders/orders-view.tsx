"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Eye } from "lucide-react";
import { listOrders, type OrderListItem } from "@/lib/server/orders";
import type { OrderStatus } from "@/lib/db/generated/enums";
import { Button } from "@/components/ui/button";
import { AvatarBadge } from "@/components/ui/avatar-badge";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { OrderStatusBadge, STATUS_LABELS } from "@/components/features/orders/order-status-badge";

const columns: DataTableColumn<OrderListItem>[] = [
  {
    id: "supplier",
    header: "Fournisseur",
    sortValue: (o) => o.supplierName.toLowerCase(),
    cell: (o) => (
      <div className="flex items-center gap-sp-sm">
        <AvatarBadge name={o.supplierName} />
        <span className="font-medium text-foreground">{o.supplierName}</span>
      </div>
    ),
  },
  {
    id: "date",
    header: "Date",
    sortValue: (o) => o.createdAt.getTime(),
    cell: (o) => o.createdAt.toLocaleDateString("fr-FR"),
  },
  {
    id: "items",
    header: "Produits",
    sortValue: (o) => o.itemCount,
    cell: (o) => o.itemCount,
  },
  {
    id: "status",
    header: "Statut",
    sortValue: (o) => o.status,
    cell: (o) => <OrderStatusBadge status={o.status} />,
  },
];

const filters: DataTableFilter<OrderListItem>[] = [
  {
    id: "status",
    label: "Statut",
    options: (Object.keys(STATUS_LABELS) as OrderStatus[]).map((status) => ({
      label: STATUS_LABELS[status],
      value: status,
    })),
    predicate: (o, value) => o.status === value,
  },
];

export function OrdersView() {
  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => listOrders(),
  });

  const orders = ordersQuery.data ?? [];

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Commandes"
        icon={<ClipboardList />}
        actions={
          <div className="flex gap-sp-sm">
            <Button asChild variant="outline">
              <Link href="/dashboard/commandes/fournisseurs">Fournisseurs</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard/commandes/nouvelle">Nouvelle commande</Link>
            </Button>
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={orders}
        getRowId={(o) => o.id}
        isLoading={ordersQuery.isLoading}
        searchPlaceholder="Rechercher par fournisseur..."
        searchFields={(o) => [o.supplierName]}
        filters={filters}
        emptyTitle="Aucune commande"
        emptyDescription="Créez votre première commande fournisseur."
        rowActions={(o) => (
          <Link
            href={`/dashboard/commandes/${o.id}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Voir la commande"
          >
            <Eye className="size-4" />
          </Link>
        )}
      />
    </div>
  );
}
