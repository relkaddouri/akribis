/**
 * Un prix de vente resté à zéro : quoi suggérer, et quand le réclamer.
 *
 * `addCatalogueProduitToStock` posait `price: fiche.ppv ?? 0`. Le PPV est
 * le prix public **réglementé** : seules les fiches de médicament en
 * portent un. Toute la parapharmacie entrait donc au stock à 0,00 DH —
 * c'est-à-dire vendable pour rien au comptoir, sans que rien ne le
 * signale, alors que sa fiche porte bel et bien un prix indicatif.
 *
 * Même distinction que pour la TVA (lib/stock/tva.ts) : un champ vide
 * n'est pas toujours un trou. Un laboratoire absent est une information
 * que personne n'a ; un prix de vente à zéro est une perte à chaque
 * passage en caisse.
 */

/**
 * Le prix auquel un produit entre au stock.
 *
 * Le PPV d'abord, parce qu'il est réglementé et fait foi. À défaut le prix
 * indicatif du catalogue, qui n'engage pas mais vaut infiniment mieux que
 * zéro. Et zéro en dernier recours seulement — auquel cas l'interface le
 * réclame, plutôt que de laisser vendre à perte en silence.
 */
export function prixInitial<T>(fiche: {
  ppv: T | null;
  prixVenteIndicatif: T | null;
}): T | number {
  return fiche.ppv ?? fiche.prixVenteIndicatif ?? 0;
}

/**
 * Un prix de vente à zéro est-il à réclamer ?
 *
 * Zéro n'est jamais un prix de vente voulu : un produit gratuit se donne,
 * il ne se saisit pas en caisse à 0,00 DH. Contrairement à la TVA, la
 * question ne se pose donc pas seulement sur les produits remboursables —
 * elle se pose sur tous.
 */
export function prixAComplete(price: number | null | undefined): boolean {
  return price === null || price === undefined || price <= 0;
}

/**
 * Ce qu'on propose d'appliquer, et d'où ça vient.
 *
 * `null` quand le catalogue n'a rien à proposer : le badge reste, sans
 * bouton — mieux vaut réclamer sans suggestion que suggérer un chiffre
 * inventé.
 */
export function prixSuggere(source: {
  ppv?: number | null;
  prixVenteIndicatif?: number | null;
}): { montant: number; origine: string } | null {
  if (source.ppv !== null && source.ppv !== undefined && source.ppv > 0) {
    return { montant: source.ppv, origine: "PPV du catalogue" };
  }
  const indicatif = source.prixVenteIndicatif;
  if (indicatif !== null && indicatif !== undefined && indicatif > 0) {
    return { montant: indicatif, origine: "Prix indicatif du catalogue" };
  }
  return null;
}

/**
 * Ce que représente le stock d'un produit, en dirhams.
 *
 * `null` quand le prix est inconnu ou nul : mieux vaut ne rien annoncer
 * qu'annoncer zéro dirham en jeu sur 120 boîtes — c'est justement le cas
 * qu'un prix resté à zéro produirait.
 */
export function valeurDuStock(
  price: number | null | undefined,
  quantityInStock: number,
): number | null {
  if (prixAComplete(price)) return null;
  return price! * quantityInStock;
}

/**
 * Montant en dirhams, groupé par milliers avec une espace insécable.
 *
 * Pas de `toLocaleString("fr-MA")` : cet ICU-là groupe avec un **point** —
 * « 11.760 DH » se lit comme onze dirhams soixante-seize — et le résultat
 * dépend de l'ICU du navigateur, donc du poste. Une espace insécable
 * ordinaire plutôt qu'une fine : toutes les polices la possèdent, alors
 * que la fine manque à certaines et se rend alors sans largeur, ce qui
 * donnait des montants groupés de travers.
 */
export function dirhamArrondi(value: number): string {
  const groupe = Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${groupe} DH`;
}
