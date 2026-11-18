"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  KeyRound,
  Lock,
  LockOpen,
  Sunrise,
  WifiOff,
} from "lucide-react";
import { cloturerCaisse, ouvrirCaisse, type EtatCaisse } from "@/lib/server/caisse";
import { formatMad } from "@/lib/invoices/totals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MontantInput } from "@/components/features/caisse/caisse-montant-input";

/**
 * Les deux gestes de la journée : ouvrir le matin, clôturer le soir.
 *
 * En fenêtre par-dessus le comptoir flouté, et non en page à part : le
 * pharmacien sait où il est et ce qui l'attend derrière. L'ouverture est
 * modale sans échappatoire — il n'y a rien d'autre à faire tant que la
 * caisse est fermée.
 */

/** Fonds de caisse d'usage en officine. Neuf fois sur dix, c'est l'un d'eux. */
const FONDS_USUELS = [200, 500, 1000, 2000];

function Entete({
  icone,
  titre,
  ton = "neutre",
}: {
  icone: React.ReactNode;
  titre: string;
  ton?: "neutre" | "alerte";
}) {
  return (
    <div className="flex items-center gap-sp-md">
      <span
        className={
          ton === "alerte"
            ? "flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
            : "flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        }
        aria-hidden
      >
        {icone}
      </span>
      <DialogTitle className="font-heading text-lg">{titre}</DialogTitle>
    </div>
  );
}

export function DialogueOuverture({
  etat,
  onOuvrirLocalement,
}: {
  etat: EtatCaisse;
  /** Repli hors ligne : écrit la session sur l'appareil et la met en file. */
  onOuvrirLocalement: (fond: number) => Promise<void>;
}) {
  const router = useRouter();
  const [fond, setFond] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [envoi, startEnvoi] = useTransition();

  if (etat.etat === "en_retard") {
    const jour = new Date(etat.session.dateOuverture).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader className="space-y-sp-md">
            <Entete icone={<AlertTriangle className="size-5" />} titre="Journée non clôturée" ton="alerte" />
            <DialogDescription className="text-left text-sm">
              La session ouverte le <span className="font-medium text-foreground">{jour}</span>{" "}
              n&apos;a jamais été fermée. Chaque journée doit avoir son propre Journal Z : les
              ventes ne peuvent pas s&apos;accumuler sur plusieurs jours dans une même session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="w-full" onClick={() => router.push("/caisse")}>
              <Lock />
              Clôturer la journée du {new Date(etat.session.dateOuverture).toLocaleDateString("fr-FR")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader className="space-y-sp-md">
          <Entete icone={<Sunrise className="size-5" />} titre="Ouvrir la caisse" />
          <DialogDescription className="text-left text-sm">
            Comptez ce que contient le tiroir avant la première vente. Aucune vente
            n&apos;est possible avant, quel que soit le mode de paiement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-sp-md py-sp-sm">
          <Label htmlFor="fond-caisse" className="text-xs uppercase tracking-wide text-muted-foreground">
            Fond de caisse
          </Label>
          <MontantInput
            id="fond-caisse"
            valeur={fond}
            onChange={setFond}
            raccourcis={FONDS_USUELS}
            autoFocus
          />
          {erreur && (
            <Alert variant="destructive">
              <AlertDescription>{erreur}</AlertDescription>
            </Alert>
          )}
          {horsLigne && (
            <Alert>
              <WifiOff className="size-4" />
              <AlertDescription>
                Caisse ouverte hors ligne. Vous pouvez vendre : l&apos;ouverture partira au
                serveur dès le retour de la connexion.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            className="h-12 w-full text-base"
            disabled={envoi || fond === ""}
            onClick={() =>
              startEnvoi(async () => {
                setErreur(null);
                setHorsLigne(false);
                try {
                  const r = await ouvrirCaisse(Number(fond));
                  if (!r.ok) return setErreur(r.error);
                  router.refresh();
                } catch {
                  /*
                   * Le serveur n'a pas répondu. On n'a pas les moyens de
                   * distinguer ici une coupure d'un incident, et c'est sans
                   * importance : dans les deux cas l'officine ouvre, et
                   * l'écriture partira quand la connexion reviendra. Refuser
                   * l'ouverture laisserait le comptoir bloqué pour la
                   * journée.
                   */
                  await onOuvrirLocalement(Number(fond));
                  setHorsLigne(true);
                }
              })
            }
          >
            <LockOpen />
            {envoi ? "Ouverture..." : "Ouvrir la caisse et commencer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogueCloture({
  ouvert,
  onOpenChange,
  fondInitial,
  pinRequis,
}: {
  ouvert: boolean;
  onOpenChange: (ouvert: boolean) => void;
  fondInitial: number;
  pinRequis: boolean;
}) {
  const router = useRouter();
  const [especes, setEspeces] = useState("");
  const [pin, setPin] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, startEnvoi] = useTransition();

  function fermer(ouvre: boolean) {
    if (!ouvre) {
      setEspeces("");
      setPin("");
      setErreur(null);
    }
    onOpenChange(ouvre);
  }

  return (
    <Dialog open={ouvert} onOpenChange={fermer}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-sp-md">
          <Entete icone={<Lock className="size-5" />} titre="Clôture de caisse" />
          <DialogDescription className="text-left text-sm">
            Comptez le tiroir et saisissez ce que vous y trouvez.
          </DialogDescription>
        </DialogHeader>

        {/* Le comptage à l'aveugle, expliqué plutôt que subi : sans un mot,
            l'absence du montant attendu passe pour un oubli de
            l'application. */}
        <div className="flex items-start gap-sp-sm rounded-lg bg-muted/60 p-sp-md text-sm">
          <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            Le montant attendu ne s&apos;affiche qu&apos;<span className="font-medium">après</span>{" "}
            votre saisie. C&apos;est ce qui rend le comptage fiable : on compte ce qu&apos;il y
            a, pas ce qu&apos;il devrait y avoir.
          </p>
        </div>

        <div className="space-y-sp-md py-sp-sm">
          <Label htmlFor="especes-comptees" className="text-xs uppercase tracking-wide text-muted-foreground">
            Espèces comptées dans le tiroir
          </Label>
          {/* Aucun raccourci ici, à la différence de l'ouverture : proposer
              des montants ronds sur un comptage suggérerait une réponse. */}
          <MontantInput id="especes-comptees" valeur={especes} onChange={setEspeces} autoFocus />
          <p className="text-xs text-muted-foreground">
            Fond de caisse du matin : {formatMad(fondInitial)}
          </p>

          {pinRequis && (
            <div className="space-y-sp-xs rounded-lg border border-border/60 p-sp-md">
              <Label htmlFor="pin-cloture" className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" aria-hidden />
                Code PIN de clôture
              </Label>
              <Input
                id="pin-cloture"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="••••"
                className="max-w-32 text-center font-heading text-lg tracking-[0.4em]"
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
          <Button variant="outline" onClick={() => fermer(false)}>
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
                fermer(false);
                // Vers le Z tout juste produit : c'est ce qu'on vient
                // chercher en clôturant, et l'écart s'y lit enfin.
                router.push(`/caisse/${r.id}`);
                router.refresh();
              })
            }
          >
            <CheckCircle2 />
            {envoi ? "Clôture..." : "Valider le comptage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
