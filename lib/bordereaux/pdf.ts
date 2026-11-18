import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  A4,
  INK,
  MARGIN,
  MUTED,
  chargerLogo,
  fit,
  piedDePage,
  rule,
  text,
  textRight,
  type PdfContext,
} from "@/lib/pdf/document";
import { LIBELLES_LIGNE } from "@/lib/bordereaux/export";
import type { BordereauDetail } from "@/lib/server/bordereaux";
import type { ReceiptBranding } from "@/lib/server/pharmacy";

/**
 * Le bordereau, en PDF imprimable — le document que l'officine adresse à
 * l'organisme.
 *
 * Bâti sur la même boîte à outils que la facture et le bon de livraison :
 * mêmes marges, mêmes filets, mêmes tailles. Un organisme qui reçoit
 * plusieurs documents de la même officine doit les reconnaître.
 */

/**
 * Les colonnes du tableau, en bandes {gauche, droite} plutôt qu'en simples
 * abscisses.
 *
 * Deux colonnes alignées à droite sur la MÊME abscisse s'écrivent l'une
 * par-dessus l'autre — c'est ce qui est arrivé au montant et au statut,
 * qui partageaient le bord droit de la page. Une abscisse seule ne dit
 * rien de la place occupée ; une bande, si, et `COLONNES_DISJOINTES` en
 * bas de ce fichier le vérifie.
 */
export const COLONNES = {
  ordre: { gauche: MARGIN, droite: MARGIN + 20 },
  vente: { gauche: MARGIN + 26, droite: MARGIN + 126 },
  date: { gauche: MARGIN + 132, droite: MARGIN + 190 },
  client: { gauche: MARGIN + 196, droite: A4.width - MARGIN - 150 },
  montant: { gauche: A4.width - MARGIN - 146, droite: A4.width - MARGIN - 72 },
  statut: { gauche: A4.width - MARGIN - 68, droite: A4.width - MARGIN },
} as const;

/** L'ordre de lecture, pour la vérification de non-chevauchement. */
export const ORDRE_COLONNES = ["ordre", "vente", "date", "client", "montant", "statut"] as const;

