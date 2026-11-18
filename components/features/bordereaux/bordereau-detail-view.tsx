"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Eye,
  FileDown,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  annulerRejet,
  enregistrerPaiement,
  rejeterLigne,
  type BordereauDetail,
} from "@/lib/server/bordereaux";
import { VenteModal } from "@/components/features/bordereaux/vente-modal";
import {
  bordereauEnCsv,
  LIBELLES_LIGNE,
  nomFichierCsv,
} from "@/lib/bordereaux/export";
import { rapprocher } from "@/lib/bordereaux/rapprochement";
import { StatutBordereauBadge } from "@/components/features/bordereaux/bordereaux-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function dirham(valeur: number): string {
  return `${valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MAD`;
}

const TONS_LIGNE: Record<string, string> = {
  EN_ATTENTE:
    "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  ACCEPTEE:
    "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  REJETEE:
    "bg-red-100 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
};

/** L'état d'une ligne, en pastille — même langage que le reste de l'app. */
function StatutLigneBadge({ statut }: { statut: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONS_LIGNE[statut] ?? TONS_LIGNE.EN_ATTENTE,
      )}
    >
      {LIBELLES_LIGNE[statut] ?? statut}
    </span>
  );
}

/**
 * Le téléchargement se fait entièrement dans le navigateur.
 *
 * Le bordereau est déjà en mémoire : repasser par le serveur pour
 * fabriquer le même fichier ajouterait un aller-retour, et l'export
 * cesserait de fonctionner hors ligne — au moment précis où une officine
 * veut imprimer son bordereau pour l'apporter à la main.
 */
