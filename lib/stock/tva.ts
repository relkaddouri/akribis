/**
 * TVA manquante sur un produit remboursable : quoi suggérer.
 *
 * Un champ vide n'a pas toujours le même sens. Un laboratoire absent est
 * une information qu'on n'a pas ; une TVA absente sur un produit
 * **remboursable** est un trou qui fausse la facturation à l'assurance.
 * Cette distinction est tout l'objet du module.
 */

export const TVA_MEDICAMENT = 7;
export const TVA_PARAPHARMACIE = 20;

/**
 * Taux applicable au Maroc : 7 % sur le médicament, 20 % sur la
 * parapharmacie et les dispositifs.
 *
 * Quand la catégorie est inconnue — c'est le cas de presque tout le
 * référentiel CNOPS importé, qui ne la porte pas — on retombe sur 7 %,
 * parce que la question n'est posée que pour un produit **remboursable**,
 * et qu'un produit remboursable est un médicament. La suggestion reste
 * une suggestion : c'est le pharmacien qui valide.
 */
export function suggestedTva(categorie: string | null | undefined): number {
  if (categorie === "PARAPHARMACEUTIQUE" || categorie === "DISPOSITIF_MEDICAL") {
    return TVA_PARAPHARMACIE;
  }
  return TVA_MEDICAMENT;
}

/** Pourquoi ce taux — affiché sous la suggestion. */
export function suggestedTvaReason(categorie: string | null | undefined): string {
  if (categorie === "PARAPHARMACEUTIQUE") return "Taux parapharmacie";
  if (categorie === "DISPOSITIF_MEDICAL") return "Taux dispositif médical";
  if (categorie === "PHARMACEUTIQUE") return "Taux médicament";
  return "Taux médicament — catégorie non renseignée";
}

export type TvaField = "tvaVente" | "tvaAchat";

/**
 * Les TVA à réclamer. Uniquement pour un produit remboursable : ailleurs,
 * une TVA vide est une donnée qu'on n'a simplement pas saisie, et un badge
 * orange sur chaque fiche du stock ne serait plus qu'un bruit de fond.
 */
export function missingTvaFields(product: {
  remboursable: boolean;
  tvaVente: number | null;
  tvaAchat: number | null;
}): TvaField[] {
  if (!product.remboursable) return [];
  const missing: TvaField[] = [];
  if (product.tvaVente === null) missing.push("tvaVente");
  if (product.tvaAchat === null) missing.push("tvaAchat");
  return missing;
}
