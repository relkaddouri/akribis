"use client";

import { useMemo, useState } from "react";
import { libelleAction } from "@/lib/audit/event-log";
import type { EventLogRecord } from "@/lib/server/audit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import {
  ActionBadge,
  horodatage,
  JournalDetail,
} from "@/components/features/audit/journal-parts";

/**
 * Le journal d'audit, en lecture.
 *
 * Aucune action sur les lignes : le journal est en ajout seul, et une
 * interface qui offrirait un bouton « supprimer » suggérerait le contraire
 * de ce que la base garantit.
 */

export function JournalTable({ entrees }: { entrees: EventLogRecord[] }) {
  const [ouverte, setOuverte] = useState<EventLogRecord | null>(null);

  const columns = useMemo<DataTableColumn<EventLogRecord>[]>(
    () => [
      {
        id: "date",
        header: "Quand",
        sortValue: (e) => new Date(e.createdAt).getTime(),
        cell: (e) => <span className="tabular-nums text-sm">{horodatage(e.createdAt)}</span>,
      },
      {
        id: "action",
        header: "Action",
        sortValue: (e) => libelleAction(e.typeAction).toLowerCase(),
        cell: (e) => <ActionBadge typeAction={e.typeAction} />,
      },
      {
        id: "cible",
        header: "Fiche",
        sortValue: (e) => (e.cible ?? e.entiteId).toLowerCase(),
        cell: (e) => (
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{e.cible ?? "(fiche supprimée)"}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{e.entiteId}</p>
          </div>
        ),
      },
      {
        id: "acteur",
        header: "Administrateur",
        sortValue: (e) => e.acteurEmail.toLowerCase(),
        cell: (e) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{e.acteurEmail}</p>
            <Badge variant="secondary">{e.acteurRole}</Badge>
          </div>
        ),
      },
      {
        id: "detail",
        header: "",
        cell: (e) => (
          <Button variant="ghost" size="sm" onClick={() => setOuverte(e)}>
            Détail
          </Button>
        ),
      },
    ],
    [],
  );

  const filters = useMemo<DataTableFilter<EventLogRecord>[]>(() => {
    const actions = [...new Set(entrees.map((e) => e.typeAction))].sort();
    const acteurs = [...new Set(entrees.map((e) => e.acteurEmail))].sort();
    return [
      {
        id: "action",
        label: "Action",
        options: actions.map((a) => ({ label: libelleAction(a), value: a })),
        predicate: (e, value) => e.typeAction === value,
      },
      {
        id: "acteur",
        label: "Administrateur",
        options: acteurs.map((a) => ({ label: a, value: a })),
        predicate: (e, value) => e.acteurEmail === value,
      },
    ];
  }, [entrees]);

  return (
    <>
      <DataTable
        data={entrees}
        columns={columns}
        filters={filters}
        getRowId={(e) => e.id}
        // Rien à sélectionner : le journal ne se supprime pas, ne s'exporte
        // pas en lot, ne se traite pas. Des cases à cocher promettraient une
        // action qui n'existe pas.
        selectable={false}
        searchFields={(e) => [e.cible ?? "", e.acteurEmail, libelleAction(e.typeAction), e.entiteId]}
        searchPlaceholder="Rechercher par fiche, administrateur ou action..."
        emptyTitle="Aucune action enregistrée"
        emptyDescription="Le journal se remplit dès qu'une fiche du catalogue est créée, modifiée ou désactivée."
      />
      <JournalDetail entree={ouverte} onClose={() => setOuverte(null)} />
    </>
  );
}
