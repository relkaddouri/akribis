import { round2 } from "@/lib/pos/cart";

/**
 * Le rapprochement d'un bordereau : ce que l'organisme a versé face à ce
 * que l'officine réclamait.
 *
 * Le montant attendu se recalcule à chaque fois plutôt que d'être stocké :
 * une ligne rejetée en cours de traitement le fait baisser, et une valeur
 * figée à la création aurait annoncé un écart là où il n'y en a pas.
 */

export const STATUT_LIGNE_REJETEE = "REJETEE";

export type LigneRapprochable = {
  montantReclame: number;
  statut: string;
};

export type Rapprochement = {
  /** Somme des lignes non rejetées. */
  montantAttendu: number;
  montantRecu: number;
  /** Positif si l'organisme a versé plus que réclamé, négatif s'il manque. */
  ecart: number;
  /** Aucun écart, au centime près. */
  concordant: boolean;
};

/** Ce que l'organisme doit encore, une fois les rejets retirés. */
export function montantAttendu(lignes: LigneRapprochable[]): number {
  return round2(
    lignes
      .filter((ligne) => ligne.statut !== STATUT_LIGNE_REJETEE)
      .reduce((somme, ligne) => somme + ligne.montantReclame, 0),
  );
}

/**
 * Comparaison au centime, sans tolérance.
 *
 * Un écart de 0,01 DH n'est pas du bruit : il signale qu'une ligne a été
 * remboursée à un taux différent de celui qu'on croyait, ou qu'un rejet
 * n'a pas été signalé. La tolérance ferait disparaître exactement le
 * signal qu'on cherche.
 */
export function rapprocher(lignes: LigneRapprochable[], montantRecu: number): Rapprochement {
  const attendu = montantAttendu(lignes);
  const recu = round2(montantRecu);
  const ecart = round2(recu - attendu);
  return { montantAttendu: attendu, montantRecu: recu, ecart, concordant: ecart === 0 };
}

/** Le numéro d'un bordereau : BOR-2026-0001, par officine et par année. */
export function formatNumeroBordereau(annee: number, sequence: number): string {
  return `BOR-${annee}-${String(sequence).padStart(4, "0")}`;
}

/** La portée du compteur, une séquence par officine et par année. */
export function scopeCompteur(annee: number): string {
  return `bordereau:${annee}`;
}
