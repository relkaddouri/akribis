"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CalendarRange, Inbox } from "lucide-react";
import {
  createBordereau,
  listVentesEligibles,
  type VenteEligible,
} from "@/lib/server/bordereaux";
import type { OrganismeRecord } from "@/lib/server/organismes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * La création d'un bordereau, en deux temps : on choisit un organisme et
 * une période, on voit ce que cela réclame, puis on valide.
 *
 * L'aperçu n'est pas décoratif. Un bordereau engage l'officine auprès de
 * l'organisme et bascule le statut de chaque vente incluse : valider sans
 * avoir vu ce qu'on inclut serait signer une liste fermée.
 *
 * D'où la forme de l'écran : les critères à gauche, ce qu'ils réclament à
 * droite, et le récapitulatif collé au bas de la liste. Sur deux cents
 * ventes, le bouton de validation ne doit pas être à deux écrans de
 * défilement du total qu'il engage.
 */

function dirham(valeur: number): string {
  return `${valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MAD`;
}

function iso(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

/**
 * Les raccourcis de période. Un bordereau se fait au mois : demander deux
 * dates au clavier pour le geste le plus courant du module était une
 * saisie de trop.
 */
const PERIODES = [
  {
    cle: "mois-dernier",
    libelle: "Mois dernier",
    calcul: () => {
      const now = new Date();
      return {
        debut: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        // Le jour 0 du mois courant, c'est le dernier du mois précédent.
        fin: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
  {
    cle: "mois-courant",
    libelle: "Ce mois-ci",
    calcul: () => {
      const now = new Date();
      return {
        debut: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        fin: iso(now),
      };
    },
  },
  {
    cle: "90-jours",
    libelle: "90 derniers jours",
    calcul: () => {
      const now = new Date();
      return {
        debut: iso(
          new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89),
        ),
        fin: iso(now),
      };
    },
  },
] as const;

/** Une année à deux chiffres n'est pas une période : c'est une frappe en cours. */
function datePlausible(valeur: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(valeur) && Number(valeur.slice(0, 4)) >= 2000
  );
}

export function NouveauBordereauForm({
  organismes,
}: {
  organismes: OrganismeRecord[];
}) {
  const router = useRouter();
  const [chargement, startChargement] = useTransition();
  const [envoi, startEnvoi] = useTransition();

  const [insurerId, setInsurerId] = useState<string>(organismes[0]?.id ?? "");
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [ventes, setVentes] = useState<VenteEligible[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rafraichissement, setRafraichissement] = useState(0);

  const periodeInversee =
    datePlausible(debut) && datePlausible(fin) && fin < debut;
  const interrogeable =
    insurerId !== "" &&
    datePlausible(debut) &&
    datePlausible(fin) &&
    !periodeInversee;

  /**
   * La période par défaut se calcule au montage, jamais avant.
   *
   * En constante de module, elle serait figée au démarrage du serveur et
   * proposerait indéfiniment le mois en cours ce jour-là ; calculée pendant
   * le rendu serveur, elle pourrait tomber dans un autre mois que celui du
   * navigateur — le serveur est en UTC, l'officine ne l'est pas.
   */
  useEffect(() => {
    const periode = PERIODES[0].calcul();
    setDebut(periode.debut);
    setFin(periode.fin);
  }, []);

  /**
   * L'aperçu se recharge dès qu'un critère bouge, sans bouton à presser.
   * Le jeton écarte la réponse d'une requête devancée par une plus
   * récente : sans lui, un aperçu périmé pourrait s'afficher en dernier et
   * annoncer un total qui n'est plus celui du bordereau à créer.
   */
  const jeton = useRef(0);

  useEffect(() => {
    if (!interrogeable) {
      setVentes(null);
      return;
    }
    const mien = ++jeton.current;
    setErreur(null);
    startChargement(async () => {
      try {
        const resultat = await listVentesEligibles(insurerId, debut, fin);
        if (jeton.current === mien) setVentes(resultat);
      } catch (e) {
        if (jeton.current === mien) {
          setVentes(null);
          setErreur((e as Error).message);
        }
      }
    });
  }, [insurerId, debut, fin, interrogeable, rafraichissement]);

  const appliquerPeriode = useCallback(
    (cle: (typeof PERIODES)[number]["cle"]) => {
      const periode = PERIODES.find((p) => p.cle === cle)!.calcul();
      setDebut(periode.debut);
      setFin(periode.fin);
    },
    [],
  );

  function valider() {
    setErreur(null);
    startEnvoi(async () => {
      const resultat = await createBordereau({ insurerId, debut, fin });
      if (!resultat.ok) {
        setErreur(resultat.error);
        // L'aperçu est périmé dès qu'une création échoue pour cause de
        // concurrence : le relire est le seul moyen de savoir ce qu'il
        // reste réellement à réclamer.
        setRafraichissement((n) => n + 1);
        return;
      }
      router.push(`/bordereaux/${resultat.id}`);
      router.refresh();
    });
  }

  if (organismes.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Aucun organisme de tiers payant n&apos;est enregistré. Ajoutez-en un
          dans Paramètres → Tiers payant avant de créer un bordereau.
        </AlertDescription>
      </Alert>
    );
  }

  const organisme = organismes.find((o) => o.id === insurerId);
  const total = (ventes ?? []).reduce(
    (somme, v) => somme + v.montantPartAssurance,
    0,
  );
  const periodeActive = PERIODES.find((p) => {
    const calc = p.calcul();
    return calc.debut === debut && calc.fin === fin;
  })?.cle;

  return (
    <div className="grid items-start gap-sp-lg lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-sp-md lg:sticky lg:top-sp-lg">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="size-4 text-muted-foreground" />
              Organisme et période
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-sp-md">
            <div className="space-y-2">
              <Label htmlFor="organisme">Organisme</Label>
              <Select value={insurerId} onValueChange={setInsurerId}>
                <SelectTrigger id="organisme" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {organismes.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Période</Label>
              <div className="flex flex-wrap gap-1.5">
                {PERIODES.map((periode) => (
                  <Button
                    key={periode.cle}
                    type="button"
                    size="xs"
                    variant={
                      periodeActive === periode.cle ? "secondary" : "outline"
                    }
                    aria-pressed={periodeActive === periode.cle}
                    onClick={() => appliquerPeriode(periode.cle)}
                  >
                    {periode.libelle}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-sp-sm">
              <div className="space-y-2">
                <Label htmlFor="debut">Du</Label>
                <Input
                  id="debut"
                  type="date"
                  value={debut}
                  onChange={(e) => setDebut(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fin">Au</Label>
                <Input
                  id="fin"
                  type="date"
                  value={fin}
                  onChange={(e) => setFin(e.target.value)}
                />
              </div>
            </div>

            {periodeInversee && (
              <p role="alert" className="text-xs text-destructive">
                La date de fin précède la date de début.
              </p>
            )}
          </CardContent>
        </Card>

        {erreur && (
          <Alert variant="destructive">
            <AlertDescription>{erreur}</AlertDescription>
          </Alert>
        )}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-sp-md space-y-0">
          <CardTitle>Ventes à réclamer</CardTitle>
          {chargement && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Relecture…
            </span>
          )}
        </CardHeader>

        <CardContent>
          {ventes === null ? (
            <p className="py-sp-lg text-center text-sm text-muted-foreground">
              {periodeInversee
                ? "Corrigez la période pour voir ce qu'il y a à réclamer."
                : "Choisissez un organisme et une période."}
            </p>
          ) : ventes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-sp-lg text-center">
              <Inbox className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                Aucune vente à réclamer sur cette période
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Les ventes déjà incluses dans un autre bordereau
                n&apos;apparaissent pas ici. Élargissez la période ou changez
                d&apos;organisme.
              </p>
            </div>
          ) : (
            <ul
              className={cn(
                "divide-y divide-border/60 transition-opacity",
                chargement && "opacity-60",
              )}
            >
              {ventes.map((vente, index) => (
                <li
                  key={vente.saleId}
                  className="flex items-center gap-sp-md py-sp-sm"
                >
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {vente.reference}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {new Date(vente.createdAt).toLocaleDateString("fr-FR")}
                      {vente.clientName ? ` · ${vente.clientName}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm tabular-nums text-foreground">
                      {dirham(vente.montantPartAssurance)}
                    </span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      sur {dirham(vente.totalAmount)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>

        {/* Collé au bas de la fenêtre tant que la liste défile : le total
            engagé et le bouton qui l'engage restent lisibles ensemble. */}
        {ventes !== null && ventes.length > 0 && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-sp-md rounded-b-[inherit] border-t border-border/60 bg-card/95 px-sp-lg py-sp-md backdrop-blur">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {ventes.length} vente{ventes.length > 1 ? "s" : ""} ·{" "}
                <span className="tabular-nums">{dirham(total)}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {organisme?.nom} · du{" "}
                {new Date(`${debut}T00:00:00`).toLocaleDateString("fr-FR")} au{" "}
                {new Date(`${fin}T00:00:00`).toLocaleDateString("fr-FR")}
              </p>
            </div>
            <Button
              type="button"
              disabled={envoi || chargement}
              onClick={valider}
            >
              {envoi && <Loader2 className="animate-spin" />}
              Créer le bordereau
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
