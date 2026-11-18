/**
 * Le plafond de crédit d'un client : ce que l'officine accepte de lui
 * laisser devoir.
 *
 * Logique pure, sans base ni composant, comme le reste de
 * lib/clients/account.ts — c'est de l'argent, et le calcul doit pouvoir
 * être vérifié sans monter d'écran.
 *
 * Le contrôle **avertit, il ne bloque pas**. Un plafond est une consigne
 * de gestion, pas une règle de droit : le pharmacien voit le client, sait
 * s'il paie, et décide. Refuser la vente à sa place déplacerait la
 * décision vers celui qui en sait le moins.
 */

import { amountOwed } from "@/lib/clients/account";
import { round2 } from "@/lib/pos/cart";

export type DepassementPlafond = {
  /** Le plafond fixé sur la fiche, en MAD. */
  plafond: number;
  /** Ce que le client doit déjà. */
  encoursActuel: number;
  /** Ce qu'il devrait une fois cette vente portée au compte. */
  encoursApres: number;
  /** De combien le plafond serait dépassé. Toujours > 0. */
  depassement: number;
};

/**
 * `null` quand il n'y a rien à signaler : pas de plafond, ou le plafond
 * tient.
 *
 * Un plafond **absent** (`null`) veut dire « pas de limite fixée ». Un
 * plafond à **zéro** est une limite, et une limite réelle : le titulaire
 * qui l'a saisi refuse tout crédit à ce client, et le taire serait perdre
 * la seule consigne qu'il ait laissée.
 */
export function depassementPlafondCredit({
  solde,
  plafondCredit,
  montantACrediter,
}: {
  /** Négatif = le client doit à la pharmacie. Convention de lib/clients/account.ts. */
  solde: number;
  plafondCredit: number | null;
  /** Montant de la vente qui partirait au compte, positif. */
  montantACrediter: number;
}): DepassementPlafond | null {
  if (plafondCredit === null) return null;

  const encoursApres = amountOwed(round2(solde - montantACrediter));
  if (encoursApres <= plafondCredit) return null;

  return {
    plafond: plafondCredit,
    encoursActuel: amountOwed(solde),
    encoursApres,
    depassement: round2(encoursApres - plafondCredit),
  };
}

/**
 * Ce qu'il reste à consommer sur le plafond, pour l'afficher à côté du
 * solde. `null` sans plafond ; jamais négatif — un dépassement déjà
 * constaté laisse une marge de zéro, pas une marge en dessous de zéro.
 */
export function margeDisponible(
  solde: number,
  plafondCredit: number | null,
): number | null {
  if (plafondCredit === null) return null;
  return Math.max(0, round2(plafondCredit - amountOwed(solde)));
}
