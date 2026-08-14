"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { TriangleAlert } from "lucide-react";
import {
  discardStalledSyncItems,
  listOutstandingSyncItems,
  type OutstandingSyncItem,
} from "@/lib/offline/sync-queue";
import { logConflict } from "@/lib/offline/conflict-log";
import type { SyncOperationType } from "@/lib/offline/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const OPERATION_LABELS: Record<SyncOperationType, string> = {
  createSale: "vente",
  updateProduct: "produit modifié",
  createProduct: "nouveau produit",
  receiveOrder: "réception de commande",
};

function describe(item: OutstandingSyncItem): string {
  return `${OPERATION_LABELS[item.type] ?? item.type} du ${item.clientTimestamp.toLocaleString("fr-FR")}`;
}

/**
 * The way out for a write that will never go through — typically one
 * referring to something the server no longer has.
 *
 * The queue never gives up on its own, which is the whole point of it, so
 * without this a permanently stuck write would sit in the badge for good
 * and train the pharmacist to ignore the badge. Discarding is therefore
 * possible but deliberately awkward: only stalled writes, only after
 * reading what is being thrown away, and always recorded in the conflict
 * log afterwards.
 */
export function SyncQueueMaintenance() {
  const outstanding = useLiveQuery(() => listOutstandingSyncItems(), []) ?? [];
  const stalled = outstanding.filter((item) => item.isStalled);
  const waiting = outstanding.filter((item) => !item.isStalled);
  const [discarded, setDiscarded] = useState<number | null>(null);

  async function handleDiscard() {
    const removed = await discardStalledSyncItems();
    // Logged after the fact, one entry per write: deleting pharmacy data
    // must never be the one thing that leaves no trace.
    for (const item of removed) {
      await logConflict({
        entityType: item.type === "createSale" ? "sale" : item.type === "receiveOrder" ? "order" : "product",
        entityId: item.entityId,
        queueItemId: item.id,
        clientTimestamp: item.clientTimestamp,
        resolution: "abandoned",
        detail: `${describe(item)} abandonnée manuellement après ${item.attempts} tentatives. Dernière erreur : ${item.lastError ?? "inconnue"}`,
      });
    }
    setDiscarded(removed.length);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>File de synchronisation</CardTitle>
        <CardDescription>
          Écritures faites sur cet appareil et pas encore confirmées par le serveur. Elles sont
          renvoyées automatiquement, indéfiniment — rien n&apos;est jamais abandonné tout seul.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-sp-md">
        {outstanding.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tout est synchronisé. Aucune écriture en attente.
          </p>
        ) : (
          <>
            {waiting.length > 0 && (
              <div className="space-y-sp-xs">
                <p className="text-sm font-medium text-foreground">
                  {waiting.length} en attente d&apos;envoi
                </p>
                <ul className="space-y-sp-xs text-sm text-muted-foreground">
                  {waiting.map((item) => (
                    <li key={item.id}>{describe(item)}</li>
                  ))}
                </ul>
              </div>
            )}

            {stalled.length > 0 && (
              <div className="space-y-sp-sm rounded-lg bg-destructive/10 p-sp-md">
                <p className="flex items-center gap-sp-xs text-sm font-semibold text-destructive">
                  <TriangleAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  {stalled.length} écriture{stalled.length > 1 ? "s" : ""} bloquée
                  {stalled.length > 1 ? "s" : ""}
                </p>
                <ul className="space-y-sp-sm text-sm">
                  {stalled.map((item) => (
                    <li key={item.id}>
                      <span className="block text-foreground">{describe(item)}</span>
                      {/* The last error is what tells you whether this can
                          ever succeed — without it the choice below is blind. */}
                      <span className="block text-xs text-muted-foreground">
                        {item.attempts} tentatives · {item.lastError ?? "erreur inconnue"}
                      </span>
                    </li>
                  ))}
                </ul>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      Abandonner ces écritures
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Abandonner {stalled.length} écriture{stalled.length > 1 ? "s" : ""} ?
                      </AlertDialogTitle>
                      <AlertDialogDescription asChild>
                        <div className="space-y-sp-sm">
                          <p>
                            Ces écritures ne seront jamais envoyées au serveur. Les données
                            correspondantes seront définitivement perdues :
                          </p>
                          <ul className="list-disc space-y-sp-xs pl-sp-md">
                            {stalled.map((item) => (
                              <li key={item.id}>{describe(item)}</li>
                            ))}
                          </ul>
                          <p>
                            À ne faire que si vous avez vérifié qu&apos;elles ne peuvent pas
                            aboutir. L&apos;abandon sera consigné dans le journal des conflits.
                          </p>
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleDiscard()}>
                        Abandonner définitivement
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </>
        )}

        {discarded !== null && (
          <p className="text-sm text-muted-foreground">
            {discarded} écriture{discarded > 1 ? "s" : ""} abandonnée{discarded > 1 ? "s" : ""} et
            consignée{discarded > 1 ? "s" : ""} dans le journal.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
