/**
 * Le Journal Z : ce qu'une journée de caisse a produit, et si le tiroir
 * est juste.
 *
 * Logique pure, sans base ni composant — comme lib/clients/plafond.ts. Ce
 * sont des chiffres que le pharmacien recopiera dans sa comptabilité et
 * qu'un contrôle relira : ils doivent pouvoir être vérifiés sans monter
 * d'écran.
 */

import { round2 } from "@/lib/pos/cart";

/**
 * Les modes que la caisse sait réellement produire.
 *
 * Le chèque n'y est pas : l'énumération `PaymentMethod` du schéma ne le
 * connaît pas et le comptoir ne le propose pas. Une ligne « Chèque : 0,00 »
 * sur chaque Journal Z ferait croire à une catégorie vide alors qu'elle
 * est inexistante — et ferait chercher où sont passés les chèques.
 */
export const MODES_PAIEMENT = ["CASH", "CARD", "CREDIT"] as const;
export type ModePaiement = (typeof MODES_PAIEMENT)[number];

/** Une vente telle que le Z la lit. Aplatie : ni Decimal ni relation. */
export type VenteDuZ = {
  paymentMethod: string;
  /** Total TTC du ticket, part organisme comprise. */
  totalAmount: number;
  /** Ce que le client a réglé au comptoir. */
  montantPartClient: number;
  /** Ce qui sera réclamé à l'organisme de tiers payant. */
  montantPartAssurance: number;
  /** Remboursé sur cette vente, retours compris. 0 si aucun retour. */
  montantRetourne: number;
  lignes: Array<{ totalHt: number; totalTva: number; tauxTva: number }>;
};

/**
 * Les espèces réellement entrées dans le tiroir.
 *
 * **Pas le total du ticket** : sur une vente en espèces avec tiers payant,
 * le client ne pose sur le comptoir que sa part, le reste étant réclamé à
 * l'organisme. Compter le total ferait apparaître un manque à chaque
 * clôture, du montant exact de ce que l'officine n'a jamais reçu.
 *
 * Un retour rembourse en espèces : il sort du tiroir et se retranche.
 */
export function especesEncaissees(ventes: VenteDuZ[]): number {
  return round2(
    ventes
      .filter((vente) => vente.paymentMethod === "CASH")
      .reduce((somme, vente) => somme + vente.montantPartClient - vente.montantRetourne, 0),
  );
}

/** Fond de caisse initial + espèces encaissées. Ce que le tiroir devrait contenir. */
export function especesTheoriques(fondInitial: number, ventes: VenteDuZ[]): number {
  return round2(fondInitial + especesEncaissees(ventes));
}

/**
 * Réel moins théorique.
 *
 * Ce sens-là, et pas l'inverse : **négatif = il manque de l'argent**.
 * C'est la convention comptable, et celle qu'attend qui lit un Z. La
 * prendre à l'envers ferait lire un vol comme un excédent.
 */
export function ecartCaisse(especesReelles: number, theoriques: number): number {
  return round2(especesReelles - theoriques);
}

export type VentilationPaiement = Record<ModePaiement, number> & {
  /** Part réclamée aux organismes. Pas un mode de paiement : personne ne l'a versée. */
  tiersPayant: number;
};

/**
 * Ce que chaque mode a rapporté, en part client.
 *
 * Le tiers payant figure à part et non comme un cinquième mode : c'est une
 * créance, pas un encaissement. L'additionner aux quatre autres ferait un
 * total que la caisse ne contient pas.
 */
export function ventilationParPaiement(ventes: VenteDuZ[]): VentilationPaiement {
  const total: VentilationPaiement = {
    CASH: 0,
    CARD: 0,
    CREDIT: 0,
    tiersPayant: 0,
  };

  for (const vente of ventes) {
    const mode = (MODES_PAIEMENT as readonly string[]).includes(vente.paymentMethod)
      ? (vente.paymentMethod as ModePaiement)
      : "CASH";
    total[mode] = round2(total[mode] + vente.montantPartClient);
    total.tiersPayant = round2(total.tiersPayant + vente.montantPartAssurance);
  }

  return total;
}

export type LigneTva = { taux: number; baseHt: number; tva: number };

/**
 * Le chiffre d'affaires et la TVA collectée, taux par taux.
 *
 * Les taux présents seulement sont rendus : afficher « TVA 20 % : 0,00 »
 * sur une officine qui ne vend qu'à 7 % ajoute une ligne à lire pour ne
 * rien apprendre.
 */
export function ventilationTva(ventes: VenteDuZ[]): LigneTva[] {
  const parTaux = new Map<number, LigneTva>();

  for (const vente of ventes) {
    for (const ligne of vente.lignes) {
      const courant = parTaux.get(ligne.tauxTva) ?? { taux: ligne.tauxTva, baseHt: 0, tva: 0 };
      courant.baseHt = round2(courant.baseHt + ligne.totalHt);
      courant.tva = round2(courant.tva + ligne.totalTva);
      parTaux.set(ligne.tauxTva, courant);
    }
  }

  return [...parTaux.values()].sort((a, b) => a.taux - b.taux);
}

export type TotauxZ = {
  caBrut: number;
  retours: number;
  caNet: number;
  nombreVentes: number;
};

/** CA brut, retours, et le net qui en découle. */
export function totauxZ(ventes: VenteDuZ[]): TotauxZ {
  const caBrut = round2(ventes.reduce((somme, v) => somme + v.totalAmount, 0));
  const retours = round2(ventes.reduce((somme, v) => somme + v.montantRetourne, 0));
  return { caBrut, retours, caNet: round2(caBrut - retours), nombreVentes: ventes.length };
}

/**
 * Le numéro de Z : `Z-AAAA-MM-JJ-NNN`.
 *
 * La date est celle de la **clôture**, en heure locale — c'est la journée
 * comptable qu'on arrête. `toISOString()` la convertirait en UTC et
 * daterait du 21 une caisse fermée le 22 à 00 h 30.
 */
export function formatNumeroZ(dateFermeture: Date, sequence: number): string {
  const mois = String(dateFermeture.getMonth() + 1).padStart(2, "0");
  const jour = String(dateFermeture.getDate()).padStart(2, "0");
  return `Z-${dateFermeture.getFullYear()}-${mois}-${jour}-${String(sequence).padStart(3, "0")}`;
}

/** La portée de compteur d'un jour donné : le NNN repart à 1 chaque matin. */
export function scopeCompteurZ(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `caisse_z:${date.getFullYear()}-${mois}-${jour}`;
}

/**
 * Une session ouverte un autre jour que celui-ci est en retard.
 *
 * Comparé en jours calendaires locaux, jamais en heures écoulées : une
 * caisse ouverte hier à 9 h et regardée aujourd'hui à 8 h n'a que 23
 * heures, et doit pourtant être clôturée — chaque journée a son propre Z.
 */
export function sessionEnRetard(dateOuverture: Date, maintenant: Date): boolean {
  return (
    dateOuverture.getFullYear() !== maintenant.getFullYear() ||
    dateOuverture.getMonth() !== maintenant.getMonth() ||
    dateOuverture.getDate() !== maintenant.getDate()
  );
}
