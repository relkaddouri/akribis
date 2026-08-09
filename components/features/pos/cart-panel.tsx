"use client";

import {
  computeCartTotal,
  getLineTotal,
  removeFromCart,
  setCartLineQuantity,
  type CartLine,
} from "@/lib/pos/cart";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PaymentMethod = "CASH" | "CARD";

export function CartPanel({
  lines,
  onChangeLines,
  paymentMethod,
  onChangePaymentMethod,
  onValidate,
  isSubmitting,
}: {
  lines: CartLine[];
  onChangeLines: (lines: CartLine[]) => void;
  paymentMethod: PaymentMethod | null;
  onChangePaymentMethod: (method: PaymentMethod) => void;
  onValidate: () => void;
  isSubmitting: boolean;
}) {
  const total = computeCartTotal(lines);

  return (
    <div className="flex flex-col gap-4">
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Le panier est vide. Scannez ou recherchez un produit.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produit</TableHead>
              <TableHead>Qté</TableHead>
              <TableHead>Prix</TableHead>
              <TableHead>Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.productId}>
                <TableCell className="font-medium">{line.productName}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() =>
                        onChangeLines(
                          setCartLineQuantity(lines, line.productId, line.quantity - 1),
                        )
                      }
                    >
                      −
                    </Button>
                    <span className="w-8 text-center">{line.quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={line.quantity >= line.availableStock}
                      onClick={() =>
                        onChangeLines(
                          setCartLineQuantity(lines, line.productId, line.quantity + 1),
                        )
                      }
                    >
                      +
                    </Button>
                  </div>
                </TableCell>
                <TableCell>{line.unitPrice.toFixed(2)}</TableCell>
                <TableCell>{getLineTotal(line).toFixed(2)}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChangeLines(removeFromCart(lines, line.productId))}
                  >
                    Retirer
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        <span className="text-lg font-semibold">Total</span>
        <span className="text-2xl font-bold">{total.toFixed(2)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={paymentMethod === "CASH" ? "default" : "outline"}
          className="h-14 text-base"
          onClick={() => onChangePaymentMethod("CASH")}
        >
          Espèces
        </Button>
        <Button
          type="button"
          variant={paymentMethod === "CARD" ? "default" : "outline"}
          className="h-14 text-base"
          onClick={() => onChangePaymentMethod("CARD")}
        >
          Carte
        </Button>
      </div>

      <Button
        type="button"
        size="lg"
        className="h-14 text-lg"
        disabled={lines.length === 0 || !paymentMethod || isSubmitting}
        onClick={onValidate}
      >
        {isSubmitting ? "Enregistrement..." : "Valider la vente"}
      </Button>
    </div>
  );
}
