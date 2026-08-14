"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Mail,
  PackageCheck,
  Phone,
  Plus,
  RotateCcw,
  Truck,
  Wallet,
} from "lucide-react";
import type {
  SupplierCreditRow,
  SupplierDeliveryRow,
  SupplierDetail,
  SupplierOrderRow,
} from "@/lib/server/suppliers";
import {
  COMPENSATION_MODE_LABELS,
  SUPPLIER_CREDIT_MOTIF_LABELS,
} from "@/lib/suppliers/credits";
import {
  formatCreditNumber,
  formatDeliveryNumber,
  formatOrderNumber,
} from "@/lib/orders/numbering";
import { formatMad } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { StatCard } from "@/components/features/dashboard/stat-card";
import { OrderStatusBadge } from "@/components/features/orders/order-status-badge";
import { SupplierCreditBadge } from "@/components/features/suppliers/supplier-credit-badge";


const orderColumns: DataTableColumn<SupplierOrderRow>[] = [
  {
    id: "numero",
    header: "Numéro",
    sortValue: (order) => order.numero,
    cell: (order) => (
      <span className="font-medium tabular-nums text-foreground">
        {formatOrderNumber(order.numero)}
      </span>
    ),
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

const deliveryColumns: DataTableColumn<SupplierDeliveryRow>[] = [
  {
    id: "numero",
    header: "Bon de livraison",
    sortValue: (delivery) => delivery.numero,
    cell: (delivery) => (
      <span className="font-medium tabular-nums text-foreground">
        {formatDeliveryNumber(delivery.numero)}
      </span>
    ),
  },
  {
    id: "date",
    header: "Reçue le",
    sortValue: (delivery) => delivery.dateReception.getTime(),
    cell: (delivery) => (
      <span className="whitespace-nowrap">
        {delivery.dateReception.toLocaleDateString("fr-FR")}
      </span>
    ),
  },
  {
    id: "order",
    header: "Commande liée",
    sortValue: (delivery) => delivery.orderNumero,
    cell: (delivery) => (
      <span className="tabular-nums">{formatOrderNumber(delivery.orderNumero)}</span>
    ),
  },
  {
    id: "products",
    header: "Produits reçus",
    align: "right",
    sortValue: (delivery) => delivery.unitCount,
    cell: (delivery) => (
      <span className="tabular-nums">
        {delivery.productCount} référence{delivery.productCount > 1 ? "s" : ""} ·{" "}
        {delivery.unitCount} unité{delivery.unitCount > 1 ? "s" : ""}
      </span>
    ),
  },
];

const creditColumns: DataTableColumn<SupplierCreditRow>[] = [
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
    id: "compensation",
    header: "Compensation",
    // Only settled claims have one: until the supplier answers, how they
    // will compensate is not decided, and guessing would be misleading.
    sortValue: (credit) => credit.modeCompensation ?? "",
    cell: (credit) =>
      credit.modeCompensation ? (
        COMPENSATION_MODE_LABELS[credit.modeCompensation]
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "restant",
    header: "Reste utilisable",
    align: "right",
    sortValue: (credit) => usableRemainder(credit),
    cell: (credit) => {
      const remainder = usableRemainder(credit);
      return remainder > 0 ? (
        <span className="tabular-nums font-medium text-emerald-700 dark:text-emerald-300">
          {formatMad(remainder)}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
];

/**
 * What this credit can still take off a future order — the same three
 * conditions the new-order screen applies. A cash refund has already been
 * paid back and an unconfirmed claim is not money yet, so neither shows a
 * usable remainder however large its face value.
 */
function usableRemainder(credit: SupplierCreditRow): number {
  if (credit.statut !== "recu") return 0;
  if (credit.modeCompensation !== "avoir_credit") return 0;
  return credit.montantRestant;
}

/**
 * The tab's row count. Muted rather than a full badge — it's context for
 * the label, not a notification demanding attention.
 */
function TabCount({ value }: { value: number }) {
  return (
    // Not aria-hidden: "Commandes, 3" is exactly what a screen-reader user
    // needs to decide whether the tab is worth opening.
    <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
  );
}

function ContactLine({
  icon: Icon,
  value,
  href,
}: {
  icon: typeof Phone;
  value: string | null;
  href?: string;
}) {
  if (!value) return null;
  return (
    <span className="flex items-center gap-sp-xs text-sm text-muted-foreground">
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {href ? (
        <a href={href} className="hover:underline">
          {value}
        </a>
      ) : (
        value
      )}
    </span>
  );
}

export function SupplierDetailView({ supplier }: { supplier: SupplierDetail }) {
  const router = useRouter();
  const hasCredit = supplier.creditBalance > 0;

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={supplier.name}
        icon={<Truck />}
        backHref="/commandes/fournisseurs"
        backLabel="Fournisseurs"
        actions={
          <Button asChild>
            {/* Carries the supplier through, so the order screen opens with
                this one already chosen. */}
            <Link href={`/commandes/nouvelle?fournisseur=${supplier.id}`}>
              <Plus className="size-4" />
              Nouvelle commande
            </Link>
          </Button>
        }
      />

      <section className="grid gap-sp-md sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Commandé sur 12 mois"
          value={formatMad(supplier.stats.orderedLast12Months)}
          hint="Valeur commandée sur les 12 derniers mois glissants"
        />
        <StatCard
          label="Commandes en cours"
          value={String(supplier.stats.ordersInProgress)}
          hint="Envoyées ou partiellement reçues"
        />
        <StatCard
          label="Avoirs en attente"
          value={String(supplier.stats.creditsAwaitingConfirmation)}
          hint="En attente de confirmation du fournisseur"
        />
      </section>

      <section className="grid gap-sp-md lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-sp-sm">
            <p className="text-lg font-semibold text-foreground">{supplier.name}</p>
            <div className="flex flex-col gap-sp-xs">
              <ContactLine icon={Phone} value={supplier.phone} href={`tel:${supplier.phone}`} />
              <ContactLine icon={Mail} value={supplier.email} href={`mailto:${supplier.email}`} />
            </div>
            {!supplier.phone && !supplier.email && (
              <p className="text-sm text-muted-foreground">
                Aucune coordonnée enregistrée pour ce fournisseur.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Fournisseur depuis le {supplier.createdAt.toLocaleDateString("fr-FR")}
            </p>
          </CardContent>
        </Card>

        {/* Green only when there is actually something to spend: a zero
            balance styled as good news would read as available credit. */}
        <Card
          className={
            hasCredit ? "bg-emerald-50 dark:bg-emerald-950/40" : undefined
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-sp-xs">
              <Wallet className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              Solde crédit disponible
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-sp-sm">
            <p
              className={
                hasCredit
                  ? "text-3xl font-bold text-emerald-700 dark:text-emerald-300"
                  : "text-3xl font-bold text-muted-foreground"
              }
            >
              {formatMad(supplier.creditBalance)}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasCredit
                ? "Déductible de votre prochaine commande chez ce fournisseur."
                : "Aucun avoir crédit confirmé et non utilisé chez ce fournisseur."}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Three histories of the same relationship — one at a time keeps the
          page short. Each tab carries its count, so putting the other two
          out of sight never hides the fact that they hold something. */}
      <Tabs defaultValue="commandes" className="gap-sp-md">
        <TabsList>
          <TabsTrigger value="commandes">
            <ClipboardList aria-hidden />
            Commandes
            <TabCount value={supplier.orders.length} />
          </TabsTrigger>
          <TabsTrigger value="livraisons">
            <PackageCheck aria-hidden />
            Livraisons
            <TabCount value={supplier.deliveries.length} />
          </TabsTrigger>
          <TabsTrigger value="avoirs">
            <RotateCcw aria-hidden />
            Avoirs
            <TabCount value={supplier.credits.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="commandes">
          <DataTable
            columns={orderColumns}
            data={supplier.orders}
            getRowId={(order) => order.id}
            searchPlaceholder="Rechercher par numéro..."
            searchFields={(order) => [String(order.numero), formatOrderNumber(order.numero)]}
            selectable={false}
            onRowClick={(order) => router.push(`/commandes/${order.id}`)}
            emptyTitle="Aucune commande"
            emptyDescription="Aucune commande n'a encore été passée chez ce fournisseur."
          />
        </TabsContent>

        <TabsContent value="livraisons">
          <DataTable
            columns={deliveryColumns}
            data={supplier.deliveries}
            getRowId={(delivery) => delivery.id}
            searchPlaceholder="Rechercher par bon de livraison ou commande..."
            searchFields={(delivery) => [
              formatDeliveryNumber(delivery.numero),
              formatOrderNumber(delivery.orderNumero),
            ]}
            selectable={false}
            // There is no standalone delivery page: a shipment is only
            // meaningful against its order, whose timeline already lists it
            // with a link to the delivery note PDF.
            onRowClick={(delivery) => router.push(`/commandes/${delivery.orderId}`)}
            emptyTitle="Aucune livraison"
            emptyDescription="Aucune marchandise n'a encore été réceptionnée pour ce fournisseur."
          />
        </TabsContent>

        <TabsContent value="avoirs">
          <DataTable
            columns={creditColumns}
            data={supplier.credits}
            getRowId={(credit) => credit.id}
            searchPlaceholder="Rechercher par numéro ou motif..."
            searchFields={(credit) => [
              formatCreditNumber(credit.numero),
              SUPPLIER_CREDIT_MOTIF_LABELS[credit.motif],
            ]}
            selectable={false}
            onRowClick={(credit) => router.push(`/commandes/avoirs/${credit.id}`)}
            emptyTitle="Aucun avoir"
            emptyDescription="Aucune réclamation n'a été émise chez ce fournisseur."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
