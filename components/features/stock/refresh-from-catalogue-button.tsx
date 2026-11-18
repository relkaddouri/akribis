"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { refreshFromCatalogue } from "@/lib/server/stock-entry";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Re-imports the catalogue's current values into this pharmacy's fiche.
 *
 * Only ever on an explicit click. The fiche belongs to the pharmacy the
 * moment it is created, so this button overwrites its own work — which is
 * why it asks first, and says exactly what survives: quantity, threshold,
 * purchase price, location, internal reference and supplier are the
 * officine's facts, not product data, and are never touched.
 */
export function RefreshFromCatalogueButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  function run() {
    setFeedback(null);
    startTransition(async () => {
      const result = await refreshFromCatalogue(productId);
      if (!result.ok) {
        setFeedback({ tone: "error", message: result.error });
        return;
      }
      setFeedback({
        tone: "ok",
        message:
          result.champsModifies === 0
            ? "Votre fiche était déjà identique au catalogue — rien n'a changé."
            : `${result.champsModifies} champ${result.champsModifies > 1 ? "s" : ""} mis à jour depuis le catalogue.`,
      });
      router.refresh();
    });
  }

  return (
    // Inline plutôt qu'empilé : ce bouton vit maintenant dans la barre
    // d'en-tête, où un bloc d'alerte pleine largeur repousserait tout.
    <span className="inline-flex flex-wrap items-center gap-sp-sm">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(true)}>
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        Mettre à jour depuis le catalogue
      </Button>

      {feedback && (
        <span
          role="status"
          className={cn(
            "text-xs",
            feedback.tone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {feedback.message}
        </span>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réimporter les valeurs du catalogue ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les informations produit de cette fiche — nom, dosage, prix, TVA, remboursement,
              posologie, monographie — seront remplacées par celles du catalogue.{" "}
              <strong className="font-semibold text-foreground">
                Vos modifications sur ces champs seront perdues.
              </strong>{" "}
              Votre quantité, votre seuil d&apos;alerte, votre prix d&apos;achat, votre
              emplacement, votre référence interne et votre fournisseur ne changent pas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Réimporter</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
