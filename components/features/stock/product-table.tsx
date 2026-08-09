"use client";

import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import type { ProductRecord } from "@/lib/offline/products";
import { isLowStock, daysUntil } from "@/lib/stock/alerts";
import { Badge } from "@/components/ui/badge";
import { AvatarBadge } from "@/components/ui/avatar-badge";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";

const NEAR_EXPIRY_THRESHOLD_DAYS = 90;

function formatExpiry(date: Date | string | null): string {
  if (!date) return "—";
  const parsed = typeof date === "string" ? new Date(date) : date;
  return parsed.toLocaleDateString("fr-FR");
}

function isNearExpiry(product: ProductRecord): boolean {
  if (!product.nearestExpiryDate) return false;
  return daysUntil(new Date(product.nearestExpiryDate)) <= NEAR_EXPIRY_THRESHOLD_DAYS;
}

function ProductThumbnail({ product }: { product: ProductRecord }) {
  if (product.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset
      <img
        src={product.photoUrl}
        alt={product.name}
        className="size-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return <AvatarBadge name={product.name} />;
}

const columns: DataTableColumn<ProductRecord>[] = [
  {
    id: "name",
    header: "Nom",
    sortValue: (p) => p.name.toLowerCase(),
    cell: (p) => (
      <Link
        href={`/dashboard/stock/produits/${p.id}`}
        className="flex items-center gap-3 hover:underline"
      >
        <ProductThumbnail product={p} />
        <div>
          <p className="font-medium text-foreground">{p.name}</p>
          <p className="text-sm text-muted-foreground">
            {p.form}
            {p.dosage ? ` · ${p.dosage}` : ""}
          </p>
        </div>
      </Link>
    ),
  },
  {
    id: "category",
    header: "Catégorie",
    sortValue: (p) => p.category?.toLowerCase() ?? "",
    cell: (p) => (p.category ? <Badge variant="secondary">{p.category}</Badge> : "—"),
  },
  {
    id: "laboratory",
    header: "Laboratoire",
    sortValue: (p) => p.laboratory?.toLowerCase() ?? "",
    cell: (p) => p.laboratory ?? "—",
  },
  {
    id: "barcode",
    header: "Code-barres",
    cell: (p) => p.barcode ?? "—",
  },
  {
    id: "price",
    header: "Prix",
    sortValue: (p) => p.price,
    cell: (p) => p.price.toFixed(2),
  },
  {
    id: "stock",
    header: "Stock",
    sortValue: (p) => p.quantityInStock,
    cell: (p) => (
      <span className="flex items-center gap-2">
        {p.quantityInStock}
        {isLowStock(p) && <Badge variant="destructive">Stock bas</Badge>}
      </span>
    ),
  },
  {
    id: "expiry",
    header: "Péremption",
    sortValue: (p) => (p.nearestExpiryDate ? new Date(p.nearestExpiryDate).getTime() : Infinity),
    cell: (p) => (
      <span className="flex items-center gap-2">
        {formatExpiry(p.nearestExpiryDate)}
        {isNearExpiry(p) && <Badge variant="destructive">Proche</Badge>}
      </span>
    ),
  },
];

const filters: DataTableFilter<ProductRecord>[] = [
  {
    id: "form",
    label: "Forme",
    options: [], // populated dynamically in StockView from the loaded products
    predicate: (p, value) => p.form === value,
  },
  {
    id: "stockStatus",
    label: "Statut",
    options: [
      { label: "Rupture", value: "out" },
      { label: "Stock bas", value: "low" },
      { label: "Normal", value: "ok" },
    ],
    predicate: (p, value) => {
      if (value === "out") return p.quantityInStock === 0;
      if (value === "low") return isLowStock(p) && p.quantityInStock > 0;
      return !isLowStock(p);
    },
  },
];

export function ProductTable({
  products,
  isLoading,
  search,
  onSearchChange,
}: {
  products: ProductRecord[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const forms = Array.from(new Set(products.map((p) => p.form))).sort();
  const tableFilters = filters.map((filter) =>
    filter.id === "form" ? { ...filter, options: forms.map((f) => ({ label: f, value: f })) } : filter,
  );

  return (
    <DataTable
      columns={columns}
      data={products}
      getRowId={(p) => p.id}
      isLoading={isLoading}
      searchPlaceholder="Rechercher par nom, code-barres ou DCI..."
      searchValue={search}
      onSearchChange={onSearchChange}
      filters={tableFilters}
      emptyTitle="Aucun produit"
      emptyDescription="Ajoutez votre premier produit pour commencer."
      rowActions={(p) => (
        <>
          <Link
            href={`/dashboard/stock/produits/${p.id}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Voir le produit"
          >
            <Eye className="size-4" />
          </Link>
          <Link
            href={`/dashboard/stock/produits/${p.id}/modifier`}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Modifier le produit"
          >
            <Pencil className="size-4" />
          </Link>
        </>
      )}
    />
  );
}
