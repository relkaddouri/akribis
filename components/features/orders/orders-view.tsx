"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import { listOrders, type OrderListItem } from "@/lib/server/orders";
import type { OrderStatus } from "@/lib/db/generated/enums";
import { formatMad } from "@/lib/invoices/totals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { OrderStatusBadge, STATUS_LABELS } from "@/components/features/orders/order-status-badge";

const columns: DataTableColumn<OrderListItem>[] = [
  {
    id: "numero",
    header: "Numéro",
    sortValue: (order) => order.numero,
    cell: (order) => (
      <span className="font-medium tabular-nums text-foreground">
        {String(order.numero).padStart(4, "0")}
      </span>
    ),
  },
  {
    id: "supplier",
    header: "Fournisseur",
    sortValue: (order) => order.supplierName.toLowerCase(),
    cell: (order) => order.supplierName,
  },
  {
    id: "date",
    header: "Créée le",
    sortValue: (order) => order.createdAt.getTime(),
    cell: (order) => (
      <span className="whitespace-nowrap">{order.createdAt.toLocaleDateString("fr-FR")}</span>
    ),
  },
  {
    id: "status",
    header: "Statut",
    sortValue: (order) => order.status,
    cell: (order) => <OrderStatusBadge status={order.status} />,
  },
  {
    id: "total",
    header: "Montant total",
    align: "right",
    sortValue: (order) => order.totalAmount,
    cell: (order) => <span className="tabular-nums">{formatMad(order.totalAmount)}</span>,
  },
];

const STATUS_ORDER: OrderStatus[] = [
  "BROUILLON",
  "ENVOYEE",
  "PARTIELLEMENT_RECUE",
  "RECUE",
  "CLOTUREE",
];

export function OrdersView() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => listOrders(),
  });
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);

  /**
   * Supplier options come from the data rather than a fixed list, so the
   * dropdown only ever offers suppliers that actually have orders — no dead
   * filter entries.
   */
  const filters: DataTableFilter<OrderListItem>[] = useMemo(() => {
    const suppliers = new Map(orders.map((order) => [order.supplierId, order.supplierName]));

    return [
      {
        id: "status",
        label: "Statut",
        options: STATUS_ORDER.map((status) => ({ label: STATUS_LABELS[status], value: status })),
        predicate: (order, value) => order.status === value,
      },
      {
        id: "supplier",
        label: "Fournisseur",
        options: [...suppliers.entries()]
          .map(([id, name]) => ({ label: name, value: id }))
          .sort((a, b) => a.label.localeCompare(b.label, "fr")),
        predicate: (order, value) => order.supplierId === value,
      },
    ];
  }, [orders]);

  // The period is a range, which the dropdown filters can't express, so it
  // sits beside them and narrows the data before the table sees it.
  const visible = useMemo(() => {
    if (!from && !to) return orders;
    const fromTime = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
    // Inclusive end of the chosen day — midnight would drop that day.
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;

    return orders.filter((order) => {
      const time = order.createdAt.getTime();
      return time >= fromTime && time <= toTime;
    });
  }, [orders, from, to]);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Commandes"
        icon={<ClipboardList />}
        actions={
          <div className="flex gap-sp-sm">
            <Button asChild variant="outline">
              <Link href="/commandes/avoirs">Avoirs</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/commandes/fournisseurs">Fournisseurs</Link>
            </Button>
            <Button asChild>
              <Link href="/commandes/nouvelle">
                <Plus className="size-4" />
                Nouvelle commande
              </Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-sp-md rounded-xl bg-card p-sp-md shadow-soft">
        <div className="space-y-sp-xs">
          <Label htmlFor="orders-from">Du</Label>
          <Input
            id="orders-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-sp-xs">
          <Label htmlFor="orders-to">Au</Label>
          <Input
            id="orders-to"
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

      {ordersQuery.isError && (
        <p className="text-destructive text-sm">Impossible de charger les commandes.</p>
      )}

      <DataTable
        columns={columns}
        data={visible}
        getRowId={(order) => order.id}
        isLoading={ordersQuery.isLoading}
        searchPlaceholder="Rechercher par fournisseur ou numéro..."
        searchFields={(order) => [order.supplierName, String(order.numero)]}
        filters={filters}
        selectable={false}
        onRowClick={(order) => router.push(`/commandes/${order.id}`)}
        emptyTitle="Aucune commande"
        emptyDescription="Créez votre première commande fournisseur."
      />
    </div>
  );
}
