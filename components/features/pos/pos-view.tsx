"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { addToCart, computeCartTotal, type CartLine } from "@/lib/pos/cart";
import { computeChange } from "@/lib/pos/change";
import { createSale, type Receipt } from "@/lib/offline/sales";
import type { ProductRecord } from "@/lib/offline/products";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { ProductSearch } from "@/components/features/pos/product-search";
import { CartPanel, type PaymentMethod } from "@/components/features/pos/cart-panel";
import { ReceiptView } from "@/components/features/pos/receipt-view";
import { ClientPicker, type SelectedClient } from "@/components/features/pos/client-picker";

/** How long an added line stays highlighted. */
const FLASH_MS = 700;

export function PosView() {
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [cashReceived, setCashReceived] = useState(0);
  const [client, setClient] = useState<SelectedClient>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** Product id of the line to highlight after an add, cleared on a timer. */
  const [flashedProductId, setFlashedProductId] = useState<string | null>(null);

  const total = computeCartTotal(lines);
  // A card payment is settled by the terminal, so only cash has to be
  // covered before the sale can be validated.
  const cashCovers =
    paymentMethod !== "CASH" || cashReceived === 0 || computeChange(total, cashReceived).isSufficient;
  const canValidate = lines.length > 0 && paymentMethod !== null && cashCovers;

  // Dropping the client invalidates a credit sale: there would be no
  // account left to charge.
  useEffect(() => {
    if (client === null && paymentMethod === "CREDIT") setPaymentMethod(null);
  }, [client, paymentMethod]);

  useEffect(() => {
    // Focus on mount and again after each completed sale, so the next
    // customer can be scanned straight away without reaching for the mouse.
    searchInputRef.current?.focus();
  }, [receipt]);

  useEffect(() => {
    if (!flashedProductId) return;
    const timeout = setTimeout(() => setFlashedProductId(null), FLASH_MS);
    return () => clearTimeout(timeout);
  }, [flashedProductId]);

  const mutation = useMutation({
    mutationFn: () =>
      createSale({
        paymentMethod: paymentMethod!,
        clientId: client?.id,
        clientName: client?.name,
        items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      }),
    onSuccess: (result) => {
      setReceipt(result);
      setLines([]);
      setPaymentMethod(null);
      setCashReceived(0);
      setClient(null);
      setWarning(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const clearCart = useCallback(() => {
    setLines([]);
    setPaymentMethod(null);
    setCashReceived(0);
    setWarning(null);
    searchInputRef.current?.focus();
  }, []);

  /**
   * Till-wide shortcuts. Both are bound on the container rather than the
   * window so they only fire while the POS is on screen; the search field
   * and the client picker stop their own Enter/Escape from bubbling here,
   * which keeps "add this product" and "close this dropdown" working.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      if (!canValidate || mutation.isPending) return;
      event.preventDefault();
      mutation.mutate();
      return;
    }
    if (event.key === "Escape" && lines.length > 0) {
      event.preventDefault();
      clearCart();
    }
  }

  function handleSelectProduct(product: ProductRecord) {
    // Functional update: onSelect can fire from an async keydown handler
    // (barcode fast-path), so a scan-add landing while another update is
    // still in flight must build on the latest state, not a stale
    // `lines` closure that would silently clobber it.
    let capped = false;
    setLines((prevLines) => {
      const result = addToCart(prevLines, {
        id: product.id,
        name: product.name,
        price: product.price,
        quantityInStock: product.quantityInStock,
      });
      capped = result.capped;
      return result.lines;
    });
    setWarning(
      capped
        ? product.quantityInStock <= 0
          ? `Rupture de stock : "${product.name}".`
          : `Stock limité pour "${product.name}" (${product.quantityInStock} disponible(s)).`
        : null,
    );
    setFlashedProductId(product.id);
    searchInputRef.current?.focus();
  }

  function handleNewSale() {
    setReceipt(null);
    mutation.reset();
  }

  if (receipt) {
    return <ReceiptView receipt={receipt} onNewSale={handleNewSale} />;
  }

  return (
    <div className="flex flex-col gap-sp-lg" onKeyDown={handleKeyDown}>
      <DashboardHeader title="Caisse" icon={<ShoppingCart />} />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-sp-md">
        <ProductSearch ref={searchInputRef} onSelect={handleSelectProduct} />

        <ClientPicker value={client} onChange={setClient} />

        {warning && (
          <Alert variant="destructive">
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}

        {mutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>{(mutation.error as Error).message}</AlertDescription>
          </Alert>
        )}

        <CartPanel
          lines={lines}
          onChangeLines={setLines}
          paymentMethod={paymentMethod}
          onChangePaymentMethod={setPaymentMethod}
          cashReceived={cashReceived}
          onChangeCashReceived={setCashReceived}
          onValidate={() => mutation.mutate()}
          isSubmitting={mutation.isPending}
          canValidate={canValidate}
          flashedProductId={flashedProductId}
          hasClient={client !== null}
        />

        <p className="text-center text-xs text-muted-foreground">
          <kbd className="rounded border border-border bg-card px-sp-xs py-0.5 font-medium">
            Entrée
          </kbd>{" "}
          valider la vente ·{" "}
          <kbd className="rounded border border-border bg-card px-sp-xs py-0.5 font-medium">
            Échap
          </kbd>{" "}
          vider le panier
        </p>
      </div>
    </div>
  );
}
