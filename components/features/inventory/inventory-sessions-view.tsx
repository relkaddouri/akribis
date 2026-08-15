"use client";

import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useMutation } from "@tanstack/react-query";
import { Boxes, Plus } from "lucide-react";
import {
  listLocalSessions,
  listSessionCounts,
  startInventorySession,
  type LocalInventorySession,
} from "@/lib/offline/inventory";
import { buildVarianceReport } from "@/lib/inventory/variance";
import { formatMad } from "@/lib/invoices/totals";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

type SessionRow = LocalInventorySession & {
  countedCount: number;
  totalCount: number;
  varianceCount: number;
  varianceValue: number;
};

export function InventorySessionStatusBadge({ statut }: { statut: LocalInventorySession["statut"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-4xl px-sp-sm py-sp-xs text-xs font-medium whitespace-nowrap",
        statut === "en_cours"
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
      )}
    >
      {statut === "en_cours" ? "En cours" : "Terminé"}
    </span>
  );
}

const columns: DataTableColumn<SessionRow>[] = [
  {
    id: "date",
    header: "Démarré le",
    sortValue: (session) => session.dateDebut.getTime(),
    cell: (session) => (
      <span className="whitespace-nowrap font-medium text-foreground">
        {session.dateDebut.toLocaleString("fr-FR")}
      </span>
    ),
  },
  {
    id: "statut",
    header: "Statut",
    sortValue: (session) => session.statut,
    cell: (session) => <InventorySessionStatusBadge statut={session.statut} />,
  },
  {
    id: "progress",
    header: "Comptage",
    sortValue: (session) => session.countedCount,
    cell: (session) => (
      <span className="tabular-nums text-muted-foreground">
        {session.countedCount} / {session.totalCount}
      </span>
    ),
  },
  {
    id: "variances",
    header: "Écarts",
    align: "right",
    sortValue: (session) => session.varianceCount,
    cell: (session) =>
      session.varianceCount > 0 ? (
        <span className="tabular-nums">{session.varianceCount}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "value",
    header: "Valeur des écarts",
    align: "right",
    sortValue: (session) => session.varianceValue,
    cell: (session) => {
      if (session.varianceCount === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <span
          className={cn(
            "tabular-nums font-medium",
            // Signed on purpose: missing stock and surplus are different
            // problems, and the sign is the fastest way to tell them apart.
            session.varianceValue < 0
              ? "text-destructive"
              : "text-emerald-700 dark:text-emerald-300",
          )}
        >
          {session.varianceValue > 0 ? "+" : ""}
          {formatMad(session.varianceValue)}
        </span>
      );
    },
  },
];

const filters: DataTableFilter<SessionRow>[] = [
  {
    id: "statut",
    label: "Statut",
    options: [
      { label: "En cours", value: "en_cours" },
      { label: "Terminé", value: "termine" },
    ],
    predicate: (session, value) => session.statut === value,
  },
];

/**
 * Session history, read from Dexie so it stands up with no network.
 *
 * The figures are recomputed locally from the counts on the device rather
 * than fetched: the same numbers the count screen shows, from the same
 * source, so the two can't disagree.
 */
export function InventorySessionsView() {
  const router = useRouter();

  const rows = useLiveQuery(async () => {
    const sessions = await listLocalSessions();
    return Promise.all(
      sessions.map(async (session) => {
        const counts = await listSessionCounts(session.id);
        const report = buildVarianceReport(
          counts.map((count) => ({
            productId: count.productId,
            productName: count.productName,
            quantiteTheorique: count.quantiteTheorique,
            quantiteComptee: count.quantiteComptee,
            unitPrice: count.unitPrice,
          })),
        );
        return {
          ...session,
          countedCount: report.countedCount,
          totalCount: report.totalCount,
          varianceCount: report.lines.length,
          varianceValue: report.totalValeur,
        } satisfies SessionRow;
      }),
    );
  }, []);

  const start = useMutation({
    mutationFn: () => startInventorySession(),
    onSuccess: (session) => router.push(`/inventaire/${session.id}`),
  });

  const openSession = rows?.find((session) => session.statut === "en_cours");

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Inventaire"
        icon={<Boxes />}
        actions={
          <Button
            onClick={() => start.mutate()}
            // One open session at a time: two concurrent counts of the same
            // shelves would each freeze a different expected quantity and
            // produce two contradictory corrections.
            disabled={start.isPending || Boolean(openSession)}
          >
            <Plus className="size-4" />
            {start.isPending ? "Démarrage..." : "Démarrer un inventaire"}
          </Button>
        }
      />

      {openSession && (
        <p className="rounded-xl bg-card p-sp-md text-sm text-muted-foreground shadow-soft">
          Un inventaire est déjà en cours (démarré le{" "}
          {openSession.dateDebut.toLocaleString("fr-FR")}).{" "}
          <button
            type="button"
            onClick={() => router.push(`/inventaire/${openSession.id}`)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Reprendre le comptage
          </button>
        </p>
      )}

      <DataTable
        columns={columns}
        data={rows ?? []}
        getRowId={(session) => session.id}
        isLoading={rows === undefined}
        searchPlaceholder="Rechercher par date..."
        searchFields={(session) => [session.dateDebut.toLocaleString("fr-FR")]}
        filters={filters}
        selectable={false}
        onRowClick={(session) => router.push(`/inventaire/${session.id}`)}
        emptyTitle="Aucun inventaire"
        emptyDescription="Démarrez un inventaire pour compter votre stock, même sans connexion."
      />

    </div>
  );
}
