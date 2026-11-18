import type { BordereauDetail } from "@/lib/server/bordereaux";

/**
 * Le bordereau en CSV, pour l'envoi à l'organisme.
 *
 * CSV et non PDF : l'organisme rapproche les lignes une à une, souvent
 * par import dans son propre outil. Un PDF est fait pour être lu, pas
 * pour être rapproché — il obligerait à ressaisir. Excel ouvre ce fichier
 * directement.
 *
 * Point-virgule et non virgule : c'est le séparateur qu'attend Excel dans
 * les régions à virgule décimale, dont le Maroc. Avec une virgule, tout
 * atterrit dans une seule colonne.
 */

const SEPARATEUR = ";";

/** Le BOM UTF-8, sans lequel Excel rend « Périmé » en « PÃ©rimÃ© ». */
const BOM = "﻿";

function champ(valeur: string | number | null): string {
  const texte = valeur === null ? "" : String(valeur);
  // Un nom de client peut contenir un point-virgule ou un guillemet ;
  // sans échappement il décalerait toutes les colonnes suivantes.
  return /[";\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

function ligneCsv(cellules: Array<string | number | null>): string {
  return cellules.map(champ).join(SEPARATEUR);
}

/** Montant en format décimal français — Excel le lit comme un nombre. */
function montant(valeur: number): string {
  return valeur.toFixed(2).replace(".", ",");
}

function jour(date: Date): string {
  return new Date(date).toLocaleDateString("fr-FR");
}

export function bordereauEnCsv(bordereau: BordereauDetail): string {
  const entete = [
    ligneCsv(["Bordereau", bordereau.numero]),
    ligneCsv(["Organisme", bordereau.insurerNom]),
    ligneCsv([
      "Période",
      `${jour(bordereau.periodeDebut)} au ${jour(bordereau.periodeFin)}`,
    ]),
    ligneCsv(["Montant réclamé", montant(bordereau.montantAttendu)]),
    "",
  ];

  const colonnes = ligneCsv([
    "N° de vente",
    "Date",
    "Client",
    "Montant réclamé",
    "Statut",
    "Motif de rejet",
  ]);

  const lignes = bordereau.lignes.map((ligne) =>
    ligneCsv([
      ligne.reference,
      jour(ligne.createdAt),
      ligne.clientName,
      montant(ligne.montantReclame),
      LIBELLES_LIGNE[ligne.statut],
      ligne.motifRejet,
    ]),
  );

  // CRLF : c'est ce qu'attend Excel sous Windows, et les autres tableurs
  // l'acceptent tous.
  return BOM + [...entete, colonnes, ...lignes].join("\r\n") + "\r\n";
}

export const LIBELLES_LIGNE: Record<string, string> = {
  EN_ATTENTE: "En attente",
  ACCEPTEE: "Acceptée",
  REJETEE: "Rejetée",
};

export const LIBELLES_BORDEREAU: Record<string, string> = {
  BROUILLON: "Brouillon",
  ENVOYE: "Envoyé",
  EN_TRAITEMENT: "En traitement",
  CLOTURE: "Clôturé",
};

export function nomFichierCsv(numero: string): string {
  return `${numero}.csv`;
}
