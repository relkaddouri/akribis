"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Boxes, CheckCircle2, ClipboardCheck } from "lucide-react";
import {
  applyAdjustments,
  getLocalSession,
  listSessionCounts,
  recordCount,
  type LocalInventoryCount,
} from "@/lib/offline/inventory";
import { buildVarianceReport, type CountLine } from "@/lib/inventory/variance";
import { listProducts, type ProductRecord } from "@/lib/offline/products";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { InventorySessionStatusBadge } from "@/components/features/inventory/inventory-sessions-view";
import { InventoryVarianceReport } from "@/components/features/inventory/inventory-variance-report";

/** A count line joined to its product, for searching by barcode and DCI. */
type CountRow = LocalInventoryCount & {
  barcode: string | null;
  dci: string | null;
  category: string | null;
};

function CountInput({
  row,
  disabled,
  onCommit,
}: {
  row: CountRow;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string>(
    row.quantiteComptee === null ? "" : String(row.quantiteComptee),
  );

  function commit() {
    const parsed = Number(draft);
    // An empty box means "not counted yet", which is not the same as a
    // shelf found empty — only a real number is a count.
    if (draft.trim() === "" || Number.isNaN(parsed) || parsed < 0) return;
    if (parsed === row.quantiteComptee) return;
    onCommit(Math.floor(parsed));
  }

  return (
    <Input
      type="number"
      min={0}
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      aria-label={`Quantité comptée pour ${row.productName}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          // Scanners send Enter after the code; blurring moves focus on so
          // the next scan doesn't overwrite the line just counted.
          (event.target as HTMLInputElement).blur();
        }
      }}
      className="w-24"
    />
  );
}

export function InventoryCountView({ sessionId }: { sessionId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  const session = useLiveQuery(() => getLocalSession(sessionId), [sessionId]);

  const rows = useLiveQuery(async () => {
    const [counts, products] = await Promise.all([listSessionCounts(sessionId), listProducts()]);
    const byId = new Map<string, ProductRecord>(products.map((product) => [product.id, product]));
    return counts.map((count) => {
      const product = byId.get(count.productId);
      return {
        ...count,
        barcode: product?.barcode ?? null,
        dci: product?.dci ?? null,
        category: product?.category ?? null,
      } satisfies CountRow;
    });
  }, [sessionId]);

  const report = useMemo(() => {
    const lines: CountLine[] = (rows ?? []).map((row) => ({
      productId: row.productId,
      productName: row.productName,
      quantiteTheorique: row.quantiteTheorique,
      quantiteComptee: row.quantiteComptee,
      unitPrice: row.unitPrice,
    }));
    return buildVarianceReport(lines);
  }, [rows]);

  const isClosed = session?.statut === "termine";

  const categoryFilters: DataTableFilter<CountRow>[] = useMemo(() => {
    const categories = [...new Set((rows ?? []).map((row) => row.category).filter(Boolean))];
    if (categories.length === 0) return [];
    return [
      {
        id: "category",
        label: "Catégorie",
        options: categories
          .map((category) => ({ label: category as string, value: category as string }))
          .sort((a, b) => a.label.localeCompare(b.label, "fr")),
        predicate: (row, value) => row.category === value,
      },
      {
        id: "etat",
        label: "État",
        options: [
          { label: "À compter", value: "todo" },
          { label: "Comptés", value: "done" },
          { label: "En écart", value: "variance" },
        ],
        predicate: (row, value) => {
          if (value === "todo") return row.quantiteComptee === null;
          if (value === "done") return row.quantiteComptee !== null;
          return row.quantiteComptee !== null && row.quantiteComptee !== row.quantiteTheorique;
        },
      },
    ];
  }, [rows]);

  async function handleCount(row: CountRow, value: number) {
    setError(null);
    try {
      await recordCount(sessionId, row.productId, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comptage impossible.");
    }
  }

  const columns: DataTableColumn<CountRow>[] = useMemo(
    () => [
      {
        id: "product",
        header: "Produit",
        sortValue: (row) => row.productName.toLowerCase(),
        cell: (row) => (
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{row.productName}</span>
            {row.barcode && (
              <span className="block text-xs text-muted-foreground">{row.barcode}</span>
            )}
          </span>
        ),
      },
      {
        id: "theorique",
        header: "Stock théorique",
        align: "right",
        sortValue: (row) => row.quantiteTheorique,
        cell: (row) => <span className="tabular-nums">{row.quantiteTheorique}</span>,
      },
      {
        id: "comptee",
        header: "Quantité comptée",
        align: "right",
        sortValue: (row) => row.quantiteComptee ?? -1,
        cell: (row) => (
          <div className="flex justify-end">
            <CountInput
              key={`${row.id}-${row.quantiteComptee}`}
              row={row}
              disabled={isClosed}
              onCommit={(value) => void handleCount(row, value)}
            />
          </div>
        ),
      },
      {
        id: "ecart",
        header: "Écart",
        align: "right",
        sortValue: (row) => (row.quantiteComptee ?? row.quantiteTheorique) - row.quantiteTheorique,
        cell: (row) => {
          if (row.quantiteComptee === null) {
            return <span className="text-muted-foreground">—</span>;
          }
          const ecart = row.quantiteComptee - row.quantiteTheorique;
          if (ecart === 0) {
            return (
              <CheckCircle2
                className="ml-auto size-4 text-emerald-600 dark:text-emerald-400"
                strokeWidth={1.75}
                aria-label="Conforme"
              />
            );
          }
          return (
            <span
              className={cn(
                "tabular-nums font-medium",
                ecart < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300",
              )}
            >
              {ecart > 0 ? "+" : ""}
              {ecart}
            </span>
          );
        },
      },
    ],
    // handleCount is stable enough for this table; isClosed is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isClosed],
  );

  const progressPct =
    report.totalCount === 0 ? 0 : Math.round((report.countedCount / report.totalCount) * 100);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Comptage d'inventaire"
        subtitle={session ? session.dateDebut.toLocaleString("fr-FR") : undefined}
        icon={<Boxes />}
        backHref="/inventaire"
        backLabel="Inventaire"
        actions={
          <div className="flex items-center gap-sp-sm">
            {session && <InventorySessionStatusBadge statut={session.statut} />}
            <Button variant="outline" onClick={() => setShowReport((open) => !open)}>
              <ClipboardCheck className="size-4" />
              {showReport ? "Masquer le rapport" : "Voir le rapport d'écarts"}
            </Button>
          </div>
        }
      />

      {session === null && (
        <Alert variant="destructive">
          <AlertDescription>
            Cette session d&apos;inventaire n&apos;existe pas sur cet appareil. Elle a peut-être
            été créée ailleurs — ouvrez-la depuis l&apos;appareil qui l&apos;a démarrée.
          </AlertDescription>
        </Alert>
      )}

      {session && (
        <section className="space-y-sp-sm rounded-xl bg-card p-sp-md shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-sp-sm text-sm">
            <span className="font-medium text-foreground">
              {report.countedCount} produit{report.countedCount > 1 ? "s" : ""} compté
              {report.countedCount > 1 ? "s" : ""} sur {report.totalCount}
            </span>
            <span className="text-muted-foreground">
              {report.lines.length} écart{report.lines.length > 1 ? "s" : ""} détecté
              {report.lines.length > 1 ? "s" : ""}
            </span>
          </div>
          {/* Progress is computed from the local counts, so it keeps moving
              with no network — the number a stocktaker actually watches. */}
          <div
            className="h-2 w-full overflow-hidden rounded-4xl bg-muted"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progression du comptage"
          >
            <div
              className="h-full rounded-4xl bg-primary transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </section>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showReport && session && (
        <InventoryVarianceReport
          report={report}
          readOnly={isClosed}
          onApply={async () => {
            setError(null);
            try {
              await applyAdjustments(sessionId);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Ajustement impossible.");
            }
          }}
        />
      )}

      <DataTable
        columns={columns}
        data={rows ?? []}
        getRowId={(row) => row.id}
        isLoading={rows === undefined}
        searchPlaceholder="Rechercher par nom, code-barres ou DCI..."
        // Entirely local: the search runs over what Dexie already holds.
        searchFields={(row) => [row.productName, row.barcode, row.dci]}
        filters={categoryFilters}
        selectable={false}
        emptyTitle="Aucun produit"
        emptyDescription="Cette session ne contient aucun produit à compter."
      />
    </div>
  );
}
