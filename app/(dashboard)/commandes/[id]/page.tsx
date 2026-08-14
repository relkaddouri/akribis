import { notFound } from "next/navigation";
import Link from "next/link";
import { ClipboardList, Download, PackagePlus, RotateCcw } from "lucide-react";
import { getOrderDetail } from "@/lib/server/orders";
import { formatOrderNumber } from "@/lib/orders/numbering";
import { formatMad } from "@/lib/invoices/totals";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { OrderStatusBadge } from "@/components/features/orders/order-status-badge";
import { OrderTimeline } from "@/components/features/orders/order-timeline";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrderDetail(id);
  if (!order) notFound();

  // Receiving stops making sense once everything is in or the order is
  // closed; raising a claim needs something to have actually arrived.
  const canReceive = order.status !== "RECUE" && order.status !== "CLOTUREE";
  const canRaiseCredit = order.deliveries.length > 0;

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={`Commande ${formatOrderNumber(order.numero)}`}
        subtitle={`${order.supplierName} · ${formatMad(order.totalAmount)}`}
        icon={<ClipboardList />}
        backHref="/commandes"
        backLabel="Commandes"
        actions={
          <div className="flex flex-wrap items-center gap-sp-sm">
            <OrderStatusBadge status={order.status} />
            {/* Plain anchor, not <Link>: this downloads a file. */}
            <Button variant="outline" asChild>
              <a href={`/commandes/${order.id}/pdf`}>
                <Download className="size-4" />
                Bon de commande
              </a>
            </Button>
            {/* Only once something has actually arrived: a claim can't
                concern goods still in transit. */}
            {canRaiseCredit && (
              <Button variant="outline" asChild>
                <Link href={`/commandes/${order.id}/avoir`}>
                  <RotateCcw className="size-4" />
                  Signaler un problème
                </Link>
              </Button>
            )}
            {canReceive && (
              <Button asChild>
                <Link href={`/commandes/${order.id}/receptionner`}>
                  <PackagePlus className="size-4" />
                  Réceptionner une livraison
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Produits commandés</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead className="text-right">Commandé</TableHead>
                <TableHead className="text-right">Reçu à ce jour</TableHead>
                <TableHead className="text-right">Reste à recevoir</TableHead>
                <TableHead className="text-right">Prix unitaire</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => {
                const remaining = item.quantity - item.receivedQuantity;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-foreground">
                      {item.productName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.receivedQuantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {remaining === 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-300">Complet</span>
                      ) : (
                        <span className="text-orange-700 dark:text-orange-300">{remaining}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.unitPrice.toFixed(2)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="mt-sp-md flex justify-end border-t pt-sp-sm">
            <span className="font-heading text-base font-bold text-foreground">
              Total : {formatMad(order.totalAmount)}
            </span>
          </div>
        </CardContent>
      </Card>

      <OrderTimeline order={order} />
    </div>
  );
}
