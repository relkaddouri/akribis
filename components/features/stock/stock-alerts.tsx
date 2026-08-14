"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardPlus } from "lucide-react";
import {
  EXPIRY_THRESHOLD_OPTIONS,
  getExpiryAlerts,
  getLowStockAlerts,
  type ExpiryThresholdDays,
  type ProductForAlerts,
} from "@/lib/stock/alerts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const alertRowClass =
  "flex items-center justify-between gap-sp-sm rounded-lg px-sp-sm py-sp-xs transition-colors hover:bg-muted";

/** Every alert row links straight to the product it's about. */
function ProductLink({
  productId,
  children,
}: {
  productId: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={`/dashboard/stock/produits/${productId}`} className={`${alertRowClass} flex-1`}>
      {children}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
    </Link>
  );
}

export function StockAlerts({ products }: { products: ProductForAlerts[] }) {
  const [expiryThreshold, setExpiryThreshold] = useState<ExpiryThresholdDays>(30);

  const lowStockAlerts = useMemo(() => getLowStockAlerts(products), [products]);
  const expiryAlerts = useMemo(
    () => getExpiryAlerts(products, expiryThreshold),
    [products, expiryThreshold],
  );

  return (
    <div className="grid gap-sp-md md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-sp-sm text-base">
            Stock bas
            <Badge variant={lowStockAlerts.length > 0 ? "destructive" : "secondary"}>
              {lowStockAlerts.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lowStockAlerts.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucune alerte de stock bas.</p>
          ) : (
            <ul className="-mx-sp-sm space-y-sp-xs text-sm">
              {lowStockAlerts.map((alert) => (
                <li key={alert.productId} className="flex items-center gap-sp-xs">
                  <ProductLink productId={alert.productId}>
                    <span className="truncate">{alert.productName}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">
                      {alert.quantityInStock} / seuil {alert.lowStockThreshold}
                    </span>
                  </ProductLink>
                  {/* Restocking is the action a low-stock alert almost
                      always leads to, so it gets its own shortcut rather
                      than making the user navigate there themselves. */}
                  <Link
                    href="/commandes/nouvelle"
                    aria-label={`Créer une commande pour ${alert.productName}`}
                    title="Créer une commande"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                  >
                    <ClipboardPlus className="size-4" strokeWidth={1.75} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-sp-sm text-base">
            <span className="flex items-center gap-sp-sm">
              Péremption proche
              <Badge variant={expiryAlerts.length > 0 ? "destructive" : "secondary"}>
                {expiryAlerts.length}
              </Badge>
            </span>
            <Select
              value={String(expiryThreshold)}
              onValueChange={(value) => setExpiryThreshold(Number(value) as ExpiryThresholdDays)}
            >
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_THRESHOLD_OPTIONS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} jours
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {expiryAlerts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aucun produit ne périme dans les {expiryThreshold} jours.
            </p>
          ) : (
            <ul className="-mx-sp-sm space-y-sp-xs text-sm">
              {expiryAlerts.map((alert) => (
                <li key={alert.productId}>
                  <ProductLink productId={alert.productId}>
                    <span className="truncate">{alert.productName}</span>
                    <span
                      className={`ml-auto shrink-0 ${
                        alert.daysUntilExpiry < 0 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {alert.daysUntilExpiry < 0
                        ? `Périmé depuis ${Math.abs(alert.daysUntilExpiry)} j`
                        : `Dans ${alert.daysUntilExpiry} j`}
                    </span>
                  </ProductLink>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