function dirham(valeur: number): string {
  return valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function jour(date: Date): string {
  return new Date(date).toLocaleDateString("fr-FR");
}

function enteteTableau(ctx: PdfContext, y: number) {
  const t = { size: 8, bold: true, color: MUTED };
  text(ctx, "N°", COLONNES.ordre.gauche, y, t);
  text(ctx, "N° DE VENTE", COLONNES.vente.gauche, y, t);
  text(ctx, "DATE", COLONNES.date.gauche, y, t);
  text(ctx, "ASSURE", COLONNES.client.gauche, y, t);
  // « PART ORG. » abrégé : « PART ORGANISME » à 8 pt déborde de sa bande et
  // repartirait mordre sur la colonne du client.
  textRight(ctx, "PART ORG.", COLONNES.montant.droite, y, t);
  textRight(ctx, "STATUT", COLONNES.statut.droite, y, t);
}

export async function renderBordereauPdf(
  bordereau: BordereauDetail,
  branding: ReceiptBranding,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Bordereau ${bordereau.numero}`);
  doc.setCreator("Akribis Pharma");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = branding.showLogo ? await chargerLogo(doc, branding.logoUrl) : null;

  const pages: PdfContext[] = [];
  const nouvellePage = (): PdfContext => {
    const ctx = { page: doc.addPage([A4.width, A4.height]), font, bold };
    pages.push(ctx);
    return ctx;
  };

  let ctx = nouvellePage();
  const right = A4.width - MARGIN;
  let y = A4.height - MARGIN;

  // ── En-tête : l'officine à gauche, le bordereau à droite ──
  let xTexte = MARGIN;
  if (logo) {
    const taille = 42;
    const ratio = logo.width / logo.height;
    ctx.page.drawImage(logo, {
      x: MARGIN,
      y: y - taille + 10,
      width: taille * ratio,
      height: taille,
    });
    xTexte = MARGIN + taille * ratio + 12;
  }

  text(ctx, branding.pharmacyName, xTexte, y, { size: 16, bold: true });
  textRight(ctx, "BORDEREAU", right, y, { size: 16, bold: true });
  y -= 18;

  for (const ligne of [
    branding.address,
    branding.phone,
    branding.ice ? `ICE : ${branding.ice}` : null,
    branding.inpe ? `INPE : ${branding.inpe}` : null,
    branding.patente ? `Patente : ${branding.patente}` : null,
  ]) {
    if (!ligne) continue;
    text(ctx, ligne, xTexte, y, { size: 9, color: MUTED });
    y -= 12;
  }

  let metaY = A4.height - MARGIN - 18;
  textRight(ctx, bordereau.numero, right, metaY, { size: 11, bold: true });
  metaY -= 13;
  textRight(ctx, `Édité le ${jour(new Date())}`, right, metaY, { size: 9, color: MUTED });

  y = Math.min(y, metaY) - 22;
  rule(ctx, y);
  y -= 20;

  // ── Destinataire et période ──
  text(ctx, "Destinataire", MARGIN, y, { size: 9, color: MUTED });
  textRight(ctx, "Période couverte", right, y, { size: 9, color: MUTED });
  y -= 14;
  text(ctx, bordereau.insurerNom, MARGIN, y, { size: 11, bold: true });
  textRight(ctx, `${jour(bordereau.periodeDebut)} — ${jour(bordereau.periodeFin)}`, right, y, {
    size: 11,
  });
  y -= 26;

  // ── Tableau ──
  enteteTableau(ctx, y);
  y -= 6;
  rule(ctx, y);
  y -= 14;

  const BAS_DE_PAGE = MARGIN + 110;

  bordereau.lignes.forEach((ligne, index) => {
    if (y < BAS_DE_PAGE) {
      ctx = nouvellePage();
      y = A4.height - MARGIN;
      enteteTableau(ctx, y);
      y -= 6;
      rule(ctx, y);
      y -= 14;
    }

    const rejetee = ligne.statut === "REJETEE";
    const couleur = rejetee ? MUTED : INK;

    text(ctx, String(index + 1), COLONNES.ordre.gauche, y, { size: 9, color: couleur });
    text(ctx, ligne.reference, COLONNES.vente.gauche, y, { size: 9, color: couleur });
    text(ctx, jour(ligne.createdAt), COLONNES.date.gauche, y, { size: 9, color: couleur });
    text(
      ctx,
      fit(ctx, ligne.clientName ?? "Client de passage", COLONNES.client.droite - COLONNES.client.gauche, 9),
      COLONNES.client.gauche,
      y,
      { size: 9, color: couleur },
    );
    textRight(ctx, dirham(ligne.montantReclame), COLONNES.montant.droite, y, {
      size: 9,
      color: couleur,
    });
    textRight(ctx, LIBELLES_LIGNE[ligne.statut] ?? ligne.statut, COLONNES.statut.droite, y, {
      size: 8,
      color: rejetee ? rgb(0.8, 0.1, 0.1) : MUTED,
    });
    y -= 14;

    if (ligne.motifRejet) {
      text(ctx, fit(ctx, `Motif : ${ligne.motifRejet}`, right - COLONNES.vente.gauche, 8), COLONNES.vente.gauche, y, {
        size: 8,
        color: MUTED,
      });
      y -= 12;
    }
  });

  // ── Totaux ──
  y -= 6;
  rule(ctx, y);
  y -= 18;

  const retenues = bordereau.lignes.filter((ligne) => ligne.statut !== "REJETEE").length;
  text(ctx, `${retenues} dossier${retenues > 1 ? "s" : ""} retenu${retenues > 1 ? "s" : ""}`, MARGIN, y, {
    size: 9,
    color: MUTED,
  });
  textRight(ctx, "Total réclamé à l'organisme", COLONNES.montant.gauche - 10, y, {
    size: 10,
    bold: true,
  });
  textRight(ctx, `${dirham(bordereau.montantAttendu)} DH`, right, y, { size: 12, bold: true });

  const rejets = bordereau.lignes.length - retenues;
  if (rejets > 0) {
    y -= 14;
    text(ctx, `${rejets} ligne${rejets > 1 ? "s" : ""} rejetée${rejets > 1 ? "s" : ""}, non comptée${rejets > 1 ? "s" : ""} dans le total`, MARGIN, y, {
      size: 8,
      color: MUTED,
    });
  }

  // ── Signatures : deux cadres, l'officine et l'organisme ──
  y -= 40;
  const largeur = (right - MARGIN - 24) / 2;
  for (const [index, titre] of [
    "Cachet et signature du pharmacien",
    "Cadre réservé à l'organisme",
  ].entries()) {
    const x = MARGIN + index * (largeur + 24);
    ctx.page.drawRectangle({
      x,
      y: y - 60,
      width: largeur,
      height: 60,
      borderColor: rgb(0.85, 0.87, 0.9),
      borderWidth: 0.7,
    });
    text(ctx, titre, x + 8, y - 14, { size: 8, color: MUTED });
  }

  pages.forEach((page, index) => piedDePage(page, index + 1, pages.length));

  return doc.save();
}

/**
 * Les bandes se suivent sans se chevaucher.
 *
 * Exporté pour être testé : le défaut d'origine — montant et statut
 * alignés à droite sur la même abscisse — ne se voyait ni à la
 * compilation, ni dans un PDF qu'aucun test ne relit, seulement à
 * l'impression, en travers de la page.
 */
export function colonnesDisjointes(): boolean {
  return ORDRE_COLONNES.every((nom, index) => {
    const bande = COLONNES[nom];
    if (bande.droite <= bande.gauche) return false;
    const suivante = ORDRE_COLONNES[index + 1];
    return suivante === undefined || bande.droite <= COLONNES[suivante].gauche;
  });
}
