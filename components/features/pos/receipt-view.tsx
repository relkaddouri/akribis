"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer, ShoppingCart } from "lucide-react";
import type { Receipt } from "@/lib/offline/sales";
import { getReceiptBranding } from "@/lib/server/pharmacy";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { ReceiptDocument } from "@/components/features/pos/receipt-document";

export function ReceiptView({ receipt, onNewSale }: { receipt: Receipt; onNewSale: () => void }) {
  // Cached across sales: the letterhead barely changes, and refetching it
  // on every ticket would stall the screen the cashier needs immediately.
  const brandingQuery = useQuery({
    queryKey: ["receipt-branding"],
    queryFn: () => getReceiptBranding(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="flex flex-col gap-sp-lg">
      <DashboardHeader
        title="Vente enregistrée"
        subtitle={receipt.createdAt.toLocaleString("fr-FR")}
        icon={<ShoppingCart />}
        actions={
          <div className="flex gap-sp-sm">
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Printer className="size-4" />
              Imprimer
            </Button>
            <Button type="button" onClick={onNewSale}>
              Nouvelle vente
            </Button>
          </div>
        }
      />

      <div className="flex justify-center">
        {brandingQuery.data ? (
          <ReceiptDocument branding={brandingQuery.data} receipt={receipt} />
        ) : (
          // The sale is already recorded at this point, so a slow or failed
          // branding fetch must never hide the ticket — it degrades to the
          // pharmacy-less layout rather than blocking the counter.
          <ReceiptDocument
            branding={{
              pharmacyName: brandingQuery.isLoading ? "" : "Pharmacie",
              address: null,
              phone: null,
              ice: null,
              logoUrl: null,
              showLogo: false,
              legalNotice: null,
              thankYouMessage: null,
            }}
            receipt={receipt}
          />
        )}
      </div>
    </div>
  );
}
