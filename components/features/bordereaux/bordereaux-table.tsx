"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LIBELLES_BORDEREAU } from "@/lib/bordereaux/export";
import type { BordereauListItem } from "@/lib/server/bordereaux";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";

/**
 * La liste des bordereaux.
 *
 * L'ambre pour ce qui attend un geste de l'officine — un brouillon à
 * envoyer —, l'ardoise pour ce qui est parti chez l'organisme, l'émeraude
 * pour ce qui est encaissé. Mêmes teintes que les créances sur la page
 * Ventes : c'est le même argent, suivi à deux échelles.
 */

const TONS: Record<string, string> = {
  BROUILLON:
    "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  ENVOYE:
    "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  EN_TRAITEMENT:
    "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900",
  CLOTURE:
    "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
};

export function StatutBordereauBadge({ statut }: { statut: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONS[statut] ?? TONS.ENVOYE,
      )}
    >
      {LIBELLES_BORDEREAU[statut] ?? statut}
    </span>
  );
}

function jour(date: Date): string {
  return new Date(date).toLocaleDateString("fr-FR");
}

function dirham(valeur: number): string {
  return `${valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MAD`;
}

export function BordereauxTable({ bordereaux }: { bordereaux: BordereauListItem[] }) {
  const router = useRouter();

  const columns = useMemo<DataTableColumn<BordereauListItem>[]>(
    () => [
      {
        id: "numero",
        header: "Numéro",
        sortValue: (b) => b.numero,
        cell: (b) => <span className="font-medium text-foreground">{b.numero}</span>,
      },
      {
        id: "organisme",
        header: "Organisme",
        sortValue: (b) => b.insurerNom.toLowerCase(),
        cell: (b) => b.insurerNom,
      },
      {
        id: "periode",
        header: "Période couverte",
        sortValue: (b) => new Date(b.periodeDebut).getTime(),
        cell: (b) => (
          <span className="whitespace-nowrap tabular-nums">
            {jour(b.periodeDebut)} — {jour(b.periodeFin)}
          </span>
        ),
      },
      {
        id: "ventes",
        header: "Ventes",
        align: "right",
        sortValue: (b) => b.nombreVentes,
        cell: (b) => <span className="tabular-nums">{b.nombreVentes}</span>,
      },
      {
        id: "montant",
        header: "Montant réclamé",
        align: "right",
        sortValue: (b) => b.montantReclame,
        cell: (b) => <span className="tabular-nums">{dirham(b.montantReclame)}</span>,
      },
      {
        id: "statut",
        header: "Statut",
        sortValue: (b) => b.statut,
        cell: (b) => <StatutBordereauBadge statut={b.statut} />,
      },
    ],
    [],
  );

  const filters = useMemo<DataTableFilter<BordereauListItem>[]>(() => {
    // Les organismes viennent des bordereaux affichés : un filtre sur un
    // organisme dont aucun bordereau n'existe ne mènerait nulle part.
    const organismes = [...new Map(bordereaux.map((b) => [b.insurerId, b.insurerNom])).entries()];
    return [
      {
        id: "organisme",
        label: "Organisme",
        options: organismes.map(([id, nom]) => ({ label: nom, value: id })),
        predicate: (b, value) => b.insurerId === value,
      },
      {
        id: "statut",
        label: "Statut",
        options: Object.entries(LIBELLES_BORDEREAU).map(([value, label]) => ({ label, value })),
        predicate: (b, value) => b.statut === value,
      },
    ];
  }, [bordereaux]);

  return (
    <DataTable
      data={bordereaux}
      columns={columns}
      filters={filters}
      getRowId={(b) => b.id}
      selectable={false}
      onRowClick={(b) => router.push(`/bordereaux/${b.id}`)}
      searchFields={(b) => [b.numero, b.insurerNom]}
      searchPlaceholder="Rechercher par numéro ou organisme..."
      emptyTitle="Aucun bordereau"
      emptyDescription="Créez un bordereau pour réclamer à un organisme les ventes en tiers payant d'une période."
    />
  );
}
