"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import type { Receipt } from "@/lib/offline/sales";
import { getReceiptBranding } from "@/lib/server/pharmacy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReceiptDocument } from "@/components/features/pos/receipt-document";

/**
 * Le ticket, en surimpression du comptoir.
 *
 * Il occupait une page entière, ce qui faisait disparaître la caisse le
 * temps de le lire : au comptoir on veut voir le ticket et retrouver
 * l'écran de vente derrière, pas naviguer. La boîte de dialogue ne se
 * ferme ni au clic extérieur ni par Échap — la vente est enregistrée, mais
 * fermer par mégarde ferait perdre l'occasion d'imprimer, et Échap sert
 * déjà à autre chose au comptoir.
 *
 * L'impression continue de fonctionner : la règle `@media print` de
 * globals.css n'affiche que `[data-print-area]`, où qu'il se trouve dans
 * le document — y compris dans le portail de la boîte de dialogue, dont
 * elle remet le positionnement à plat.
 */
export function ReceiptView({ receipt, onNewSale }: { receipt: Receipt; onNewSale: () => void }) {
  // Cached across sales: the letterhead barely changes, and refetching it
  // on every ticket would stall the screen the cashier needs immediately.
  const brandingQuery = useQuery({
    queryKey: ["receipt-branding"],
    queryFn: () => getReceiptBranding(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Vente enregistrée</DialogTitle>
          <DialogDescription>{receipt.createdAt.toLocaleString("fr-FR")}</DialogDescription>
        </DialogHeader>

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

        <DialogFooter className="print:hidden">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            Imprimer
          </Button>
          <Button type="button" onClick={onNewSale}>
            Nouvelle vente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
