"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
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
import { setProductActifLocalement } from "@/lib/server/stock-entry";
import { markProductActifLocalement } from "@/lib/offline/products";

/**
 * Retire un produit de la vente **pour cette officine seulement**, ou l'y
 * remet, derrière une confirmation.
 *
 * Même geste que l'interrupteur du catalogue Admin, portée opposée : ici
 * rien ne sort de la pharmacie. La confirmation ne sert pas à dramatiser
 * mais à lever l'ambiguïté du mot « désactiver », qui pourrait se lire
 * « supprimer » : le texte dit ce qui disparaît et ce qui reste.
 */

export function ProductActifSwitch({
  productId,
  productName,
  value,
  /** Rappelle ce qui reste en rayon — on ne cache pas 30 boîtes sans le dire. */
  quantityInStock,
  /** Affiche l'état à côté : la fiche oui, le tableau non. */
  showState = false,
  onError,
}: {
  productId: string;
  productName: string;
  value: boolean;
  quantityInStock?: number;
  showState?: boolean;
  onError?: (message: string) => void;
}) {
  /**
   * Un booléen, toujours.
   *
   * `checked={undefined}` fait basculer Radix en mode **non contrôlé** :
   * l'interrupteur se met alors à bouger tout seul au clic, sans que rien
   * ne soit écrit, et annonce un état que la base ne porte pas. C'est ce
   * qui arrive dès que la donnée arrive sans le champ — client Prisma
   * généré avant la migration, ligne mise en cache avant elle, payload
   * RSC d'une version antérieure.
   *
   * `!== false` plutôt que `=== true` : un produit est en vente tant que
   * personne ne l'a retiré, c'est la valeur par défaut de la colonne et
   * la même règle que la couche hors-ligne applique déjà.
   */
  const actif = value !== false;

  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<boolean | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  function signaler(message: string) {
    setErreur(message);
    onError?.(message);
  }

  function apply(next: boolean) {
    setErreur(null);
    startTransition(async () => {
      // L'application est hors-ligne d'abord, et cette bascule est le seul
      // geste du stock qui exige le réseau : sans ce filet, un clic dans le
      // métro rejetterait la promesse sans que rien ne bouge à l'écran, et
      // le pharmacien croirait le produit retiré.
      let result: Awaited<ReturnType<typeof setProductActifLocalement>>;
      try {
        result = await setProductActifLocalement(productId, next);
      } catch {
        // Ne pas diagnostiquer « hors connexion » sans le savoir : l'action
        // serveur peut aussi échouer en ligne, et annoncer la mauvaise
        // cause envoie chercher le problème au mauvais endroit.
        signaler(
          typeof navigator !== "undefined" && !navigator.onLine
            ? "Modification impossible hors connexion. Réessayez une fois en ligne."
            : "La modification n'a pas pu être enregistrée. Réessayez, puis rechargez la page si cela persiste.",
        );
        return;
      }
      if (!result.ok) {
        signaler(result.error);
        return;
      }
      // La liste du stock et le comptoir lisent IndexedDB, que
      // `router.refresh()` ne touche pas : sans cette recopie, le produit
      // resterait proposé au comptoir jusqu'à la prochaine synchro.
      await markProductActifLocalement(productId, next);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      router.refresh();
      setErreur(null);
    });
  }

  const restant =
    quantityInStock && quantityInStock > 0
      ? ` Il vous en reste ${quantityInStock} en stock.`
      : "";

  const copy = asking
    ? {
        titre: "Remettre ce produit en vente ?",
        corps: `${productName} sera de nouveau proposé au comptoir et à la commande fournisseur.`,
        action: "Remettre en vente",
      }
    : {
        titre: "Retirer ce produit de la vente ?",
        corps:
          `${productName} ne sera plus proposé au comptoir ni à la commande fournisseur. ` +
          `Rien n'est supprimé : le produit reste dans votre stock avec ses lots, ses ` +
          `mouvements et ses ventes passées, et vous pourrez le remettre en vente à tout ` +
          `moment.${restant}`,
        action: "Retirer de la vente",
      };

  return (
    <span className="inline-flex items-center gap-sp-sm">
      <Switch
        checked={actif}
        disabled={pending}
        aria-label={`${actif ? "Retirer de la vente" : "Remettre en vente"} ${productName}`}
        // Ne bascule jamais seul : la boîte de dialogue décide, le serveur
        // écrit, et c'est l'enregistrement rafraîchi qui bouge l'interrupteur.
        onCheckedChange={(next) => setAsking(next)}
      />
      {showState && (
        <span
          className={cn("text-sm", actif ? "font-medium text-foreground" : "text-muted-foreground")}
        >
          {actif ? "En vente" : "Retiré de la vente"}
        </span>
      )}
      {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
      {/* Affiché ici même : le tableau du stock n'a pas de bandeau
          d'erreur, et une bascule qui échoue sans le dire est pire qu'une
          bascule absente. */}
      {erreur && (
        <span role="alert" className="text-sm text-destructive">
          {erreur}
        </span>
      )}

      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.titre}</AlertDialogTitle>
            <AlertDialogDescription>{copy.corps}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (asking !== null) apply(asking);
                setAsking(null);
              }}
            >
              {copy.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
