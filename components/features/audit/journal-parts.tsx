"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { champsModifies, libelleAction, TYPES_ACTION } from "@/lib/audit/event-log";
import type { EventLogRecord } from "@/lib/server/audit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Ce que les deux lectures du journal ont en commun.
 *
 * Il y en a deux : l'Admin Akribis, qui voit tout le journal, et le
 * titulaire, qui ne voit que son officine. Les colonnes et les filtres
 * diffèrent — « Administrateur » contre « Utilisateur », des actions
 * catalogue contre des actions clients — mais l'horodatage, la pastille
 * d'action et la fenêtre de détail sont les mêmes, et devaient l'être :
 * deux rendus divergents de la même entrée feraient douter de laquelle
 * dit vrai.
 */

export function horodatage(date: Date | string): string {
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
export function valeur(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (typeof v === "object") return JSON.stringify(v);
  const texte = String(v);
  return texte.length > 120 ? `${texte.slice(0, 120)}…` : texte;
}

/**
 * La couleur dit ce que l'action a fait, pas sur quoi elle a porté :
 * vert on ajoute, rouge on retire, gris on regarde. Une consultation
 * reste neutre — c'est la plus fréquente de toutes, et la teinter
 * ferait clignoter le tableau entier.
 */
const TONS: Record<string, string> = {
  [TYPES_ACTION.catalogueProduitCree]:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  [TYPES_ACTION.catalogueProduitDesactive]:
    "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  [TYPES_ACTION.catalogueProduitReactive]:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  [TYPES_ACTION.clientCree]:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  [TYPES_ACTION.clientSupprime]: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  [TYPES_ACTION.clientModifie]:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  [TYPES_ACTION.journalExporte]:
    "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

export function ActionBadge({ typeAction }: { typeAction: string }) {
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

export function JournalDetail({
  entree,
  onClose,
}: {
  entree: EventLogRecord | null;
  onClose: () => void;
}) {
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
