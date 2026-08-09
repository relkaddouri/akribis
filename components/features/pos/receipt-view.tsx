"use client";

import type { Receipt } from "@/lib/offline/sales";
import { Button } from "@/components/ui/button";

const PAYMENT_LABELS: Record<Receipt["paymentMethod"], string> = {
  CASH: "Espèces",
  CARD: "Carte",
};

export function ReceiptView({ receipt, onNewSale }: { receipt: Receipt; onNewSale: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        id="receipt"
        className="w-full max-w-sm rounded-md border p-6 font-mono text-sm print:border-none print:shadow-none"
      >
        <p className="mb-2 text-center font-semibold">Ticket de caisse</p>
        <p className="text-muted-foreground mb-4 text-center text-xs">
          {receipt.createdAt.toLocaleString("fr-FR")}
        </p>
        <div className="space-y-1 border-t border-dashed pt-2">
          {receipt.items.map((item) => (
            <div key={item.productId} className="flex justify-between gap-2">
              <span>
                {item.quantity} × {item.productName}
              </span>
              <span>{item.lineTotal.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between border-t border-dashed pt-2 font-semibold">
          <span>Total</span>
          <span>{receipt.totalAmount.toFixed(2)}</span>
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Paiement : {PAYMENT_LABELS[receipt.paymentMethod]}
        </p>
        {receipt.clientName && (
          <p className="text-muted-foreground text-xs">Client : {receipt.clientName}</p>
        )}
      </div>

      <div className="flex gap-2 print:hidden">
        <Button type="button" onClick={() => window.print()}>
          Imprimer
        </Button>
        <Button type="button" variant="outline" onClick={onNewSale}>
          Nouvelle vente
        </Button>
      </div>
    </div>
  );
}
