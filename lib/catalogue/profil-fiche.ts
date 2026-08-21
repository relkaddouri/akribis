/**
 * Quelle fiche montrer selon la famille du produit.
 *
 * Un médicament et un shampooing ne se décrivent pas avec les mêmes
 * champs. Jusqu'ici la fiche catalogue affichait le vocabulaire du
 * médicament pour tout le monde : sur un roller Puressentiel, ça donnait
 * neuf lignes vides — DCI, tableau, PPV, remboursement — et **aucune** des
 * informations qui existent réellement pour lui : sa marque, son rayon,
 * ses étiquettes, son prix indicatif.
 *
 * La règle appliquée partout ici : on choisit les sections d'après la
 * catégorie, mais **on n'escamote jamais une donnée qui existe**. Un champ
 * hors profil mais rempli reste affiché — sinon la fiche mentirait par
 * omission, ce qui est pire qu'une ligne vide.
 */

export type ProfilFiche = "medicament" | "parapharmacie";

/**
 * `DISPOSITIF_MEDICAL` suit le profil parapharmacie : un tensiomètre n'a ni
 * DCI, ni posologie, ni prix réglementé, mais il a une marque et un rayon.
 *
 * Une catégorie absente retombe sur « médicament » : c'est ce qu'était tout
 * le catalogue avant l'arrivée de la parapharmacie, et c'est le profil le
 * plus complet — il montre donc plus, jamais moins.
 */
export function profilDe(categorie: string | null | undefined): ProfilFiche {
  return categorie === "PARAPHARMACEUTIQUE" || categorie === "DISPOSITIF_MEDICAL"
    ? "parapharmacie"
    : "medicament";
}

/** Vrai si la valeur mérite d'être affichée hors de son profil. */
export function estRenseigne(valeur: unknown): boolean {
  if (valeur === null || valeur === undefined) return false;
  if (typeof valeur === "string") return valeur.trim() !== "";
  if (typeof valeur === "boolean") return valeur;
  return true;
}
