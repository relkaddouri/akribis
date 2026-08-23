import qrcode from "qrcode-generator";

/**
 * Le QR code apposé sur chaque facture.
 *
 * ## Ce que ce module encode, et ce qu'il ne prétend pas être
 *
 * La DGI marocaine déploie la facturation électronique, mais je n'ai pas
 * de spécification vérifiable du format de QR qu'elle impose — rien
 * d'équivalent au TLV base64 publié par ZATCA en Arabie saoudite. Ce
 * fichier n'invente donc pas de structure « officielle » : il encode les
 * quatre données que porte toute facture — identifiant fiscal de
 * l'émetteur, numéro, date, total TTC — dans un format lisible et
 * auto-descriptif.
 *
 * Le jour où le format exact est connu, `chargeUtileQr` est la seule
 * fonction à réécrire. Le tracé PDF et le test de relecture ne bougent
 * pas : ils travaillent sur la chaîne, quelle qu'elle soit.
 *
 * ## Pourquoi une matrice et non une image
 *
 * `qrcode-generator` rend la matrice de modules ; le PDF la dessine en
 * rectangles. Un PNG intermédiaire imposerait un encodeur de plus, une
 * résolution à choisir, et un QR pixellisé à l'impression — alors que le
 * PDF est un format vectoriel et qu'un carré noir est ce qu'il sait
 * dessiner de plus simple.
 */

export type DonneesQrFacture = {
  /** IF de l'officine, tel que recopié sur la facture. */
  identifiantFiscal: string | null;
  /** Numéro affiché, p. ex. « FACT-2026-0001 ». */
  numero: string;
  dateEmission: Date;
  totalTtc: number;
};

/**
 * Le séparateur entre champs.
 *
 * Un tiret entouré d'espaces, et non un caractère technique : la charge
 * se lit comme une phrase dans un lecteur de QR, ce qui est tout
 * l'intérêt de la forme retenue. Les trois caractères appartiennent au
 * jeu alphanumérique, condition pour rester dans le mode dense.
 */
const SEPARATEUR = " - ";

/**
 * Le jeu alphanumérique du QR : chiffres, majuscules, espace et
 * `$ % * + - . / :`. Rien d'autre.
 */
const ALPHANUMERIQUE = /^[0-9A-Z $%*+\-./:]*$/;

/**
 * La date au format français, en heure locale.
 *
 * Locale, et calculée à la main : `toISOString()` convertit en UTC, et
 * une facture émise à Casablanca le 1er mars à 00 h 30 y devient le
 * 29 février. Le QR porterait alors une date contredisant celle imprimée
 * juste au-dessus de lui.
 *
 * `toLocaleDateString` est écarté pour une autre raison : son résultat
 * dépend de l'ICU du moteur, et une locale absente rendrait « 8/22/2026 »
 * sur une facture marocaine.
 */
function dateFr(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${jour}/${mois}/${date.getFullYear()}`;
}

/**
 * La chaîne encodée dans le QR.
 *
 * Champs étiquetés en français, dans un ordre fixe :
 *
 *     FACTURE FACT-2026-0003 - 22/08/2026 - TOTAL TTC 52.40 MAD - IF 237878237823
 *
 * Écrite pour être **lue**, après avoir constaté qu'un scan ne rend rien
 * d'exploitable sur une suite de champs techniques : l'appareil photo
 * d'iPhone refusait même de l'afficher, faute d'y reconnaître une action.
 * Les étiquettes rendent aussi la position des champs indifférente, ce
 * qui vaut mieux qu'un découpage par index.
 *
 * Trois contraintes de forme, toutes imposées par le jeu alphanumérique
 * du QR — en sortir coûterait 15 % de taille de module :
 *
 * - **majuscules**, les minuscules n'en font pas partie ;
 * - **point décimal** et non virgule, absente du jeu ; le montant
 *   imprimé sur la facture, lui, reste formaté en français ;
 * - **pas d'accent**, d'où « FACTURE » et non « Facture émise le ».
 *
 * L'IF absent — facture émise avant que l'officine ne le renseigne — fait
 * disparaître son segment. Un « IF » suivi de rien se lirait comme une
 * anomalie de la facture plutôt que comme une donnée non saisie.
 */
export function chargeUtileQr(donnees: DonneesQrFacture): string {
  const identifiantFiscal = nettoyer(donnees.identifiantFiscal ?? "");

  return [
    `FACTURE ${nettoyer(donnees.numero)}`,
    dateFr(donnees.dateEmission),
    `TOTAL TTC ${donnees.totalTtc.toFixed(2)} MAD`,
    ...(identifiantFiscal ? [`IF ${identifiantFiscal}`] : []),
  ].join(SEPARATEUR);
}

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
function nettoyer(valeur: string): string {
  return (
    valeur
      .toUpperCase()
      .replace(/[^0-9A-Z $%*+\-./:]/g, "")
      // Le séparateur lui-même, s'il s'est glissé dans une valeur : sans
      // cela un lecteur découperait au mauvais endroit. Le tiret seul
      // reste, il fait partie des numéros de facture.
      .replace(/ - /g, " ")
      .trim()
  );
}

/**
 * La matrice de modules, `true` pour un module noir.
 *
 * Correction d'erreur au niveau M (~15 %) : une facture se froisse, se
 * photocopie et se scanne de travers, mais elle n'est pas exposée comme
 * une étiquette de rayon — H doublerait la taille du symbole pour une
 * robustesse dont on n'a pas l'usage.
 */
export function matriceQr(charge: string): boolean[][] {
  const qr = qrcode(0, "M");
  /*
   * Mode alphanumérique quand c'est possible : 5,5 bits par caractère au
   * lieu de 8. Sur la charge d'une facture, cela fait 29 modules au lieu
   * de 33 — des modules 15 % plus grands pour la même place sur le
   * papier, et c'est la taille des modules qui décide de ce qu'un
   * téléphone arrive à lire.
   *
   * Repli sur le mode octet plutôt qu'exception : `chargeUtileQr`
   * n'écrit aujourd'hui que de l'alphanumérique, mais une charge
   * réécrite pour un futur format DGI ne doit pas faire échouer la
   * génération du PDF entier.
   */
  qr.addData(charge, ALPHANUMERIQUE.test(charge) ? "Alphanumeric" : "Byte");
  qr.make();

  const taille = qr.getModuleCount();
  return Array.from({ length: taille }, (_, ligne) =>
    Array.from({ length: taille }, (_, colonne) => qr.isDark(ligne, colonne)),
  );
}
