import { createHash } from "node:crypto";
import { nettoyerAlphanumerique, SEPARATEUR_QR } from "@/lib/pdf/qr-code";

/**
 * Ce que porte le QR code d'une facture.
 *
 * ## Ce que ce module encode, et ce qu'il ne prétend pas être
 *
 * Les champs suivent ce que la facturation électronique marocaine
 * réclame : identifiant unique du document, identifiants fiscaux de
 * l'émetteur, numéro, montants HT / TVA / TTC, et une empreinte
 * d'intégrité. Je n'ai pas de spécification vérifiable du **format**
 * exact imposé par la DGI — rien d'équivalent au TLV base64 publié par
 * ZATCA en Arabie saoudite. La structure ci-dessous est donc lisible et
 * auto-descriptive, pas « officielle ». Le jour où le format est connu,
 * `chargeUtileQr` est la seule fonction à réécrire.
 *
 * ## Deux limites à connaître
 *
 * **L'empreinte n'est pas une signature.** SHA-256 détecte une altération
 * accidentelle — une ligne recopiée de travers, un montant retouché par
 * mégarde. Elle n'empêche rien : qui modifie la facture peut recalculer
 * l'empreinte, puisque le calcul est public. Une vraie signature exige
 * une clé privée détenue par l'officine, et un certificat pour la
 * rattacher à elle. Tant que la DGI n'en délivre pas, ce champ vaut
 * comme somme de contrôle, et il faut l'appeler ainsi.
 *
 * **Les identifiants de l'acheteur manquent.** L'ICE et l'IF du client ne
 * sont stockés nulle part dans l'application : la fiche client porte un
 * CIN et une immatriculation d'organisme, pas d'identifiants
 * d'entreprise. Les champs sont prévus ci-dessous et restent vides tant
 * que le modèle ne les porte pas.
 */

export type DonneesQrFacture = {
  /** L'identifiant unique de la facture — l'UUID de la ligne en base. */
  uuid: string;
  /** IF de l'officine, tel que recopié sur la facture. */
  identifiantFiscal: string | null;
  /** ICE de l'officine, recopié de même. */
  ice: string | null;
  /** IF de l'acheteur. Absent du modèle aujourd'hui — voir l'en-tête. */
  identifiantFiscalClient?: string | null;
  /** ICE de l'acheteur. Absent du modèle aujourd'hui — voir l'en-tête. */
  iceClient?: string | null;
  /** Numéro affiché, p. ex. « FACT-2026-0001 ». */
  numero: string;
  dateEmission: Date;
  totalHt: number;
  totalTva: number;
  totalTtc: number;
};

/** Longueur de l'empreinte retenue, en caractères hexadécimaux. */
const LONGUEUR_EMPREINTE = 16;

/**
 * La date au format français, en heure locale.
 *
 * Locale, et calculée à la main : `toISOString()` convertit en UTC, et une
 * facture émise à Casablanca le 1er mars à 00 h 30 y devient le 29
 * février. Le QR porterait alors une date contredisant celle imprimée
 * juste au-dessus de lui.
 */
function dateFr(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${jour}/${mois}/${date.getFullYear()}`;
}

/** Les champs, dans l'ordre, avant l'ajout de l'empreinte. */
function champs(donnees: DonneesQrFacture): string[] {
  const emetteur = [
    donnees.identifiantFiscal ? `IF:${nettoyerAlphanumerique(donnees.identifiantFiscal)}` : null,
    donnees.ice ? `ICE:${nettoyerAlphanumerique(donnees.ice)}` : null,
  ].filter((valeur): valeur is string => valeur !== null);

  // Vides tant que la fiche client ne porte pas ces identifiants. Le champ
  // n'est pas émis du tout plutôt qu'émis vide : « IFC: » suivi de rien se
  // lirait comme une donnée manquante sur cette facture-là, alors qu'elle
  // manque partout.
  const acheteur = [
    donnees.identifiantFiscalClient
      ? `IFC:${nettoyerAlphanumerique(donnees.identifiantFiscalClient)}`
      : null,
    donnees.iceClient ? `ICEC:${nettoyerAlphanumerique(donnees.iceClient)}` : null,
  ].filter((valeur): valeur is string => valeur !== null);

  return [
    // Sans tirets : trente-deux caractères au lieu de trente-six, pour la
    // même information. Sur une charge de cette longueur, quatre
    // caractères pèsent sur la version du symbole.
    `UUID:${nettoyerAlphanumerique(donnees.uuid.replace(/-/g, ""))}`,
    ...emetteur,
    ...acheteur,
    `FACT:${nettoyerAlphanumerique(donnees.numero)}`,
    dateFr(donnees.dateEmission),
    `HT:${donnees.totalHt.toFixed(2)}`,
    `TVA:${donnees.totalTva.toFixed(2)}`,
    `TTC:${donnees.totalTtc.toFixed(2)}`,
  ];
}

/**
 * L'empreinte SHA-256 des champs, tronquée.
 *
 * Seize caractères hexadécimaux, soit 64 bits. Assez pour qu'une
 * altération accidentelle ne passe pas — la probabilité qu'un montant
 * retouché retombe sur la même empreinte est de l'ordre de un sur dix-huit
 * milliards de milliards. Les 64 caractères complets coûteraient deux
 * versions de symbole, donc un centimètre de plus sur le papier, pour une
 * garantie que personne ici n'exploite.
 *
 * Exportée pour que le vérificateur puisse recalculer la même chose.
 */
export function empreinteFacture(donnees: DonneesQrFacture): string {
  return createHash("sha256")
    .update(champs(donnees).join("|"))
    .digest("hex")
    .toUpperCase()
    .slice(0, LONGUEUR_EMPREINTE);
}

/**
 * La chaîne encodée dans le QR.
 *
 *     UUID:3F2A... - IF:2378... - ICE:0012... - FACT:FACT-2026-0004 -
 *     23/08/2026 - HT:84.40 - TVA:1.26 - TTC:85.66 - H:A1B2C3D4E5F60718
 *
 * Écrite pour être **lue** autant que relue par une machine : les
 * étiquettes rendent la position des champs indifférente, et un scan rend
 * quelque chose d'intelligible plutôt qu'une suite de nombres.
 *
 * Trois contraintes de forme, toutes imposées par le jeu alphanumérique du
 * QR — en sortir ferait basculer le symbole en mode octet et coûterait
 * 15 % de taille de module : **majuscules**, **point décimal**, **pas
 * d'accent**.
 */
export function chargeUtileQr(donnees: DonneesQrFacture): string {
  return [...champs(donnees), `H:${empreinteFacture(donnees)}`].join(SEPARATEUR_QR);
}
