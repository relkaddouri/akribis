import qrcode from "qrcode-generator";

/**
 * La mécanique commune aux QR codes des documents.
 *
 * Extraite de lib/invoices/qr-code.ts le jour où le Journal Z en a eu
 * besoin à son tour : faire importer « invoices » par la caisse aurait été
 * un contresens, et recopier l'encodage en aurait fait deux versions à
 * tenir d'accord.
 *
 * Ce qui reste propre à chaque document, c'est la **charge utile** — ce
 * qu'on choisit d'y mettre, et sous quelle forme. Elle vit avec lui.
 *
 * ## Pourquoi une matrice et non une image
 *
 * Ce module rend la matrice de modules ; le PDF la dessine en rectangles.
 * Un PNG intermédiaire imposerait un encodeur de plus, une résolution à
 * choisir, et un QR pixellisé à l'impression — alors que le PDF est un
 * format vectoriel et qu'un carré noir est ce qu'il sait dessiner de plus
 * simple.
 */

/** Le séparateur de champs. Trois caractères du jeu dense, et lisible. */
export const SEPARATEUR_QR = " - ";

/**
 * Le jeu alphanumérique du QR : chiffres, majuscules, espace et
 * `$ % * + - . / :`. Rien d'autre.
 */
const ALPHANUMERIQUE = /^[0-9A-Z $%*+\-./:]*$/;

/**
 * Ramène une valeur saisie au jeu alphanumérique du QR.
 *
 * Deux rôles, et les deux comptent :
 *
 * - **Correction.** Un numéro contenant le séparateur casserait la
 *   relecture sans que rien ne le signale : le lecteur découperait au
 *   mauvais endroit et lirait le champ suivant de travers.
 * - **Densité.** Un seul caractère hors jeu — une minuscule, une espace
 *   insécable recopiée d'un tableur — suffit à faire basculer tout le
 *   symbole en mode octet, donc à réduire la taille des modules. La mise
 *   en majuscules n'est pas cosmétique : c'est ce qui garde le QR
 *   scannable.
 */
export function nettoyerAlphanumerique(valeur: string): string {
  return (
    valeur
      .toUpperCase()
      .replace(/[^0-9A-Z $%*+\-./:]/g, "")
      // Le séparateur lui-même, s'il s'est glissé dans une valeur. Le
      // tiret seul reste : les numéros de document en contiennent.
      .replace(/ - /g, " ")
      .trim()
  );
}

/**
 * La matrice de modules, `true` pour un module noir.
 *
 * Correction d'erreur au niveau M (~15 %) : un document d'officine se
 * froisse, se photocopie et se scanne de travers, mais il n'est pas exposé
 * comme une étiquette de rayon — H doublerait la taille du symbole pour
 * une robustesse dont on n'a pas l'usage.
 */
export type NiveauCorrection = "M" | "Q" | "H";

/**
 * La part du côté du symbole qu'un logo central peut occuper.
 *
 * 0,22 du côté, soit moins de 5 % de la surface — bien en deçà des 25 %
 * que le niveau Q sait reconstruire. La marge est volontairement large :
 * les modules détruits sont **contigus**, et un paquet d'un seul tenant
 * pèse plus lourd sur la correction que la même quantité éparpillée.
 */
export const PART_LOGO = 0.22;

export function matriceQr(charge: string, niveau: NiveauCorrection = "M"): boolean[][] {
  const qr = qrcode(0, niveau);
  /*
   * Mode alphanumérique quand c'est possible : 5,5 bits par caractère au
   * lieu de 8. Sur la charge d'un document, cela fait plusieurs modules de
   * moins — donc des modules plus grands pour la même place sur le papier,
   * et c'est la taille des modules qui décide de ce qu'un téléphone
   * arrive à lire.
   *
   * Repli sur le mode octet plutôt qu'exception : une charge réécrite un
   * jour pour un format officiel ne doit pas faire échouer la génération
   * du PDF entier.
   */
  qr.addData(charge, ALPHANUMERIQUE.test(charge) ? "Alphanumeric" : "Byte");
  qr.make();

  const taille = qr.getModuleCount();
  return Array.from({ length: taille }, (_, ligne) =>
    Array.from({ length: taille }, (_, colonne) => qr.isDark(ligne, colonne)),
  );
}
