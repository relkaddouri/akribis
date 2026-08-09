import { CreditCard, Banknote, ShoppingBag } from "lucide-react";
import type { ClientPurchase } from "@/lib/server/clients";
import { formatMad } from "@/lib/invoices/totals";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAYMENT = {
  CASH: { label: "Espèces", icon: Banknote },
  CARD: { label: "Carte", icon: CreditCard },
} as const;

function PaymentTag({ method }: { method: string }) {
  const entry = PAYMENT[method as keyof typeof PAYMENT];
  const Icon = entry?.icon ?? CreditCard;
  return (
    <span className="flex items-center gap-sp-xs text-xs text-muted-foreground">
      <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      {entry?.label ?? method}
    </span>
  );
}

export function PurchaseHistory({ purchases }: { purchases: ClientPurchase[] }) {
  if (purchases.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-sp-sm py-sp-2xl text-center">
          <ShoppingBag className="size-8 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <p className="font-heading font-semibold text-foreground">Aucun achat enregistré</p>
          <p className="text-sm text-muted-foreground">
            Les ventes associées à ce client apparaîtront ici.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-sp-md">
      {purchases.map((purchase) => (
        <Card key={purchase.saleId}>
          <CardContent className="space-y-sp-md">
            <div className="flex flex-wrap items-center justify-between gap-sp-sm">
              <p className="text-sm font-medium text-foreground">
                {purchase.createdAt.toLocaleString("fr-FR")}
              </p>
              <PaymentTag method={purchase.paymentMethod} />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right">Qté</TableHead>
                  <TableHead className="text-right">Prix unitaire</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-foreground">{item.productName}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.unitPrice.toFixed(2)}
                    </TableCell>
                    {/* The line total was missing entirely, so the reader had
                        to multiply in their head to check the sale total. */}
                    <TableCell className="text-right tabular-nums">
                      {(item.unitPrice * item.quantity).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-end border-t pt-sp-sm">
              <span className="font-heading text-sm font-bold text-foreground">
                Total : {formatMad(purchase.totalAmount)}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
