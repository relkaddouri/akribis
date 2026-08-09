import type { TopSellingProduct } from "@/lib/server/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Deliberately not a charting library: a handful of horizontal bars
 * sized with plain CSS is all "top 10 products" needs, per the brief
 * ("pas besoin de librairie de charts complexe").
 */
export function TopProductsChart({ products }: { products: TopSellingProduct[] }) {
  const maxQuantity = Math.max(1, ...products.map((product) => product.quantitySold));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 10 des ventes (30 derniers jours)</CardTitle>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune vente sur les 30 derniers jours.</p>
        ) : (
          <ul className="space-y-3">
            {products.map((product, index) => (
              <li key={product.productId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {index + 1}. {product.productName}
                  </span>
                  <span className="text-muted-foreground">{product.quantitySold} vendus</span>
                </div>
                <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${(product.quantitySold / maxQuantity) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
