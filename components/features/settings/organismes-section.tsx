"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createOrganisme,
  setOrganismeActif,
  updateOrganisme,
  type OrganismeRecord,
} from "@/lib/server/organismes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
 * Les organismes de tiers payant, en ajout / modification / désactivation.
 *
 * Pas de suppression, volontairement : des ventes passées référencent
 * l'organisme, et l'effacer fausserait la traçabilité même à laquelle
 * elles servent. Un organisme dont on ne veut plus se désactive et cesse
 * d'être proposé, sans que l'historique bouge.
 */

type Brouillon = {
  nom: string;
  code: string;
  tauxCouverture: string;
  formatBordereau: string;
};

const VIDE: Brouillon = { nom: "", code: "", tauxCouverture: "0", formatBordereau: "" };

function pourcent(taux: number): string {
  return `${taux.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

function FormulaireOrganisme({
  organisme,
  onClose,
}: {
  /** `null` pour une création. */
  organisme: OrganismeRecord | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>(
    organisme
      ? {
          nom: organisme.nom,
          code: organisme.code,
          tauxCouverture: String(organisme.tauxCouverture),
          formatBordereau: organisme.formatBordereau ?? "",
        }
      : VIDE,
  );

  const champ = (cle: keyof Brouillon) => (valeur: string) =>
    setBrouillon((actuel) => ({ ...actuel, [cle]: valeur }));

  function enregistrer() {
    setErreur(null);
    startTransition(async () => {
      const resultat = organisme
        ? await updateOrganisme(organisme.id, brouillon)
        : await createOrganisme(brouillon);
      if (!resultat.ok) {
        setErreur(resultat.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{organisme ? "Modifier l'organisme" : "Nouvel organisme"}</DialogTitle>
        <DialogDescription>
          Le taux saisi ici est une valeur par défaut : il reste modifiable vente par vente.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-sp-md sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="organisme-nom">Nom</Label>
          <Input
            id="organisme-nom"
            value={brouillon.nom}
            placeholder="CNSS/AMO"
            onChange={(e) => champ("nom")(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="organisme-code">Code</Label>
          <Input
            id="organisme-code"
            value={brouillon.code}
            placeholder="CNSS"
            onChange={(e) => champ("code")(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Celui par lequel l&apos;organisme s&apos;identifie sur les bordereaux.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="organisme-taux">Taux de couverture par défaut</Label>
          <Input
            id="organisme-taux"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={brouillon.tauxCouverture}
            onChange={(e) => champ("tauxCouverture")(e.target.value)}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="organisme-format">Format de bordereau</Label>
          <Textarea
            id="organisme-format"
            rows={3}
            value={brouillon.formatBordereau}
            placeholder="Optionnel — particularités du bordereau attendu par cet organisme."
            onChange={(e) => champ("formatBordereau")(e.target.value)}
          />
        </div>
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Annuler
        </Button>
        <Button onClick={enregistrer} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {organisme ? "Enregistrer" : "Ajouter"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function InterrupteurActif({
  organisme,
  onError,
}: {
  organisme: OrganismeRecord;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<boolean | null>(null);

  // Un booléen, toujours : `checked={undefined}` ferait passer Radix en
  // mode non contrôlé, et l'interrupteur bougerait sans que rien ne soit
  // écrit — voir components/features/stock/product-actif-switch.tsx.
  const actif = organisme.actif !== false;

  function appliquer(suivant: boolean) {
    startTransition(async () => {
      const resultat = await setOrganismeActif(organisme.id, suivant);
      if (!resultat.ok) {
        onError(resultat.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-sp-sm">
      <Switch
        checked={actif}
        disabled={pending}
        aria-label={`${actif ? "Désactiver" : "Réactiver"} ${organisme.nom}`}
        onCheckedChange={(suivant) => setAsking(suivant)}
      />
      <span className={cn("text-sm", actif ? "text-foreground" : "text-muted-foreground")}>
        {actif ? "Actif" : "Inactif"}
      </span>
      {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}

      <AlertDialog open={asking !== null} onOpenChange={(ouvert) => !ouvert && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {asking ? "Réactiver cet organisme ?" : "Désactiver cet organisme ?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {asking
                ? `${organisme.nom} sera de nouveau proposé au moment de la vente.`
                : `${organisme.nom} ne sera plus proposé au moment de la vente. Rien n'est ` +
                  `supprimé : les ventes passées qui le référencent restent intactes, et vous ` +
                  `pourrez le réactiver à tout moment.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (asking !== null) appliquer(asking);
                setAsking(null);
              }}
            >
              {asking ? "Réactiver" : "Désactiver"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

export function OrganismesSection({ organismes }: { organismes: OrganismeRecord[] }) {
  const [edite, setEdite] = useState<OrganismeRecord | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  function ouvrir(organisme: OrganismeRecord | null) {
    setEdite(organisme);
    setOuvert(true);
  }

  return (
    <div className="space-y-sp-md">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => ouvrir(null)}>
          <Plus /> Ajouter un organisme
        </Button>
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      {organismes.length === 0 ? (
        <div className="flex flex-col items-center gap-sp-sm rounded-xl border border-dashed border-border py-sp-xl text-center">
          <ShieldCheck className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <p className="text-sm font-medium text-foreground">Aucun organisme enregistré</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ajoutez les organismes avec lesquels vous êtes conventionné — CNSS/AMO, CNOPS, ou une
            assurance privée — pour pouvoir les choisir au moment de la vente.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border">
          {organismes.map((organisme) => (
            <li
              key={organisme.id}
              className={cn(
                "flex flex-wrap items-center gap-sp-md px-sp-md py-sp-sm",
                !organisme.actif && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{organisme.nom}</p>
                <p className="truncate text-sm text-muted-foreground">
                  <span className="font-mono">{organisme.code}</span> ·{" "}
                  {pourcent(organisme.tauxCouverture)} par défaut
                </p>
                {organisme.formatBordereau && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {organisme.formatBordereau}
                  </p>
                )}
              </div>

              <InterrupteurActif organisme={organisme} onError={setErreur} />

              <Button
                variant="ghost"
                size="sm"
                onClick={() => ouvrir(organisme)}
                aria-label={`Modifier ${organisme.nom}`}
              >
                <Pencil /> Modifier
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        {ouvert && <FormulaireOrganisme organisme={edite} onClose={() => setOuvert(false)} />}
      </Dialog>
    </div>
  );
}
