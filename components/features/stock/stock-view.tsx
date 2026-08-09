"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { listProducts } from "@/lib/offline/products";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { StockAlerts } from "@/components/features/stock/stock-alerts";
import { ProductTable } from "@/components/features/stock/product-table";

const SEARCH_DEBOUNCE_MS = 300;

export function StockView() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const productsQuery = useQuery({
    queryKey: ["products", { search }],
    queryFn: () => listProducts({ search }),
  });

  const products = productsQuery.data ?? [];

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

      <StockAlerts products={products} />

      <div className="space-y-sp-md">
        {productsQuery.isError && (
          <p className="text-destructive text-sm">
            Impossible de charger les produits pour le moment.
          </p>
        )}

        <ProductTable
          products={products}
          isLoading={productsQuery.isLoading}
          search={searchInput}
          onSearchChange={setSearchInput}
        />
      </div>
    </div>
  );
}
