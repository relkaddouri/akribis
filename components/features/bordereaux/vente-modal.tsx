"use client";

import { useEffect, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSale } from "@/lib/server/sales-returns";
import { annulerRejet, type BordereauDetail } from "@/lib/server/bordereaux";
import { LIBELLES_LIGNE } from "@/lib/bordereaux/export";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Vérifier une vente sans quitter le bordereau, et passer à la suivante.
 *
 * Un pharmacien qui prépare un envoi relit ses lignes l'une après l'autre.
 * Ouvrir chaque vente dans un onglet, revenir, retrouver sa place — c'est
 * ce qui fait qu'on ne relit pas. Les flèches gardent le fil.
 */

type Ligne = BordereauDetail["lignes"][number];

function dirham(valeur: number): string {
  return `${valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MAD`;
}

const TONS: Record<string, string> = {
  EN_ATTENTE: "text-muted-foreground",
  ACCEPTEE: "text-emerald-700 dark:text-emerald-300",
  REJETEE: "text-destructive",
};

export function VenteModal({
  lignes,
  index,
  onIndexChange,
  onClose,
  onChangement,
  rendreActions,
}: {
  lignes: Ligne[];
  /** `null` = fermée. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onChangement: () => void;
  /** Le bouton de rejet, fourni par le parent qui sait s'il est clôturé. */
  rendreActions: (ligne: Ligne) => React.ReactNode;
}) {
  const ligne = index === null ? null : lignes[index];
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // L'erreur appartient à la ligne affichée : la laisser en changeant de
  // vente la ferait porter sur la mauvaise.
  useEffect(() => setErreur(null), [index]);

  const detail = useQuery({
    queryKey: ["sale", ligne?.saleId],
    queryFn: () => getSale(ligne!.saleId),
    enabled: ligne !== null,
  });

  function annuler() {
    if (!ligne) return;
    setErreur(null);
    start(async () => {
      const resultat = await annulerRejet(ligne.id);
      if (!resultat.ok) {
        setErreur(resultat.error);
        return;
      }
      onChangement();
    });
  }

  return (
    <Dialog open={ligne !== null} onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {ligne && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-sp-sm">
                {ligne.reference}
                <span className={cn("text-sm font-normal", TONS[ligne.statut])}>
                  {LIBELLES_LIGNE[ligne.statut]}
                </span>
              </DialogTitle>
              <DialogDescription>
                {new Date(ligne.createdAt).toLocaleDateString("fr-FR")}
                {ligne.clientName ? ` · ${ligne.clientName}` : " · Client de passage"} ·{" "}
                {dirham(ligne.montantReclame)} réclamés
              </DialogDescription>
            </DialogHeader>

            {ligne.motifRejet && (
              <p className="text-sm text-destructive">Motif du rejet : {ligne.motifRejet}</p>
            )}

            <div className="max-h-72 overflow-y-auto">
              {detail.isLoading ? (
                <p className="text-sm text-muted-foreground">Chargement de la vente…</p>
              ) : detail.data ? (
                <ul className="divide-y divide-border/60">
                  {detail.data.lines.map((produit) => (
                    <li
                      key={produit.saleItemId}
                      className="flex items-center justify-between gap-sp-md py-sp-xs"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{produit.productName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {produit.quantity} × {produit.unitPrice.toFixed(2)}
                          {produit.baseRemboursement !== null
                            ? ` · base ${produit.baseRemboursement.toFixed(2)}`
                            : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        {produit.lineTotal.toFixed(2)}
                        {produit.montantPartAssurance > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            dont {produit.montantPartAssurance.toFixed(2)} organisme
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                // La vente est référencée par la ligne : ne pas la trouver
                // signale une incohérence, pas un cas normal.
                <p className="text-sm text-destructive">
                  Vente introuvable — la ligne référence une vente qui n&apos;existe plus.
                </p>
              )}
            </div>

            {detail.data && (
              <div className="flex items-baseline justify-between border-t border-border pt-sp-sm text-sm">
                <span className="text-muted-foreground">
                  Total {dirham(detail.data.totalAmount)} · encaissé{" "}
                  {dirham(detail.data.montantPartClient)}
                </span>
                <span className="font-medium tabular-nums">
                  {dirham(detail.data.montantPartAssurance)} réclamés
                </span>
              </div>
            )}

            {erreur && (
              <Alert variant="destructive">
                <AlertDescription>{erreur}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="sm:justify-between">
              <div className="flex items-center gap-sp-xs">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Vente précédente"
                  disabled={index === 0}
                  onClick={() => onIndexChange(index! - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {index! + 1} / {lignes.length}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Vente suivante"
                  disabled={index === lignes.length - 1}
                  onClick={() => onIndexChange(index! + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>

              <div className="flex items-center gap-sp-xs">
                {ligne.statut === "REJETEE" ? (
                  <Button variant="outline" onClick={annuler} disabled={pending}>
                    {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Annuler le rejet
                  </Button>
                ) : (
                  rendreActions(ligne)
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
