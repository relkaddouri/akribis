"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LockOpen } from "lucide-react";
import { ouvrirCaisse, type EtatCaisse } from "@/lib/server/caisse";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * L'écran qui barre la caisse tant qu'aucune session n'est ouverte.
 *
 * Bloquant, et pour tous les modes de paiement : une vente par carte ne
 * touche pas le tiroir mais elle entre dans le Z, et la laisser passer
 * hors session la rendrait invisible de la journée comptable.
 *
 * Ce n'est pas la seule barrière. `createSale` refuse aussi côté serveur,
 * parce que le point de vente hors ligne rejoue ses ventes sans jamais
 * traverser cet écran. Ici, c'est l'explication et le geste ; là-bas,
 * c'est la garantie.
 */
export function CaisseVerrou({ etat }: { etat: EtatCaisse }) {
  const router = useRouter();
  const [fond, setFond] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, startEnvoi] = useTransition();

  if (etat.etat === "en_retard") {
    const jour = new Date(etat.session.dateOuverture).toLocaleDateString("fr-FR");
    return (
      <div className="mx-auto max-w-xl py-sp-lg">
        <Alert variant="destructive">
          <AlertTriangle className="size-5" />
          <AlertDescription className="space-y-sp-sm">
            <p className="font-medium">
              Une session du {jour} n&apos;a pas été clôturée. Fermez-la avant de continuer.
            </p>
            <p>
              Chaque journée doit avoir son propre Journal Z : les ventes ne peuvent pas
              s&apos;accumuler sur plusieurs jours dans une même session.
            </p>
            <Button variant="outline" onClick={() => router.push("/caisse")}>
              Aller à la clôture
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-sp-lg">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LockOpen className="size-5 text-muted-foreground" />
            Caisse non ouverte — saisir le fond de caisse
          </CardTitle>
          <CardDescription>
            Comptez ce que contient le tiroir avant la première vente. Aucune vente
            n&apos;est possible avant, quel que soit le mode de paiement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-sp-md">
          <div className="space-y-sp-xs">
            <Label htmlFor="fond-caisse">Fond de caisse (MAD)</Label>
            <Input
              id="fond-caisse"
              type="number"
              min={0}
              step="0.01"
              autoFocus
              value={fond}
              onChange={(e) => setFond(e.target.value)}
              className="h-14 text-right font-heading text-2xl font-bold tabular-nums"
            />
          </div>

          {erreur && (
            <Alert variant="destructive">
              <AlertDescription>{erreur}</AlertDescription>
            </Alert>
          )}

          <Button
            className="h-12 w-full text-base"
            disabled={envoi || fond === ""}
            onClick={() =>
              startEnvoi(async () => {
                const r = await ouvrirCaisse(Number(fond));
                if (!r.ok) return setErreur(r.error);
                router.refresh();
              })
            }
          >
            {envoi ? "Ouverture..." : "Ouvrir la caisse et commencer"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
