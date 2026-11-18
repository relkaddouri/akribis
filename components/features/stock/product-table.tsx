"use client";

import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import type { ProductRecord } from "@/lib/offline/products";
import { isLowStock, daysUntil } from "@/lib/stock/alerts";
import { Badge } from "@/components/ui/badge";
import { AvatarBadge } from "@/components/ui/avatar-badge";
import { CategorieBadge } from "@/components/features/catalogue/categorie-badge";
import { ProductActifSwitch } from "@/components/features/stock/product-actif-switch";
import { AComplete } from "@/components/features/stock/a-completer-badge";
import { prixAComplete } from "@/lib/stock/prix";
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

/**
 * Le libellé fin sous la pastille de famille : la classe thérapeutique
 * pour un médicament, la sous-catégorie pour la parapharmacie.
 *
 * La colonne n'affichait que `category` — la classe thérapeutique — qui
 * reste vide pour tout le rayon parapharmacie. Une officine voyait donc
 * « — » sur ses produits para, sans rien pour les distinguer des
 * médicaments.
 */
function sousLibelle(product: ProductRecord): string | null {
  return product.category ?? product.sousCategorie ?? null;
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
          <p className="flex items-center gap-2 font-medium text-foreground">
            {p.name}
            {/* Dit pourquoi le produit n'apparaît plus au comptoir. Sans
                cette mention, sa disparition du comptoir ressemble à un
                bug plutôt qu'à une décision. */}
            {!p.actifLocalement && <Badge variant="secondary">Retiré de la vente</Badge>}
          </p>
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
    // Famille d'abord, libellé fin ensuite : trier cette colonne sert à
    // regrouper les médicaments d'un côté et la parapharmacie de l'autre.
    // Les non classés se rangent en fin de liste plutôt qu'en tête.
    sortValue: (p) => `${p.categorie ?? "zzz"} ${sousLibelle(p) ?? ""}`.toLowerCase(),
    cell: (p) => (
      <div className="flex flex-col items-start gap-1">
        <CategorieBadge categorie={p.categorie} />
        {sousLibelle(p) && (
          <span className="text-sm text-muted-foreground">{sousLibelle(p)}</span>
        )}
      </div>
    ),
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
    // Les prix à zéro remontent en tête du tri croissant, ce qui est le
    // bon comportement : ce sont eux qu'on vient chercher.
    sortValue: (p) => p.price,
    // « 0.00 » se lit comme un prix. C'en est un : le produit passe en
    // caisse et rapporte zéro, à chaque vente. La pastille le dit.
    cell: (p) => (prixAComplete(p.price) ? <AComplete /> : p.price.toFixed(2)),
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
    id: "actif",
    header: "En vente",
    sortValue: (p) => (p.actifLocalement ? 1 : 0),
    // L'interrupteur plutôt qu'un badge : il dit l'état et permet de le
    // changer au même endroit. La confirmation vit dans le composant.
    cell: (p) => (
      <ProductActifSwitch
        productId={p.id}
        productName={p.name}
        value={p.actifLocalement}
        quantityInStock={p.quantityInStock}
      />
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

/** Exporté pour que les prédicats soient testables sans piloter un Select. */
export const filters: DataTableFilter<ProductRecord>[] = [
  {
    id: "famille",
    label: "Famille",
    // Options fixes, contrairement au filtre « Forme » : ces quatre-là
    // sont l'enum du catalogue, elles ne se déduisent pas du stock chargé.
    options: [
      { label: "Pharmaceutique", value: "PHARMACEUTIQUE" },
      { label: "Parapharmaceutique", value: "PARAPHARMACEUTIQUE" },
      { label: "Dispositif médical", value: "DISPOSITIF_MEDICAL" },
      // Sentinelle non vide : Radix refuse un SelectItem de valeur "".
      { label: "À classer", value: "NON_CLASSEE" },
    ],
    predicate: (p, value) =>
      value === "NON_CLASSEE" ? !p.categorie : p.categorie === value,
  },
  {
    id: "form",
    label: "Forme",
    options: [], // populated dynamically in StockView from the loaded products
    predicate: (p, value) => p.form === value,
  },
  {
    id: "disponibilite",
    label: "Disponibilité",
    options: [
      { label: "En vente", value: "actifs" },
      { label: "Retirés de la vente", value: "retires" },
    ],
    // Séparé du filtre « Statut », qui parle de niveau de stock : un
    // produit retiré de la vente peut très bien être en rupture, les deux
    // questions ne se répondent pas l'une l'autre.
    predicate: (p, value) => (value === "actifs" ? p.actifLocalement : !p.actifLocalement),
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
