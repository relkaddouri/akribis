import Link from "next/link";
import { notFound } from "next/navigation";
import { Package, Pencil } from "lucide-react";
import { getProduct } from "@/lib/server/products";
import { getStockSheet } from "@/lib/server/stock-entry";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { StockDetailView } from "@/components/features/stock/stock-detail-view";
import { RefreshFromCatalogueButton } from "@/components/features/stock/refresh-from-catalogue-button";

/**
 * One sheet, one owner. Every field belongs to the pharmacy and is edited
 * through "Modifier" — there is no locked half. The page's job is to make
 * a long fiche readable: tabs on the same split as the admin catalogue
 * sheet, and gaps that matter told apart from gaps that don't.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  const sheet = await getStockSheet(id);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={product.name}
        subtitle={`${product.form}${product.dosage ? ` · ${product.dosage}` : ""}`}
        icon={<Package />}
        backHref="/dashboard/stock"
        backLabel="Stock"
        actions={
          <div className="flex flex-wrap items-center gap-sp-sm">
            {/* Dans l'en-tête, à côté de « Modifier » : enfoui en bas de page,
                personne ne découvrait qu'il existait. */}
            {product.catalogueProduitId && <RefreshFromCatalogueButton productId={product.id} />}
            <Button asChild>
              <Link href={`/dashboard/stock/produits/${product.id}/modifier`}>
                <Pencil className="size-4" />
                Modifier
              </Link>
            </Button>
          </div>
        }
      />

      <StockDetailView product={product} sheet={sheet} />
    </div>
  );
}
