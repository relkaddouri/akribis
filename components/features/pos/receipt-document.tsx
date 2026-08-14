import type { Receipt } from "@/lib/server/sales";
import type { ReceiptBranding } from "@/lib/server/pharmacy";
import { cn } from "@/lib/utils";

const PAYMENT_LABELS: Record<Receipt["paymentMethod"], string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CREDIT: "Crédit client (à payer plus tard)",
};

/**
 * The receipt exactly as it prints — the single source of truth for the
 * ticket layout, rendered both by the till after a sale and by the
 * settings preview. Keeping one component is what makes the preview
 * trustworthy: a pharmacist who tweaks the legal notice sees the real
 * document, not an approximation that can drift from it.
 *
 * `data-print-area` is the hook the print stylesheet uses to keep this
 * subtree — and only this subtree — on the page.
 */
export function ReceiptDocument({
  branding,
  receipt,
  className,
}: {
  branding: ReceiptBranding;
  receipt: Receipt;
  className?: string;
}) {
  return (
    <div
      data-print-area
      className={cn(
        "w-full max-w-sm rounded-xl bg-card p-sp-lg font-mono text-sm text-foreground shadow-card",
        "print:max-w-none print:rounded-none print:p-0 print:shadow-none",
        className,
      )}
    >
      <header className="space-y-sp-xs text-center">
        {branding.showLogo && branding.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, same call as product-table.tsx
          <img
            src={branding.logoUrl}
            alt=""
            className="mx-auto max-h-16 w-auto object-contain"
          />
        )}
        <p className="font-sans text-base font-bold">{branding.pharmacyName}</p>
        {branding.address && <p className="text-xs">{branding.address}</p>}
        {branding.phone && <p className="text-xs">Tél. {branding.phone}</p>}
        {branding.ice && <p className="text-xs">ICE : {branding.ice}</p>}
      </header>

      <p className="mt-sp-md text-center font-semibold">Ticket de caisse</p>
      <p className="text-center text-xs text-muted-foreground">
        {receipt.createdAt.toLocaleString("fr-FR")}
      </p>

      <div className="mt-sp-sm space-y-sp-xs border-t border-dashed pt-sp-sm">
        {receipt.items.map((item) => (
          <div key={item.productId} className="flex justify-between gap-sp-sm">
            <span className="min-w-0 truncate">
              {item.quantity} × {item.productName}
            </span>
            <span className="shrink-0 tabular-nums">{item.lineTotal.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="mt-sp-sm flex justify-between border-t border-dashed pt-sp-sm text-base font-bold">
        <span>Total</span>
        <span className="tabular-nums">{receipt.totalAmount.toFixed(2)}</span>
      </div>

      <p className="mt-sp-sm text-xs text-muted-foreground">
        Paiement : {PAYMENT_LABELS[receipt.paymentMethod]}
      </p>
      {receipt.clientName && (
        <p className="text-xs text-muted-foreground">Client : {receipt.clientName}</p>
      )}

      {(branding.legalNotice || branding.thankYouMessage) && (
        <footer className="mt-sp-md space-y-sp-xs border-t border-dashed pt-sp-sm text-center text-xs">
          {branding.thankYouMessage && <p className="font-medium">{branding.thankYouMessage}</p>}
          {branding.legalNotice && (
            <p className="whitespace-pre-wrap text-muted-foreground">{branding.legalNotice}</p>
          )}
        </footer>
      )}
    </div>
  );
}
