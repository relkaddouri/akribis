"use client";

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { champsModifies, libelleAction, TYPES_ACTION } from "@/lib/audit/event-log";
import type { EventLogRecord } from "@/lib/server/audit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";

/**
 * Le journal d'audit, en lecture.
 *
 * Aucune action sur les lignes : le journal est en ajout seul, et une
 * interface qui offrirait un bouton « supprimer » suggérerait le contraire
 * de ce que la base garantit.
 */

function horodatage(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Une valeur d'instantané, rendue lisible sans devenir illisible. */
function valeur(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (typeof v === "object") return JSON.stringify(v);
  const texte = String(v);
  return texte.length > 120 ? `${texte.slice(0, 120)}…` : texte;
}

const TONS: Record<string, string> = {
  [TYPES_ACTION.catalogueProduitCree]:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  [TYPES_ACTION.catalogueProduitDesactive]:
    "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  [TYPES_ACTION.catalogueProduitReactive]:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

function ActionBadge({ typeAction }: { typeAction: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium",
        TONS[typeAction] ?? "bg-muted text-muted-foreground",
      )}
    >
      {libelleAction(typeAction)}
    </span>
  );
}

function Detail({ entree, onClose }: { entree: EventLogRecord | null; onClose: () => void }) {
  const changements = useMemo(
    () => (entree ? champsModifies(entree.avant, entree.apres) : []),
    [entree],
  );

  return (
    <Dialog open={entree !== null} onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entree ? libelleAction(entree.typeAction) : ""}</DialogTitle>
          <DialogDescription>
            {entree
              ? `${entree.cible ?? entree.entiteId} · ${entree.acteurEmail} · ${horodatage(entree.createdAt)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {changements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun champ n&apos;a changé entre l&apos;avant et l&apos;après.
          </p>
        ) : (
          <dl className="divide-y divide-border/60">
            {changements.map(({ champ, avant, apres }) => (
              <div key={champ} className="grid gap-x-sp-md py-sp-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-sm text-muted-foreground">{champ}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-sp-sm text-sm">
                  <span className="min-w-0 break-words text-muted-foreground line-through">
                    {valeur(avant)}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 break-words font-medium text-foreground">
                    {valeur(apres)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
      <Detail entree={ouverte} onClose={() => setOuverte(null)} />
    </>
  );
}