function telecharger(bordereau: BordereauDetail) {
  const blob = new Blob([bordereauEnCsv(bordereau)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichierCsv(bordereau.numero);
  lien.click();
  URL.revokeObjectURL(url);
}

function Rejet({
  ligneId,
  reference,
  cloture,
  onFait,
}: {
  ligneId: string;
  reference: string;
  /** Rejeter sur un bordereau clôturé le rouvre — il faut le dire avant. */
  cloture: boolean;
  onFait: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function appliquer() {
    setErreur(null);
    start(async () => {
      const resultat = await rejeterLigne(ligneId, motif);
      if (!resultat.ok) {
        setErreur(resultat.error);
        return;
      }
      setOuvert(false);
      setMotif("");
      onFait();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOuvert(true)}>
        Marquer comme rejetée
      </Button>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeter {reference} ?</DialogTitle>
            <DialogDescription>
              La vente repassera en attente de bordereau : vous pourrez la
              réclamer à nouveau dans un bordereau suivant, une fois la cause du
              rejet corrigée.
              {cloture
                ? " Ce bordereau étant clôturé, il repassera en traitement : le montant attendu " +
                  "baisse alors que le versement reçu ne bouge pas, et l'écart est à réclamer."
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`motif-${ligneId}`}>Motif du rejet</Label>
            <Textarea
              id={`motif-${ligneId}`}
              rows={3}
              value={motif}
              placeholder="Ce que l'organisme a répondu."
              onChange={(e) => setMotif(e.target.value)}
            />
          </div>

          {erreur && (
            <Alert variant="destructive">
              <AlertDescription>{erreur}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOuvert(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button onClick={appliquer} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Rejeter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Le geste inverse du rejet, pour l'erreur de saisie. */
function AnnulerRejet({
  ligneId,
  onFait,
}: {
  ligneId: string;
  onFait: () => void;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const resultat = await annulerRejet(ligneId);
            if (!resultat.ok) {
              setErreur(resultat.error);
              return;
            }
            setErreur(null);
            onFait();
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        Annuler le rejet
      </Button>
      {/* Affiché ici même : la liste n'a pas de bandeau d'erreur, et le cas
          le plus probable — la vente est repartie dans un autre bordereau —
          demande une explication, pas un échec muet. */}
      {erreur && (
        <span className="max-w-64 text-right text-xs text-destructive">
          {erreur}
        </span>
      )}
    </span>
  );
}

function Paiement({ bordereau }: { bordereau: BordereauDetail }) {
  const router = useRouter();
  const cloture = bordereau.statut === "CLOTURE";

  /**
   * « Réglé » se juge sur les montants, pas sur le statut.
   *
   * Un bordereau reste marqué clôturé alors que son montant attendu a
   * bougé depuis — annuler un rejet le fait remonter. Se fier au seul
   * statut affichait « Réglé et clôturé » en vert au-dessus de 7,14 DH
   * d'écart.
   */
  const rapprochementActuel =
    bordereau.montantRecu !== null
      ? rapprocher(bordereau.lignes, bordereau.montantRecu)
      : null;
  const regle = cloture && rapprochementActuel?.concordant === true;
  /** Un versement déjà encaissé qui ne tombe plus juste. */
  const ecartResiduel =
    rapprochementActuel?.concordant === false ? rapprochementActuel : null;
  /**
   * Un bordereau clôturé montre son résultat, pas une saisie vierge : le
   * paiement est arrivé, l'afficher comme s'il restait à enregistrer
   * invite à le saisir deux fois. La correction reste possible, derrière
   * un geste explicite.
   */
  const [corriger, setCorriger] = useState(false);
  const [saisie, setSaisie] = useState(String(bordereau.montantRecu ?? ""));
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const montant = Number(saisie);
  // Prévisualisé pendant la frappe : l'écart doit se voir AVANT de valider,
  // pas après. C'est le seul moment où la saisie est encore corrigeable.
  const apercu =
    saisie.trim() !== "" && Number.isFinite(montant)
      ? rapprocher(bordereau.lignes, montant)
      : null;

  function enregistrer() {
    setErreur(null);
    start(async () => {
      const resultat = await enregistrerPaiement(bordereau.id, montant);
      if (!resultat.ok) {
        setErreur(resultat.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paiement de l&apos;organisme</CardTitle>
      </CardHeader>
      <CardContent className="space-y-sp-md">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Montant attendu</span>
          <span className="font-medium tabular-nums">
            {dirham(bordereau.montantAttendu)}
          </span>
        </div>

        {regle && !corriger ? (
          <>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Montant reçu</span>
              <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                {dirham(bordereau.montantRecu ?? 0)}
              </span>
            </div>
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              Réglé et clôturé
              {bordereau.dateRapprochement
                ? ` le ${new Date(bordereau.dateRapprochement).toLocaleDateString("fr-FR")}`
                : ""}
              . Les ventes de ce bordereau sont marquées comme payées.
            </p>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCorriger(true)}
              >
                Corriger le paiement
              </Button>
            </div>
          </>
        ) : (
          <>
            {ecartResiduel && (
              <div
                className="flex items-start gap-sp-sm rounded-lg bg-red-50 p-sp-sm text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
                role="alert"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">
                    Écart de {dirham(Math.abs(ecartResiduel.ecart))}
                  </span>{" "}
                  entre le versement déjà enregistré (
                  {dirham(ecartResiduel.montantRecu)}) et ce qui est désormais
                  réclamé. Le bordereau a changé depuis le paiement — corrigez
                  le montant reçu, ou réclamez la différence à l&apos;organisme.
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="montant-recu">Montant reçu</Label>
              <Input
                id="montant-recu"
                type="number"
                step="0.01"
                min={0}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
              />
            </div>

            {apercu && !apercu.concordant && (
              <div
                className="flex items-start gap-sp-sm rounded-lg bg-red-50 p-sp-sm text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
                role="alert"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">
                    Écart de {dirham(Math.abs(apercu.ecart))}
                  </span>{" "}
                  — l&apos;organisme a versé{" "}
                  {apercu.ecart < 0 ? "moins" : "plus"} que réclamé. Le
                  bordereau restera ouvert : il reste une ligne à rejeter, ou
                  une différence à réclamer.
                </span>
              </div>
            )}

            {apercu?.concordant && (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Les montants concordent — enregistrer clôturera le bordereau et
                marquera ses ventes comme payées.
              </p>
            )}

            {erreur && (
              <Alert variant="destructive">
                <AlertDescription>{erreur}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button
                onClick={enregistrer}
                disabled={pending || apercu === null}
              >
                {pending && <Loader2 className="animate-spin" />}
                Enregistrer le paiement reçu
              </Button>
            </div>

            {bordereau.montantRecu !== null && (
              <p className="text-xs text-muted-foreground">
                Dernier enregistrement : {dirham(bordereau.montantRecu)}
                {bordereau.dateRapprochement
                  ? ` le ${new Date(bordereau.dateRapprochement).toLocaleString("fr-FR")}`
                  : ""}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function BordereauDetailView({
  bordereau,
}: {
  bordereau: BordereauDetail;
}) {
  const router = useRouter();
  /** Index de la vente ouverte en modale ; `null` quand elle est fermée. */
  const [venteOuverte, setVenteOuverte] = useState<number | null>(null);
  const cloture = bordereau.statut === "CLOTURE";

  return (
    <div className="grid gap-sp-lg lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-sp-md">
          <CardTitle>Ventes incluses ({bordereau.lignes.length})</CardTitle>
          <div className="flex items-center gap-sp-xs">
            {/* Le PDF d'abord : c'est le document qu'on imprime et qu'on
                envoie. Le CSV reste à côté pour l'organisme qui rapproche
                ses lignes par import — deux besoins, deux fichiers. */}
            <Button asChild size="sm">
              <a href={`/bordereaux/${bordereau.id}/pdf`}>
                <FileDown /> Télécharger le PDF
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => telecharger(bordereau)}
            >
              <Download /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60">
            {bordereau.lignes.map((ligne, index) => (
              <li
                key={ligne.id}
                className={cn(
                  "flex flex-wrap items-center gap-sp-md py-sp-sm",
                  ligne.statut === "REJETEE" && "opacity-70",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {ligne.reference}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {new Date(ligne.createdAt).toLocaleDateString("fr-FR")}
                    {ligne.clientName ? ` · ${ligne.clientName}` : ""}
                  </span>
                  {ligne.motifRejet && (
                    <span className="mt-0.5 block truncate text-xs text-destructive">
                      Motif : {ligne.motifRejet}
                    </span>
                  )}
                </span>

                <span className="shrink-0 text-right">
                  <span className="block text-sm tabular-nums text-foreground">
                    {dirham(ligne.montantReclame)}
                  </span>
                  <StatutLigneBadge statut={ligne.statut} />
                </span>

                {/* Icône seule : sept lignes portant chacune deux boutons
                    texte faisaient quatorze libellés à lire pour en trouver
                    un. L'intitulé reste, pour le lecteur d'écran. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={`Vérifier ${ligne.reference}`}
                  aria-label={`Vérifier ${ligne.reference}`}
                  onClick={() => setVenteOuverte(index)}
                >
                  <Eye />
                </Button>

                {ligne.statut === "REJETEE" ? (
                  <AnnulerRejet
                    ligneId={ligne.id}
                    onFait={() => router.refresh()}
                  />
                ) : (
                  <Rejet
                    ligneId={ligne.id}
                    reference={ligne.reference}
                    cloture={cloture}
                    onFait={() => router.refresh()}
                  />
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="space-y-sp-md lg:sticky lg:top-sp-lg">
        <Card>
          <CardHeader>
            <CardTitle>Bordereau</CardTitle>
          </CardHeader>
          <CardContent className="space-y-sp-sm text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Organisme</span>
              <span>{bordereau.insurerNom}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Période</span>
              <span className="tabular-nums">
                {new Date(bordereau.periodeDebut).toLocaleDateString("fr-FR")} —{" "}
                {new Date(bordereau.periodeFin).toLocaleDateString("fr-FR")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Statut</span>
              <StatutBordereauBadge statut={bordereau.statut} />
            </div>
          </CardContent>
        </Card>

        <Paiement bordereau={bordereau} />
      </div>

      <VenteModal
        lignes={bordereau.lignes}
        index={venteOuverte}
        onIndexChange={setVenteOuverte}
        onClose={() => setVenteOuverte(null)}
        onChangement={() => {
          setVenteOuverte(null);
          router.refresh();
        }}
        rendreActions={(ligne) => (
          <Rejet
            ligneId={ligne.id}
            reference={ligne.reference}
            cloture={cloture}
            onFait={() => {
              setVenteOuverte(null);
              router.refresh();
            }}
          />
        )}
      />
    </div>
  );
}
