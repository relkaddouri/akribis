"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { listProducts } from "@/lib/offline/products";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { StockAlertBar, type StockScope } from "@/components/features/stock/stock-alert-bar";
import { ProductTable } from "@/components/features/stock/product-table";
import { getExpiryAlerts, getLowStockAlerts } from "@/lib/stock/alerts";
import { prixAComplete } from "@/lib/stock/prix";

const SEARCH_DEBOUNCE_MS = 300;

export function StockView() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<StockScope>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const productsQuery = useQuery({
    queryKey: ["products", { search }],
    queryFn: () => listProducts({ search }),
  });

  // Mémorisé : `?? []` fabrique un tableau neuf à chaque rendu, ce qui
  // ferait recalculer la restriction ci-dessous en boucle.
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  /**
   * Une pastille retenue restreint aussi le tableau, pour que les deux
   * cessent de se contredire : la barre classe et chiffre, le tableau
   * détaille — sur le même ensemble de lignes. Les filtres du tableau
   * continuent de jouer à l'intérieur de cette restriction.
   */
  const visibles = useMemo(() => {
    if (scope === null) return products;
    if (scope === "prix") return products.filter((p) => prixAComplete(p.price));
    const ids = new Set(
      (scope === "peremption"
        ? getExpiryAlerts(products, 30)
        : getLowStockAlerts(products)
      ).map((alerte) => alerte.productId),
    );
    return products.filter((p) => ids.has(p.id));
  }, [products, scope]);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Stock"
        icon={<Package />}
        actions={
          <Button asChild>
            <Link href="/dashboard/stock/produits/nouveau">Ajouter un produit</Link>
          </Button>
        }
      />

      <StockAlertBar products={products} scope={scope} onScopeChange={setScope} />

      <div className="space-y-sp-md">
        {productsQuery.isError && (
          <p className="text-destructive text-sm">
            Impossible de charger les produits pour le moment.
          </p>
        )}

        {scope !== null && (
          <p className="flex items-center gap-sp-sm text-sm text-muted-foreground">
            Tableau restreint à {visibles.length} produit{visibles.length > 1 ? "s" : ""}.
            <Button variant="ghost" size="sm" onClick={() => setScope(null)}>
              Tout afficher
            </Button>
          </p>
        )}

        <ProductTable
          products={visibles}
          isLoading={productsQuery.isLoading}
          search={searchInput}
          onSearchChange={setSearchInput}
        />
      </div>
    </div>
  );
}
