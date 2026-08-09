"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { addToCart, type CartLine } from "@/lib/pos/cart";
import { createSale, type Receipt } from "@/lib/offline/sales";
import type { ProductRecord } from "@/lib/offline/products";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { ProductSearch } from "@/components/features/pos/product-search";
import { CartPanel, type PaymentMethod } from "@/components/features/pos/cart-panel";
import { ReceiptView } from "@/components/features/pos/receipt-view";
import { ClientPicker, type SelectedClient } from "@/components/features/pos/client-picker";

export function PosView() {
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [client, setClient] = useState<SelectedClient>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, [receipt]);

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
      setClient(null);
      setWarning(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

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
    <div className="flex flex-col gap-sp-lg">
      <DashboardHeader title="Caisse" icon={<ShoppingCart />} />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-sp-md">
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
          onValidate={() => mutation.mutate()}
          isSubmitting={mutation.isPending}
        />
      </div>
    </div>
  );
}
