"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { receiveOrder } from "@/lib/offline/orders";
import type { OrderRecord } from "@/lib/server/orders";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PackagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { formatOrderNumber } from "@/lib/orders/numbering";

function remainingOf(item: OrderRecord["items"][number]): number {
  return item.quantity - item.receivedQuantity;
}

export function ReceiveOrderForm({ order }: { order: OrderRecord }) {
  const router = useRouter();
  const canReceive = order.status === "ENVOYEE" || order.status === "PARTIELLEMENT_RECUE";

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(order.items.map((item) => [item.id, remainingOf(item)])),
  );
  const [queued, setQueued] = useState(false);

  // `order` is a fresh prop after each `router.refresh()` post-receive,
  // but this component itself doesn't remount — without this, "Reçu
  // maintenant" would keep showing the pre-receipt remaining quantity
  // instead of what's actually still outstanding.
  useEffect(() => {
    setQuantities(Object.fromEntries(order.items.map((item) => [item.id, remainingOf(item)])));
  }, [order]);

  const mutation = useMutation({
    mutationFn: () =>
      receiveOrder(
        order.id,
        {
          lines: order.items.map((item) => ({
            orderItemId: item.id,
            receivedQuantity: quantities[item.id] ?? 0,
          })),
        },
        { lines: order.items.map((item) => ({ orderItemId: item.id, productId: item.productId })) },
      ),
    onSuccess: () => {
      // The write is queued locally and applied for real by the sync
      // engine — the true server-confirmed status (and the delivery
      // note's number) only exist once that's happened, hence the return
      // to the order rather than any claim about the result here.
      setQueued(true);
      router.push(`/commandes/${order.id}`);
      router.refresh();
    },
  });

  const totalOrdered = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalReceived = order.items.reduce((sum, item) => sum + item.receivedQuantity, 0);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={`Réceptionner — ${formatOrderNumber(order.numero)}`}
        subtitle={order.supplierName}
        icon={<PackagePlus />}
        backHref={`/commandes/${order.id}`}
        backLabel="la commande"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-sp-md">
            <span>Lignes de la commande</span>
            {/* Progress at a glance: the table alone made the reader add
                the columns up themselves to know where the order stands. */}
            <span className="text-sm font-normal text-muted-foreground">
              {totalReceived} / {totalOrdered} unités reçues
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead className="text-right">Commandé</TableHead>
                <TableHead className="text-right">Déjà reçu</TableHead>
                <TableHead className="text-right">Restant</TableHead>
                {canReceive && <TableHead className="text-right">Reçu maintenant</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => {
                const remaining = remainingOf(item);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-foreground">{item.productName}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.receivedQuantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {remaining === 0 ? (
                        <Badge variant="secondary">Complet</Badge>
                      ) : (
                        <span className="text-muted-foreground">{remaining}</span>
                      )}
                    </TableCell>
                    {canReceive && (
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          disabled={remaining === 0}
                          aria-label={`Quantité reçue pour ${item.productName}`}
                          value={quantities[item.id] ?? 0}
                          onChange={(event) =>
                            setQuantities((prev) => ({
                              ...prev,
                              [item.id]: Math.max(
                                0,
                                Math.min(Number(event.target.value) || 0, remaining),
                              ),
                            }))
                          }
                          className="ml-auto w-24 text-right"
                        />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {mutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>{(mutation.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {queued && !mutation.isPending && (
        <Alert>
          <AlertDescription>
            Réception enregistrée localement — synchronisée dès que la connexion est disponible.
          </AlertDescription>
        </Alert>
      )}

      {canReceive && (
        <Button
          type="button"
          onClick={() => {
            setQueued(false);
            mutation.mutate();
          }}
          disabled={mutation.isPending || Object.values(quantities).every((qty) => qty <= 0)}
        >
          {mutation.isPending ? "Enregistrement..." : "Confirmer la réception"}
        </Button>
      )}
    </div>
  );
}
