"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Landmark, Lock, LockOpen } from "lucide-react";
import {
  cloturerCaisse,
  ouvrirCaisse,
  type EtatCaisse,
  type SessionCaisse,
} from "@/lib/server/caisse";
import { formatMad } from "@/lib/invoices/totals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Le module Caisse : ouvrir le matin, clôturer le soir, relire les Z.
 *
 * Un module et non une page de rapport : on n'y vient pas consulter des
 * chiffres mais poser un acte comptable. D'où la carte d'état en haut,
 * qui ne montre qu'une chose — ce qu'il y a à faire maintenant.
 */

function horodatage(date: Date | string): string {
  return new Date(date).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Ouverture({ onFait }: { onFait: () => void }) {
  const [fond, setFond] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, startEnvoi] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockOpen className="size-4 text-muted-foreground" />
          Caisse non ouverte
        </CardTitle>
        <CardDescription>
          Saisissez le fond de caisse présent dans le tiroir pour démarrer la journée. Aucune
          vente n&apos;est possible avant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-sp-md">
        <div className="max-w-xs space-y-sp-xs">
          <Label htmlFor="fond">Fond de caisse (MAD)</Label>
          <Input
            id="fond"
            type="number"
            min={0}
            step="0.01"
            value={fond}
            onChange={(e) => setFond(e.target.value)}
            className="h-12 text-right font-heading text-xl font-bold tabular-nums"
          />
        </div>

        {erreur && (
          <Alert variant="destructive">
            <AlertDescription>{erreur}</AlertDescription>
          </Alert>
        )}

        <Button
          disabled={envoi || fond === ""}
          onClick={() =>
            startEnvoi(async () => {
              const r = await ouvrirCaisse(Number(fond));
              if (!r.ok) return setErreur(r.error);
              setErreur(null);
              onFait();
            })
          }
        >
          Ouvrir la caisse
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * La clôture, en comptage à l'aveugle.
 *
 * Le montant théorique n'est jamais envoyé au navigateur avant validation
 * — pas seulement masqué à l'écran. Une valeur présente dans la page
 * serait lisible dans les outils de développement, et le comptage à
 * l'aveugle n'aurait plus de sens.
 */
function Cloture({
  session,
  pinRequis,
  onFait,
}: {
  session: SessionCaisse;
  pinRequis: boolean;
  onFait: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [especes, setEspeces] = useState("");
  const [pin, setPin] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, startEnvoi] = useTransition();

  return (
    <>
      <Button onClick={() => setOuvert(true)}>
        <Lock />
        Clôturer la caisse
      </Button>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clôture de caisse</DialogTitle>
            <DialogDescription>
              Comptez le tiroir et saisissez le montant trouvé. Le montant attendu ne
              s&apos;affichera qu&apos;après validation — c&apos;est ce qui rend le comptage
              fiable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-sp-md">
            <div className="space-y-sp-xs">
              <Label htmlFor="especes">Espèces comptées (MAD)</Label>
              <Input
                id="especes"
                type="number"
                min={0}
                step="0.01"
                value={especes}
                onChange={(e) => setEspeces(e.target.value)}
                className="h-14 text-right font-heading text-2xl font-bold tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                Fond initial du matin : {formatMad(session.fondCaisseInitial)}
              </p>
            </div>

            {pinRequis && (
              <div className="space-y-sp-xs">
                <Label htmlFor="pin">Code PIN de clôture</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Le titulaire vous a autorisé à clôturer. La session portera votre nom.
                </p>
              </div>
            )}

            {erreur && (
              <Alert variant="destructive">
                <AlertDescription>{erreur}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button
              disabled={envoi || especes === "" || (pinRequis && pin === "")}
              onClick={() =>
                startEnvoi(async () => {
                  const r = await cloturerCaisse({
                    especesReelles: Number(especes),
                    ...(pinRequis ? { pin } : {}),
                  });
                  if (!r.ok) return setErreur(r.error);
                  setOuvert(false);
                  setPin("");
                  setEspeces("");
                  onFait();
                })
              }
            >
              {envoi ? "Clôture..." : "Valider le comptage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EcartBadge({ ecart }: { ecart: number | null }) {
  if (ecart === null) return <span className="text-muted-foreground">—</span>;
  if (ecart === 0) return <Badge variant="secondary">Juste</Badge>;
  // Négatif = il manque de l'argent. Rouge dans ce sens-là seulement : un
  // excédent est une anomalie, pas une perte.
  return (
    <span
      className={
        ecart < 0
          ? "font-medium tabular-nums text-red-700 dark:text-red-300"
          : "font-medium tabular-nums text-amber-700 dark:text-amber-300"
      }
    >
      {ecart > 0 ? "+" : "−"}
      {formatMad(Math.abs(ecart))}
    </span>
  );
}

export function CaisseView({
  etat,
  sessions,
  cloture,
}: {
  etat: EtatCaisse;
  sessions: SessionCaisse[];
  cloture: { possible: boolean; raison?: string; pinRequis: boolean };
}) {
  const router = useRouter();
  const rafraichir = () => router.refresh();

  const colonnes: DataTableColumn<SessionCaisse>[] = [
    {
      id: "z",
      header: "N° de Z",
      sortValue: (s) => s.numeroZ ?? "",
      cell: (s) =>
        s.numeroZ ? (
          <span className="font-medium text-foreground">{s.numeroZ}</span>
        ) : (
          <Badge variant="secondary">Session ouverte</Badge>
        ),
    },
    {
      id: "ouverture",
      header: "Ouverte",
      sortValue: (s) => new Date(s.dateOuverture).getTime(),
      cell: (s) => (
        <div className="min-w-0">
          <p className="text-sm tabular-nums">{horodatage(s.dateOuverture)}</p>
          <p className="truncate text-xs text-muted-foreground">{s.ouvreurNom}</p>
        </div>
      ),
    },
    {
      id: "fermeture",
      header: "Clôturée",
      sortValue: (s) => (s.dateFermeture ? new Date(s.dateFermeture).getTime() : 0),
      cell: (s) =>
        s.dateFermeture ? (
          <div className="min-w-0">
            <p className="text-sm tabular-nums">{horodatage(s.dateFermeture)}</p>
            <p className="truncate text-xs text-muted-foreground">
              {s.fermeurNom}
              {/* Le titulaire doit toujours distinguer qui a réellement
                  arrêté la caisse, et par quel moyen. */}
              {s.fermetureParPin ? " · par code PIN" : ""}
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "ventes",
      header: "Ventes",
      align: "right",
      sortValue: (s) => s.nombreVentes,
      cell: (s) => <span className="tabular-nums">{s.nombreVentes}</span>,
    },
    {
      id: "ecart",
      header: "Écart",
      align: "right",
      sortValue: (s) => s.ecartCaisse ?? 0,
      cell: (s) => <EcartBadge ecart={s.ecartCaisse} />,
    },
  ];

  return (
    <div className="space-y-sp-lg">
      {etat.etat === "aucune" && <Ouverture onFait={rafraichir} />}

      {etat.etat === "en_retard" && (
        <Alert variant="destructive">
          <AlertTriangle className="size-5" />
          <AlertDescription className="space-y-sp-sm">
            <p>
              Une session du{" "}
              {new Date(etat.session.dateOuverture).toLocaleDateString("fr-FR")} n&apos;a pas
              été clôturée. Fermez-la avant de continuer — chaque journée doit avoir son
              propre Journal Z.
            </p>
            {cloture.possible ? (
              <Cloture
                session={etat.session}
                pinRequis={cloture.pinRequis}
                onFait={rafraichir}
              />
            ) : (
              <p className="font-medium">{cloture.raison}</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {etat.etat === "ouverte" && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-sp-md space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="size-4 text-muted-foreground" />
                Caisse ouverte depuis {horodatage(etat.session.dateOuverture)}
              </CardTitle>
              <CardDescription>
                Ouverte par {etat.session.ouvreurNom} · fond de caisse{" "}
                {formatMad(etat.session.fondCaisseInitial)} · {etat.session.nombreVentes} vente
                {etat.session.nombreVentes > 1 ? "s" : ""}
              </CardDescription>
            </div>
            {cloture.possible ? (
              <Cloture session={etat.session} pinRequis={cloture.pinRequis} onFait={rafraichir} />
            ) : (
              <p className="max-w-56 text-right text-xs text-muted-foreground">{cloture.raison}</p>
            )}
          </CardHeader>
        </Card>
      )}

      <section className="space-y-sp-md">
        <h2 className="font-heading text-base font-bold text-foreground">
          Historique des Journaux Z
        </h2>
        <DataTable
          data={sessions}
          columns={colonnes}
          getRowId={(s) => s.id}
          selectable={false}
          onRowClick={(s) => s.numeroZ && router.push(`/caisse/${s.id}`)}
          searchFields={(s) => [s.numeroZ ?? "", s.ouvreurNom, s.fermeurNom ?? ""]}
          searchPlaceholder="Rechercher par numéro de Z ou par utilisateur..."
          emptyTitle="Aucune session"
          emptyDescription="Ouvrez la caisse pour démarrer votre première journée."
        />
      </section>
    </div>
  );
}
