"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageOff, Pencil } from "lucide-react";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CatalogueProduitRecord } from "@/lib/server/catalogue";
import { ADMIN_CATALOGUE_PATH } from "@/lib/auth/access-control";
import { CatalogueFlagSwitch } from "@/components/features/admin/catalogue-flag-switch";
import { PRODUIT_CATEGORIES } from "@/lib/validations/catalogue";
import { principalPhoto } from "@/lib/catalogue/photo-rules";
import { CategorieBadge } from "@/components/features/catalogue/categorie-badge";


function formatDirham(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

/**
 * The fiche's photo principale, or a neutral placeholder.
 *
 * Most of the 5 900 imported CNOPS fiches have no photo and never will —
 * "no photo" is the ordinary case here, not an error, so it gets the same
 * quiet grey tile as a product whose image is still loading. A broken
 * <img> falls back to the same tile: a URL can rot after the object is
 * removed from the bucket, and a torn icon in a table row helps nobody.
 */
function CatalogueThumbnail({ produit }: { produit: CatalogueProduitRecord }) {
  const photo = principalPhoto(produit.photos);
  const [failed, setFailed] = useState(false);

  if (!photo || failed) {
    return (
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        aria-hidden
      >
        <ImageOff className="size-4" strokeWidth={1.5} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset
    <img
      src={photo.url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-9 shrink-0 rounded-lg bg-muted object-cover"
    />
  );
}

/** Distinct non-null values, alphabetical — the filter lists exactly what exists. */
function distinct(values: (string | null)[]): { label: string; value: string }[] {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value)))];
  unique.sort((a, b) => a.localeCompare(b, "fr"));
  return unique.map((value) => ({ label: value, value }));
}

export function CatalogueTable({ produits }: { produits: CatalogueProduitRecord[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<DataTableColumn<CatalogueProduitRecord>[]>(
    () => [
      {
        id: "nom",
        header: "Produit",
        sortValue: (row) => row.nom.toLowerCase(),
        cell: (row) => (
          <div className="flex min-w-0 items-center gap-sp-sm">
            <CatalogueThumbnail produit={row} />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-medium text-foreground">{row.nom}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[row.dosage, row.formeGalenique].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: "codeBarres",
        header: "Code-barres",
        sortValue: (row) => row.codeBarres ?? "",
        cell: (row) =>
          row.codeBarres ? (
            <span className="font-mono text-xs text-muted-foreground">{row.codeBarres}</span>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-amber-600">Absent</span>
              </TooltipTrigger>
              <TooltipContent>
                Sans code-barres, cette fiche ne peut pas être dédoublonnée à l&apos;import.
              </TooltipContent>
            </Tooltip>
          ),
      },
      {
        id: "dci",
        header: "DCI",
        sortValue: (row) => row.dci ?? "",
        cell: (row) => <span className="text-sm">{row.dci ?? "—"}</span>,
      },
      {
        id: "laboratoire",
        header: "Laboratoire",
        sortValue: (row) => row.laboratoire ?? "",
        cell: (row) => <span className="text-sm">{row.laboratoire ?? "—"}</span>,
      },
      {
        id: "categorie",
        header: "Catégorie",
        // Une pastille plutôt qu'un mot : dans une liste de 5 918 lignes,
        // la teinte se reconnaît sans être lue.
        cell: (row) =>
          row.categorie ? (
            <CategorieBadge categorie={row.categorie} />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <CategorieBadge categorie={null} />
                </span>
              </TooltipTrigger>
              <TooltipContent>La catégorie détermine le taux de TVA applicable.</TooltipContent>
            </Tooltip>
          ),
      },
      {
        id: "ppv",
        header: "PPV",
        align: "right",
        sortValue: (row) => row.ppv ?? -1,
        cell: (row) => <span className="text-sm tabular-nums">{formatDirham(row.ppv)}</span>,
      },
      {
        id: "statut",
        header: "Actif",
        // L'interrupteur remplace badge + icône : il dit l'état et permet
        // de le changer au même endroit. La confirmation vit dans le
        // composant, la portée étant nationale.
        cell: (row) => (
          <CatalogueFlagSwitch
            produitId={row.id}
            flag="actifCatalogue"
            value={row.actifCatalogue}
            label={`${row.actifCatalogue ? "Désactiver" : "Réactiver"} ${row.nom}`}
            onError={setError}
          />
        ),
      },
    ],
    [],
  );

  const filters = useMemo<DataTableFilter<CatalogueProduitRecord>[]>(
    () => [
      {
        id: "categorie",
        label: "Catégorie",
        options: [
          ...PRODUIT_CATEGORIES.map((c) => ({ label: c.label, value: c.value })),
          { label: "À classer", value: "__none__" },
        ],
        predicate: (row, value) =>
          value === "__none__" ? row.categorie === null : row.categorie === value,
      },
      {
        id: "dci",
        label: "DCI",
        options: distinct(produits.map((produit) => produit.dci)),
        predicate: (row, value) => row.dci === value,
      },
      {
        id: "laboratoire",
        label: "Laboratoire",
        options: distinct(produits.map((produit) => produit.laboratoire)),
        predicate: (row, value) => row.laboratoire === value,
      },
      {
        id: "statut",
        label: "Statut",
        options: [
          { label: "Actif", value: "actif" },
          { label: "Inactif", value: "inactif" },
        ],
        predicate: (row, value) => row.actifCatalogue === (value === "actif"),
      },
    ],
    [produits],
  );

  return (
    <div className="space-y-sp-md">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={produits}
        getRowId={(row) => row.id}
        selectable={false}
        searchPlaceholder="Nom, code-barres, DCI, laboratoire..."
        searchFields={(row) => [row.nom, row.codeBarres, row.dci, row.laboratoire, row.dosage]}
        filters={filters}
        pageSize={20}
        // La ligne mène à la fiche de consultation ; seul le crayon ouvre l'édition.
        onRowClick={(row) => router.push(`${ADMIN_CATALOGUE_PATH}/${row.id}`)}
        emptyTitle="Catalogue vide"
        emptyDescription="Ajoutez une fiche ou importez un référentiel."
        rowActions={(row) => (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm">
                <Link
                  href={`${ADMIN_CATALOGUE_PATH}/${row.id}/modifier`}
                  aria-label={`Modifier ${row.nom}`}
                >
                  <Pencil className="size-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Modifier</TooltipContent>
          </Tooltip>
        )}
      />

    </div>
  );
}
