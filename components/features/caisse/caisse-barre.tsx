"use client";

import { useEffect, useState } from "react";
import { CircleDot, Clock, Lock, Receipt, TrendingUp } from "lucide-react";
import type { ResumeSession } from "@/lib/server/caisse";
import { formatMad } from "@/lib/invoices/totals";
import { Button } from "@/components/ui/button";

/**
 * La bande de session, en haut du comptoir.
 *
 * Ambiante : toujours là, jamais dans le chemin. Un écran de caisse se lit
 * debout, en trois secondes, avec un client qui attend — ce qu'il faut
 * savoir en permanence tient en quatre chiffres, et la clôture doit être
 * à portée sans quitter l'écran.
 *
 * Les espèces n'y figurent pas : voir toute la journée ce que le tiroir
 * devrait contenir reviendrait à compter en sachant quoi trouver.
 */

function heure(date: Date): string {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function Chiffre({
  icone,
  libelle,
  valeur,
}: {
  icone: React.ReactNode;
  libelle: string;
  valeur: string;
}) {
  return (
    <div className="flex items-center gap-sp-sm">
      {/* Icône en pastille : elle sert de repère de balayage sans peser,
          là où une icône nue se confond avec le texte à cette taille. */}
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"
        aria-hidden
      >
        {icone}
      </span>
      <span className="leading-tight">
        <span className="block text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          {libelle}
        </span>
        <span className="block font-heading text-sm font-bold tabular-nums text-foreground">
          {valeur}
        </span>
      </span>
    </div>
  );
}

export function CaisseBarre({
  resume,
  onCloturer,
  clotureDisponible,
  raisonIndisponible,
}: {
  resume: ResumeSession;
  onCloturer: () => void;
  clotureDisponible: boolean;
  raisonIndisponible?: string;
}) {
  /*
   * L'horloge démarre à `null` et ne s'allume qu'après le montage. Rendue
   * côté serveur, elle afficherait l'heure du serveur, que React
   * remplacerait aussitôt par celle du navigateur — une discordance
   * d'hydratation, et une heure fausse le temps d'un battement.
   */
  const [maintenant, setMaintenant] = useState<Date | null>(null);

  useEffect(() => {
    setMaintenant(new Date());
    const minuterie = setInterval(() => setMaintenant(new Date()), 30_000);
    return () => clearInterval(minuterie);
  }, []);

  return (
    /*
     * Fond `muted`, sans ombre : la bande recule au lieu de se présenter
     * comme un contenu. En carte blanche ombrée, elle avait le même poids
     * visuel que le panier — l'œil s'y arrêtait à chaque coup d'œil alors
     * qu'elle n'est qu'un bandeau d'état, à lire une fois puis à oublier.
     */
    <div className="flex flex-wrap items-center justify-between gap-x-sp-lg gap-y-sp-sm rounded-xl border border-border/60 bg-muted/40 px-sp-md py-sp-sm">
      <div className="flex flex-wrap items-center gap-x-sp-lg gap-y-sp-sm">
        <div className="flex items-center gap-sp-sm">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            aria-hidden
          >
            <CircleDot className="size-4 animate-pulse" strokeWidth={2.5} />
          </span>
          <span className="leading-tight">
            <span className="block text-[0.65rem] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Caisse ouverte
            </span>
            <span className="block text-sm font-medium text-foreground">
              depuis {heure(new Date(resume.dateOuverture))} · {resume.ouvreurNom}
            </span>
          </span>
        </div>

        <span className="hidden h-7 w-px bg-border sm:block" aria-hidden />

        <Chiffre
          icone={<Receipt className="size-4" strokeWidth={1.75} />}
          libelle="Ventes"
          valeur={String(resume.nombreVentes)}
        />
        <Chiffre
          icone={<TrendingUp className="size-4" strokeWidth={1.75} />}
          libelle="Encaissé aujourd'hui"
          valeur={formatMad(resume.caTtc)}
        />
        <Chiffre
          icone={<Clock className="size-4" strokeWidth={1.75} />}
          libelle={
            maintenant
              ? maintenant.toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              : "Aujourd'hui"
          }
          valeur={maintenant ? heure(maintenant) : "--:--"}
        />
      </div>

      {clotureDisponible ? (
        /*
         * Rouge clair, pas rouge plein : clôturer arrête la journée
         * comptable et fige les ventes de la session — c'est irréversible,
         * et le bouton doit le dire. Mais il est présent en permanence sur
         * l'écran de vente, et un rouge saturé toute la journée finirait
         * par ne plus rien signaler du tout.
         */
        <Button
          variant="ghost"
          size="sm"
          onClick={onCloturer}
          className="bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950 dark:hover:text-red-200"
        >
          <Lock />
          Clôturer la caisse
        </Button>
      ) : (
        <p className="max-w-56 text-right text-xs text-muted-foreground">{raisonIndisponible}</p>
      )}
    </div>
  );
}
