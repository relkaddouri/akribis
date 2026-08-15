"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudUpload } from "lucide-react";
import {
  findProductsMissingFromServer,
  resyncProductsMissingFromServer,
} from "@/lib/offline/products";
import { useSyncStatus } from "@/components/features/offline/use-sync-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Pushes up products that only ever existed on this device.
 *
 * The sync engine reconciles in one direction only — it pulls the server's
 * products into the cache — so a `createProduct` write that was lost (the
 * old silent-drop bug, or a hand-discarded queue item) leaves a product
 * that is local for ever. It looks perfectly normal in Stock and at the
 * till, then breaks the moment another module references it server-side:
 * an inventory session over such a product failed on a foreign key and
 * could not open at all.
 *
 * Deliberately manual rather than automatic on every pass: uploading rows
 * the server never asked for is not something to do behind the
 * pharmacist's back, and the count alone is worth seeing.
 */
export function ProductResync() {
  const { status } = useSyncStatus();
  const queryClient = useQueryClient();
  const [done, setDone] = useState<{ queued: number; alreadyQueued: number } | null>(null);

  const missing = useQuery({
    queryKey: ["products-missing-from-server"],
    queryFn: () => findProductsMissingFromServer(),
    // Needs the server's list to compare against; pointless with no network.
    enabled: status !== "offline",
    retry: false,
  });

  const push = useMutation({
    mutationFn: () => resyncProductsMissingFromServer(),
    onSuccess: (result) => {
      setDone(result);
      queryClient.invalidateQueries({ queryKey: ["products-missing-from-server"] });
    },
  });

  const pushable = missing.data?.pushable ?? [];
  const duplicates = missing.data?.duplicates ?? [];
  const nothingToDo = pushable.length === 0 && duplicates.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Produits présents seulement sur cet appareil</CardTitle>
        <CardDescription>
          Produits enregistrés localement que le serveur n&apos;a jamais reçus. Tant qu&apos;ils
          ne sont pas envoyés, ils fonctionnent en caisse et en stock, mais restent invisibles
          des autres postes et ne peuvent pas être inventoriés.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-sp-md">
        {status === "offline" ? (
          <p className="text-sm text-muted-foreground">
            Vérification impossible hors ligne — elle demande la liste du serveur.
          </p>
        ) : missing.isLoading ? (
          <p className="text-sm text-muted-foreground">Comparaison en cours...</p>
        ) : missing.isError ? (
          <p className="text-sm text-destructive">
            Impossible de comparer avec le serveur pour le moment.
          </p>
        ) : nothingToDo ? (
          <p className="text-sm text-muted-foreground">
            Tous les produits de cet appareil existent sur le serveur.
          </p>
        ) : (
          <>
            {pushable.length > 0 && (
              <div className="space-y-sp-sm">
                <p className="text-sm font-medium text-foreground">
                  {pushable.length} produit{pushable.length > 1 ? "s" : ""} à envoyer
                </p>
                <ul className="space-y-sp-xs text-sm text-muted-foreground">
                  {pushable.map((product) => (
                    <li key={product.id}>
                      {product.name}
                      {product.dosage ? ` — ${product.dosage}` : ""} · stock{" "}
                      {product.quantityInStock}
                    </li>
                  ))}
                </ul>
                <Button onClick={() => push.mutate()} disabled={push.isPending}>
                  <CloudUpload className="size-4" strokeWidth={1.75} />
                  {push.isPending ? "Envoi..." : "Envoyer au serveur"}
                </Button>
              </div>
            )}

            {duplicates.length > 0 && (
              /* Not sent, and not silently hidden either: the server already
                 holds this product under another id, so uploading it breaks
                 the barcode uniqueness. Which of the two copies is the right
                 one is a judgement call — quantities may differ — so it is
                 shown rather than decided here. */
              <div className="space-y-sp-sm rounded-lg bg-amber-100/60 p-sp-md dark:bg-amber-950/40">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  {duplicates.length} produit{duplicates.length > 1 ? "s" : ""} déjà sur le
                  serveur sous un autre identifiant
                </p>
                <ul className="space-y-sp-xs text-sm text-amber-900 dark:text-amber-100">
                  {duplicates.map(({ product, remoteName }) => (
                    <li key={product.id}>
                      <span className="block">
                        {product.name} · code-barres {product.barcode}
                      </span>
                      <span className="block text-xs opacity-80">
                        Existe déjà sous le nom « {remoteName} » · copie locale : stock{" "}
                        {product.quantityInStock}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
                  Ils ne sont pas envoyés : le code-barres est unique par pharmacie. Vérifiez
                  quelle version est la bonne, puis corrigez le stock depuis la fiche produit.
                </p>
              </div>
            )}
          </>
        )}

        {done && (
          <p className="text-sm text-muted-foreground">
            {done.queued} produit{done.queued > 1 ? "s" : ""} mis en file d&apos;envoi
            {done.alreadyQueued > 0 && ` · ${done.alreadyQueued} déjà en attente`}.
          </p>
        )}

        {push.isError && (
          <p className="text-sm text-destructive">
            L&apos;envoi n&apos;a pas pu être préparé. Réessayez une fois la connexion stable.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
