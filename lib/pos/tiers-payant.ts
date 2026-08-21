import { round2 } from "@/lib/pos/cart";

/**
 * Le partage d'une vente entre le client et son organisme de tiers payant.
 *
 * Deux règles fondent tout le reste.
 *
 * **La part assurance se calcule, la part client se déduit.** Elle est
 * obtenue par soustraction du total, jamais par un second calcul de
 * pourcentage. Deux arrondis indépendants laisseraient un centime dans la
 * nature une fois sur deux — le client paierait 0,01 DH de trop ou de
 * moins, et la caisse ne tomberait jamais juste. Par construction, ici,
 * `partClient + partAssurance == total`, exactement.
 *
 * **L'organisme ne rembourse jamais plus que le prix payé.** La base de
 * remboursement est un tarif de référence : elle peut dépasser le prix de
 * vente réel, notamment sur un générique vendu moins cher que le princeps.
 * Sans plafond, l'officine réclamerait plus qu'elle n'a encaissé.
 */

export type LigneRemboursable = {
  unitPrice: number;
  quantity: number;
  /** Absents sur une ligne issue d'un cache d'avant le tiers payant. */
  remboursable?: boolean;
  /** Tarif de référence unitaire. `null` sur un produit non renseigné. */
  baseRemboursement?: number | null;
};

export type PartageTiersPayant = {
  total: number;
  /** À encaisser tout de suite, au comptoir. */
  partClient: number;
  /** À réclamer à l'organisme. Zéro s'il n'y a rien de remboursable. */
  partAssurance: number;
};

/** Y a-t-il de quoi proposer un organisme ? */
export function contientRemboursable(lignes: LigneRemboursable[]): boolean {
  return lignes.some((ligne) => estRemboursable(ligne));
}

/**
 * Une ligne ne compte que si elle est remboursable **et** porte une base.
 * Un produit marqué remboursable dont la base n'a jamais été saisie ne
 * donne droit à rien : mieux vaut ne rien réclamer que réclamer au hasard.
 */
function estRemboursable(ligne: LigneRemboursable): boolean {
  return Boolean(
    ligne.remboursable && ligne.baseRemboursement != null && ligne.baseRemboursement > 0,
  );
}

/**
 * Ce qu'une ligne rapporte à l'organisme, arrondi au centime.
 *
 * Arrondi **par ligne** et non sur la somme : c'est ligne par ligne qu'un
 * bordereau réclame, et c'est donc ligne par ligne que le montant doit
 * être un vrai montant. Le total de la vente est la somme de ces
 * arrondis, ce qui garantit que les lignes archivées et le total stocké
 * disent la même chose — un total arrondi séparément aurait dérivé d'un
 * centime dès qu'une ligne tombe au milieu.
 */
export function partAssuranceLigne(
  ligne: LigneRemboursable,
  tauxCouverture: number | null,
): number {
  if (tauxCouverture === null || tauxCouverture <= 0) return 0;
  if (!estRemboursable(ligne)) return 0;
  const base = ligne.baseRemboursement! * ligne.quantity;
  const paye = ligne.unitPrice * ligne.quantity;
  return round2(Math.min(base, paye) * (tauxCouverture / 100));
}

export function calculerPartage(
  lignes: LigneRemboursable[],
  /** Taux de l'organisme, en pourcentage. `null` quand aucun n'est choisi. */
  tauxCouverture: number | null,
): PartageTiersPayant {
  const total = round2(
    lignes.reduce((somme, ligne) => somme + ligne.unitPrice * ligne.quantity, 0),
  );

  if (tauxCouverture === null || tauxCouverture <= 0) {
    return { total, partClient: total, partAssurance: 0 };
  }

  // `round2` sur la somme d'arrondis : sans lui, additionner des nombres
  // à deux décimales en virgule flottante laisse des 0,30000000000000004.
  const partAssurance = round2(
    lignes.reduce((somme, ligne) => somme + partAssuranceLigne(ligne, tauxCouverture), 0),
  );

  /**
   * Second plafond, sur le total.
   *
   * Inatteignable tant que le taux reste dans 0–100, ce que la validation
   * de l'organisme impose : le plafond par ligne borne déjà chaque
   * contribution au prix payé, donc leur somme au total. Aucun test ne le
   * couvre, et c'est normal — il n'existe aucune entrée valide qui le
   * déclenche.
   *
   * Il reste parce que `tauxCouverture` vient de la base, pas du
   * formulaire : une ligne écrite avant la borne, ou par un script,
   * produirait sinon une part client négative — une caisse qui rend de
   * l'argent.
   */
  const plafonnee = Math.min(partAssurance, total);

  return { total, partClient: round2(total - plafonnee), partAssurance: plafonnee };
}

/**
 * La base de remboursement à afficher pour une ligne de vente.
 *
 * L'instantané figé au moment de la vente d'abord, la valeur actuelle du
 * produit seulement en repli. L'ordre n'est pas indifférent : lire le
 * produit en premier afficherait la base d'aujourd'hui sur une vente de
 * l'an dernier, et donnerait donc un montant qui ne correspond à rien —
 * ni à ce qui a été réclamé, ni à ce que l'organisme a payé.
 *
 * Le repli n'existe que pour les ventes antérieures à l'instantané, qui
 * n'ont rien de mieux à offrir.
 */
export function baseAppliquee(
  instantane: number | null,
  duProduit: number | null,
): number | null {
  return instantane ?? duProduit;
}
