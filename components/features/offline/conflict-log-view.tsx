"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { clearConflicts, listConflicts } from "@/lib/offline/conflict-log";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const RESOLUTION_LABELS: Record<string, string> = {
  remote_wins: "Version serveur conservée",
  sync_rejected: "Synchronisation refusée",
  price_drift: "Écart de prix constaté",
  abandoned: "Abandonnée manuellement",
};

export function ConflictLogView() {
  const conflicts = useLiveQuery(() => listConflicts(), []);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-sp-sm">
          <CardTitle>Journal des conflits de synchronisation</CardTitle>
          {conflicts && conflicts.length > 0 && (
            // Safe to offer plainly, unlike discarding a queued write:
            // these are records of things already resolved, not data still
            // owed to the server.
            <Button variant="outline" size="sm" onClick={() => void clearConflicts()}>
              Effacer le journal
            </Button>
          )}
        </div>
        <CardDescription>
          Écritures faites hors-ligne et résolues automatiquement (dernière écriture gagnante) lors
          de la resynchronisation, et écarts de prix constatés au passage — ceux-ci sont signalés
          à titre indicatif, le montant facturé au client n&apos;est jamais recalculé.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!conflicts || conflicts.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucun conflit enregistré.</p>
        ) : (
          <ul className="space-y-sp-sm">
            {conflicts.map((conflict) => (
              <li key={conflict.id} className="rounded-md border p-sp-sm text-sm">
                <div className="mb-sp-xs flex items-center justify-between">
                  <Badge variant="outline">{RESOLUTION_LABELS[conflict.resolution] ?? conflict.resolution}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {conflict.resolvedAt.toLocaleString("fr-FR")}
                  </span>
                </div>
                <p>{conflict.detail}</p>
                <p className="text-muted-foreground mt-sp-xs text-xs">
                  Écriture locale du {conflict.clientTimestamp.toLocaleString("fr-FR")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
