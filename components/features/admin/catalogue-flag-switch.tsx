"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { setCatalogueProduitFlag } from "@/lib/server/catalogue";
import type { CatalogueFlag } from "@/lib/catalogue/flags";

/**
 * Flips one boolean on a catalogue fiche, straight from the sheet or the
 * list, behind a confirmation.
 *
 * Every one of these fields is national: turning "sur ordonnance" off
 * changes what a pharmacist is told at the counter in every officine on
 * the platform. That is why a stray click on a switch must not be enough
 * — the dialog states, in each direction, what the change actually does.
 */

type Copy = { titre: string; corps: string; action: string };

const COPY: Record<CatalogueFlag, { on: Copy; off: Copy }> = {
  actifCatalogue: {
    on: {
      titre: "Réactiver cette fiche ?",
      corps:
        "Elle réapparaîtra dans les recherches de toutes les pharmacies de la plateforme.",
      action: "Réactiver",
    },
    off: {
      titre: "Désactiver cette fiche ?",
      corps:
        "Elle disparaîtra des recherches de toutes les pharmacies, mais rien n'est supprimé : " +
        "les stocks et les ventes qui la référencent restent intacts, et vous pourrez la réactiver à tout moment.",
      action: "Désactiver",
    },
  },
  necessitePrescription: {
    on: {
      titre: "Exiger une ordonnance ?",
      corps:
        "Le produit ne pourra plus être délivré sans ordonnance, dans toutes les pharmacies.",
      action: "Exiger une ordonnance",
    },
    off: {
      titre: "Ne plus exiger d'ordonnance ?",
      corps:
        "Le produit pourra être délivré sans ordonnance partout. À ne faire que si le statut " +
        "réglementaire du produit a réellement changé.",
      action: "Retirer l'exigence",
    },
  },
  refrigerationRequise: {
    on: {
      titre: "Signaler une conservation au froid ?",
      corps:
        "La chaîne du froid sera signalée à la réception et au stockage, dans toutes les pharmacies.",
      action: "Activer",
    },
    off: {
      titre: "Retirer la conservation au froid ?",
      corps:
        "Plus aucune alerte de chaîne du froid ne sera affichée pour ce produit. " +
        "Un produit thermosensible mal conservé devient inefficace.",
      action: "Retirer",
    },
  },
  produitCommercialise: {
    on: {
      titre: "Marquer le produit comme commercialisé ?",
      corps: "Il sera de nouveau présenté comme autorisé à la vente au Maroc.",
      action: "Marquer commercialisé",
    },
    off: {
      titre: "Marquer le produit comme non commercialisé ?",
      corps:
        "Il sera signalé comme retiré de la vente au Maroc, dans toutes les pharmacies. " +
        "La fiche reste consultable.",
      action: "Marquer non commercialisé",
    },
  },
};

export function CatalogueFlagSwitch({
  produitId,
  flag,
  value,
  /** Names the switch for screen readers, e.g. "Prescription requise". */
  label,
  /** Shows the state beside the switch — the sheet does, the table doesn't. */
  showState = false,
  /** Wording of that state. "Actif/Inactif" reads better than "Oui/Non"
   *  for the catalogue status, which is a status rather than an answer. */
  stateLabels = { on: "Oui", off: "Non" },
  onError,
}: {
  produitId: string;
  flag: CatalogueFlag;
  value: boolean;
  label: string;
  showState?: boolean;
  stateLabels?: { on: string; off: string };
  onError?: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<boolean | null>(null);

  function apply(next: boolean) {
    startTransition(async () => {
      const result = await setCatalogueProduitFlag(produitId, flag, next);
      if (!result.ok) {
        onError?.(result.error);
        return;
      }
      router.refresh();
    });
  }

  const copy = COPY[flag][asking ? "on" : "off"];

  return (
    <span className="inline-flex items-center gap-sp-sm">
      <Switch
        checked={value}
        disabled={pending}
        aria-label={label}
        // Never flips on its own: the dialog decides, then the server does,
        // and the refreshed record is what moves the switch.
        onCheckedChange={(next) => setAsking(next)}
      />
      {showState && (
        <span className={cn("text-sm", value ? "font-medium text-foreground" : "text-muted-foreground")}>
          {value ? stateLabels.on : stateLabels.off}
        </span>
      )}
      {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}

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
