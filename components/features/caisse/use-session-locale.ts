"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getSessionLocale,
  oublierSessionLocale,
  ouvrirCaisseHorsLigne,
} from "@/lib/offline/caisse";
import type { EtatCaisse, ResumeSession } from "@/lib/server/caisse";
import { sessionEnRetard } from "@/lib/caisse/journal-z";

/**
 * L'état de caisse tel que le comptoir doit le voir, en ligne comme hors
 * ligne.
 *
 * Le serveur rend l'état au chargement de la page. Hors ligne, cette page
 * vient du cache : son état est celui du dernier passage en ligne, et une
 * caisse ouverte depuis a besoin d'être connue autrement. D'où la lecture
 * de la session locale, qui prime tant que le serveur n'en connaît pas.
 *
 * La priorité va toujours au serveur quand il en a une : c'est lui qui
 * fait foi, et une session locale qu'il ignore veut dire l'une de deux
 * choses — elle n'est pas encore partie, ou elle a été clôturée depuis un
 * autre poste. Le second cas se distingue du premier par le fait qu'elle
 * ait déjà été synchronisée ; on l'oublie alors, sans quoi ce comptoir
 * croirait pouvoir vendre et se ferait refuser vente après vente.
 */
export function useEtatCaisse(
  etatServeur: EtatCaisse,
  resumeServeur: ResumeSession | null,
): { etat: EtatCaisse; resume: ResumeSession | null; ouvrirLocalement: (fond: number, nom: string) => Promise<void> } {
  const [etat, setEtat] = useState(etatServeur);
  const [resume, setResume] = useState(resumeServeur);

  const relire = useCallback(async () => {
    if (etatServeur.etat !== "aucune") {
      setEtat(etatServeur);
      setResume(resumeServeur);
      return;
    }

    let locale;
    try {
      locale = await getSessionLocale();
    } catch {
      // Session hors ligne non initialisée — hors du contexte navigateur,
      // ou fournisseur non monté. Rien à ajouter à l'état du serveur.
      return;
    }
    if (!locale) return;

    if (locale.syncStatus === "synced") {
      // Le serveur la connaissait et ne la rend plus : elle a été clôturée
      // ailleurs. La garder ferait vendre dans le vide.
      await oublierSessionLocale(locale.id);
      return;
    }

    const session = {
      id: locale.id,
      statut: "ouverte" as const,
      fondCaisseInitial: locale.fondCaisseInitial,
      dateOuverture: locale.dateOuverture,
      ouvertePar: "",
      ouvreurNom: locale.ouvreurNom,
      fermeePar: null,
      fermeurNom: null,
      dateFermeture: null,
      especesTheoriques: null,
      especesReelles: null,
      ecartCaisse: null,
      numeroZ: null,
      fermetureParPin: false,
      nombreVentes: 0,
    };

    setEtat(
      sessionEnRetard(locale.dateOuverture, new Date())
        ? { etat: "en_retard", session }
        : { etat: "ouverte", session },
    );
    setResume({
      sessionId: locale.id,
      dateOuverture: locale.dateOuverture,
      ouvreurNom: locale.ouvreurNom,
      nombreVentes: 0,
      caTtc: 0,
    });
  }, [etatServeur, resumeServeur]);

  useEffect(() => {
    void relire();
  }, [relire]);

  const ouvrirLocalement = useCallback(
    async (fondCaisseInitial: number, ouvreurNom: string) => {
      await ouvrirCaisseHorsLigne({ fondCaisseInitial, ouvreurNom });
      await relire();
    },
    [relire],
  );

  return { etat, resume, ouvrirLocalement };
}
