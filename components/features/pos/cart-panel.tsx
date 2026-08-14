"use client";

import { Banknote, CreditCard, Minus, Plus, Trash2, UserRound } from "lucide-react";
import {
  computeCartTotal,
  getLineTotal,
  removeFromCart,
  setCartLineQuantity,
  type CartLine,
} from "@/lib/pos/cart";
import { computeChange, quickCashAmounts } from "@/lib/pos/change";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PaymentMethod = "CASH" | "CARD" | "CREDIT";

function formatMoney(value: number): string {
  return value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The change display. Large and unmissable on purpose — this is the one
 * number the cashier reads while counting notes out of the drawer.
 * A short payment shows what's still owed as a positive amount rather
 * than negative change.
 */
function ChangeDisplay({ total, received }: { total: number; received: number }) {
  const { isSufficient, change, missing } = computeChange(total, received);

  if (received <= 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl px-sp-md py-sp-sm text-center",
        isSufficient
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
      )}
      aria-live="polite"
    >
      <p className="text-sm font-medium">{isSufficient ? "Monnaie à rendre" : "Montant manquant"}</p>
      <p className="font-heading text-4xl font-extrabold tabular-nums">
        {formatMoney(isSufficient ? change : missing)}
        <span className="ml-sp-xs text-lg font-bold">MAD</span>
      </p>
    </div>
  );
}

export function CartPanel({
  lines,
  onChangeLines,
  paymentMethod,
  onChangePaymentMethod,
  cashReceived,
  onChangeCashReceived,
  onValidate,
  isSubmitting,
  canValidate,
  flashedProductId,
  hasClient,
}: {
  lines: CartLine[];
  onChangeLines: (lines: CartLine[]) => void;
  paymentMethod: PaymentMethod | null;
  onChangePaymentMethod: (method: PaymentMethod) => void;
  /** Cash handed over, in MAD. 0 means "nothing entered yet". */
  cashReceived: number;
  onChangeCashReceived: (amount: number) => void;
  onValidate: () => void;
  isSubmitting: boolean;
  canValidate: boolean;
  /** Line to highlight briefly after it was just added or incremented. */
  flashedProductId?: string | null;
  /** Credit is only offered with a client attached — nobody to bill otherwise. */
  hasClient: boolean;
}) {
  const total = computeCartTotal(lines);
  const quickAmounts = quickCashAmounts(total);

  return (
    <div className="flex flex-col gap-sp-md">
      {lines.length === 0 ? (
        <div className="rounded-xl bg-card p-sp-2xl text-center shadow-card">
          <p className="font-heading font-semibold text-foreground">Le panier est vide</p>
          <p className="mt-sp-sm text-sm text-muted-foreground">
            Scannez un code-barres ou recherchez un produit.
          </p>
        </div>
      ) : (
        <ul className="space-y-sp-sm">
          {lines.map((line) => (
            <li
              key={line.productId}
              className={cn(
                "flex items-center gap-sp-md rounded-xl bg-card p-sp-md shadow-soft transition-colors duration-300",
                // Confirms the add even when it only bumped the quantity of
                // a line already in the cart, which is otherwise easy to miss.
                flashedProductId === line.productId && "bg-accent ring-2 ring-primary",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{line.productName}</p>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(line.unitPrice)} × {line.quantity}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-sp-xs">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Retirer une unité de ${line.productName}`}
                  className="size-10"
                  onClick={() =>
                    onChangeLines(setCartLineQuantity(lines, line.productId, line.quantity - 1))
                  }
                >
                  <Minus className="size-4" />
                </Button>
                <span className="w-10 text-center text-lg font-semibold tabular-nums">
                  {line.quantity}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Ajouter une unité de ${line.productName}`}
                  className="size-10"
                  disabled={line.quantity >= line.availableStock}
                  onClick={() =>
                    onChangeLines(setCartLineQuantity(lines, line.productId, line.quantity + 1))
                  }
                >
                  <Plus className="size-4" />
                </Button>
              </div>

              <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                {formatMoney(getLineTotal(line))}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Retirer ${line.productName} du panier`}
                className="size-10 text-muted-foreground hover:text-destructive"
                onClick={() => onChangeLines(removeFromCart(lines, line.productId))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Pinned to the bottom of the viewport so the total, the payment
          choice and the validate button stay reachable however long the
          cart grows — previously they scrolled off the end of the list. */}
      <div className="sticky bottom-0 z-10 space-y-sp-md rounded-xl bg-card p-sp-md shadow-card">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-medium text-muted-foreground">Total</span>
          <span className="font-heading text-4xl font-extrabold tabular-nums text-foreground">
            {formatMoney(total)}
            <span className="ml-sp-xs text-lg font-bold">MAD</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-sp-sm">
          <Button
            type="button"
            variant={paymentMethod === "CASH" ? "default" : "outline"}
            className="h-16 text-base"
            onClick={() => onChangePaymentMethod("CASH")}
          >
            <Banknote className="size-5" />
            Espèces
          </Button>
          <Button
            type="button"
            variant={paymentMethod === "CARD" ? "default" : "outline"}
            className="h-16 text-base"
            onClick={() => onChangePaymentMethod("CARD")}
          >
            <CreditCard className="size-5" />
            Carte
          </Button>
          {/* Full width: a credit sale is the exception, and it needs room
              to explain itself. Disabled without a client, with the reason
              stated rather than left to guesswork. */}
          <Button
            type="button"
            variant={paymentMethod === "CREDIT" ? "default" : "outline"}
            className="col-span-2 h-16 text-base"
            disabled={!hasClient}
            title={hasClient ? undefined : "Associez un client pour vendre à crédit"}
            onClick={() => onChangePaymentMethod("CREDIT")}
          >
            <UserRound className="size-5" />
            {hasClient ? "Crédit client (à payer plus tard)" : "Crédit client — associez un client"}
          </Button>
        </div>

        {paymentMethod === "CASH" && (
          <div className="space-y-sp-sm">
            <label
              htmlFor="cash-received"
              className="block text-sm font-medium text-muted-foreground"
            >
              Montant reçu du client
            </label>
            <input
              id="cash-received"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={cashReceived === 0 ? "" : cashReceived}
              onChange={(event) => onChangeCashReceived(Number(event.target.value) || 0)}
              placeholder="0,00"
              className="h-14 w-full rounded-lg bg-muted/60 px-sp-md text-right font-heading text-2xl font-bold tabular-nums text-foreground outline-none transition-colors focus:bg-muted focus:ring-2 focus:ring-ring"
            />

            <div className="flex flex-wrap gap-sp-sm">
              <Button
                type="button"
                variant="outline"
                className="h-12 flex-1 text-base"
                onClick={() => onChangeCashReceived(total)}
              >
                Compte juste
              </Button>
              {quickAmounts.map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant="outline"
                  className="h-12 flex-1 text-base tabular-nums"
                  onClick={() => onChangeCashReceived(amount)}
                >
                  {amount}
                </Button>
              ))}
            </div>

            <ChangeDisplay total={total} received={cashReceived} />
          </div>
        )}

        <Button
          type="button"
          size="lg"
          className="h-16 w-full text-lg"
          disabled={!canValidate || isSubmitting}
          onClick={onValidate}
        >
          {isSubmitting ? "Enregistrement..." : "Valider la vente"}
        </Button>
      </div>
    </div>
  );
}
