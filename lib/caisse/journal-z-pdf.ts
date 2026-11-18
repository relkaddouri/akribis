import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { JournalZ } from "@/lib/server/caisse";
import type { ReceiptBranding } from "@/lib/server/pharmacy";
import {
  A4,
  INK,
  MARGIN,
  MUTED,
  RULE,
  chargerLogo,
  piedDePage,
  rule,
  text,
  textRight,
  type PdfContext,
} from "@/lib/pdf/document";

/**
 * Le Journal Z, en document imprimable.
 *
 * **A4 et non ticket 80 mm** : l'application n'imprime aucun ticket — le
 * reçu de caisse passe par la fenêtre d'impression du navigateur, sur le
 * format de l'imprimante par défaut. Un gabarit 80 mm supposerait une
 * imprimante thermique dont rien ici ne connaît l'existence.
 *
 * ## Même langage que les autres documents
 *
 * En-tête blanc, officine à gauche, nature du document à droite, filets
 * fins pour séparer, cadres de signature en pied : c'est la mise en page
 * du bordereau, de la facture et du bon de commande. Une version
 * antérieure de ce fichier posait un bandeau émeraude pleine largeur —
 * plus moderne isolément, mais l'officine imprime ces pièces dans le même
 * classeur, et une seule qui détonne se lit comme venant d'un autre
 * logiciel.
 *
 * Ce qui change tient donc à la **mise en page**, pas au style : l'écart
 * occupe un cartouche en tête, parce qu'une pièce comptable se lit dans un
 * ordre — d'abord si le compte y est, ensuite ce qui compose la journée.
 */

/** Le gris pâle des cartouches, celui des cadres de signature du bordereau. */
const FOND_BLOC = rgb(0.97, 0.98, 0.98);

const ROUGE = rgb(0.72, 0.11, 0.11);
const VERT = rgb(0.06, 0.45, 0.32);
const AMBRE = rgb(0.68, 0.44, 0.05);

/**
 * « MAD » et non « DH ».
 *
 * Les deux coexistent dans les documents du dépôt — le bordereau écrit
 * DH, la facture MAD — et cet écart est antérieur à ce fichier. Le Z suit
 * la facture, ce qui le met d'accord avec sa propre version à l'écran ;
 * trancher pour tout le monde serait un autre chantier, à décider, pas à
 * glisser au passage d'une refonte de mise en page.
 */
function money(valeur: number): string {
  return `${valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MAD`;
}

function horodatage(date: Date | null): string {
  return date ? new Date(date).toLocaleString("fr-FR") : "—";
}

function jour(date: Date): string {
  return new Date(date).toLocaleDateString("fr-FR");
}

/** L'intitulé d'une section : petites capitales grises, comme les en-têtes de tableau. */
function titreSection(ctx: PdfContext, x: number, y: number, titre: string) {
  text(ctx, titre.toUpperCase(), x, y, { size: 8, bold: true, color: MUTED });
}

function ligne(
  ctx: PdfContext,
  y: number,
  gauche: number,
  droite: number,
  libelle: string,
  valeur: string,
  options: { bold?: boolean } = {},
) {
  text(ctx, libelle, gauche, y, { size: 9, color: options.bold ? INK : MUTED });
  textRight(ctx, valeur, droite, y, { size: 9, bold: options.bold === true });
}

export async function renderJournalZPdf(
  z: JournalZ,
  branding: ReceiptBranding,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Journal Z ${z.session.numeroZ ?? ""}`.trim());
  doc.setCreator("Akribis Pharma");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: PdfContext = { page: doc.addPage([A4.width, A4.height]), font, bold };

  const right = A4.width - MARGIN;
  const largeur = right - MARGIN;
  const logo = branding.showLogo ? await chargerLogo(doc, branding.logoUrl) : null;

  // ── En-tête : l'officine à gauche, le document à droite ──
  let y = A4.height - MARGIN;
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
  textRight(ctx, "JOURNAL Z", right, y, { size: 16, bold: true });
  y -= 18;

  for (const information of [
    branding.address,
    branding.phone,
    z.identifiantFiscal ? `IF : ${z.identifiantFiscal}` : null,
    z.ice ? `ICE : ${z.ice}` : null,
  ]) {
    if (!information) continue;
    text(ctx, information, xTexte, y, { size: 9, color: MUTED });
    y -= 12;
  }

  let metaY = A4.height - MARGIN - 18;
  textRight(ctx, z.session.numeroZ ?? "Session en cours", right, metaY, {
    size: 11,
    bold: true,
  });
  metaY -= 13;
  textRight(ctx, `Édité le ${jour(new Date())}`, right, metaY, { size: 9, color: MUTED });

  y = Math.min(y, metaY) - 22;
  rule(ctx, y);
  y -= 20;

  // ── Ouverture et fermeture, comme « Destinataire / Période » du bordereau ──
  text(ctx, "Ouverte par", MARGIN, y, { size: 9, color: MUTED });
  textRight(ctx, "Clôturée par", right, y, { size: 9, color: MUTED });
  y -= 14;
  text(ctx, `${z.session.ouvreurNom} · ${horodatage(z.session.dateOuverture)}`, MARGIN, y, {
    size: 10,
  });
  textRight(
    ctx,
    // La mention du PIN fait partie de la pièce : le titulaire doit
    // pouvoir distinguer, des mois plus tard, qui a réellement clôturé.
    `${z.session.fermeurNom ?? "—"}${z.session.fermetureParPin ? " (code PIN)" : ""} · ${horodatage(z.session.dateFermeture)}`,
    right,
    y,
    { size: 10 },
  );
  y -= 26;

  // ── L'écart, en cartouche : la question à laquelle un Z répond ──
  const ecart = z.session.ecartCaisse;
  const teinte = ecart === null ? MUTED : ecart === 0 ? VERT : ecart < 0 ? ROUGE : AMBRE;
  const hauteurEcart = 78;

  ctx.page.drawRectangle({
    x: MARGIN,
    y: y - hauteurEcart,
    width: largeur,
    height: hauteurEcart,
    color: FOND_BLOC,
    borderColor: RULE,
    borderWidth: 0.7,
  });
  // Filet de couleur à gauche : porte la réponse avant même la lecture.
  ctx.page.drawRectangle({
    x: MARGIN,
    y: y - hauteurEcart,
    width: 3,
    height: hauteurEcart,
    color: teinte,
  });

  titreSection(ctx, MARGIN + 16, y - 18, "Écart de caisse");
  text(
    ctx,
    ecart === null
      ? "—"
      : ecart === 0
        ? "Le compte y est"
        : `${ecart > 0 ? "+" : "-"}${money(Math.abs(ecart))}`,
    MARGIN + 16,
    y - 44,
    { size: 20, bold: true, color: teinte },
  );

  let yTrois = y - 20;
  for (const [libelle, valeur] of [
    ["Fond de caisse initial", z.session.fondCaisseInitial],
    ["Espèces théoriques", z.session.especesTheoriques],
    ["Espèces comptées", z.session.especesReelles],
  ] as const) {
    ligne(
      ctx,
      yTrois,
      MARGIN + largeur / 2,
      right - 16,
      libelle,
      valeur === null ? "—" : money(valeur),
    );
    yTrois -= 14;
  }

  y -= hauteurEcart + 26;

  // ── Chiffre d'affaires et règlements, deux colonnes ──
  const colonne = (largeur - 24) / 2;
  const xDroite = MARGIN + colonne + 24;

  titreSection(ctx, MARGIN, y, "Chiffre d'affaires");
  titreSection(ctx, xDroite, y, "Par mode de règlement");
  y -= 8;
  rule(ctx, y);
  y -= 14;

  let yGauche = y;
  for (const [libelle, valeur, fort] of [
    ["Nombre de ventes", String(z.totaux.nombreVentes), false],
    ["CA brut TTC", money(z.totaux.caBrut), false],
    ["Retours et annulations", `- ${money(z.totaux.retours)}`, false],
    ["CA net TTC", money(z.totaux.caNet), true],
  ] as const) {
    ligne(ctx, yGauche, MARGIN, MARGIN + colonne, libelle, valeur, { bold: fort });
    yGauche -= 14;
  }

  let yDroite = y;
  for (const [libelle, valeur] of [
    ["Espèces", money(z.paiements.CASH)],
    ["Carte", money(z.paiements.CARD)],
    ["Crédit client", money(z.paiements.CREDIT)],
    // À part, jamais additionnée aux autres : c'est une créance sur
    // l'organisme, pas de l'argent encaissé.
    ["Part organisme (à réclamer)", money(z.paiements.tiersPayant)],
  ] as const) {
    ligne(ctx, yDroite, xDroite, right, libelle, valeur);
    yDroite -= 14;
  }

  y = Math.min(yGauche, yDroite) - 12;
  rule(ctx, y);
  y -= 20;

  // ── TVA collectée ──
  titreSection(ctx, MARGIN, y, "TVA collectée");
  y -= 14;

  if (z.tva.length === 0) {
    text(ctx, "Aucune vente sur cette session.", MARGIN, y, { size: 9, color: MUTED });
    y -= 14;
  } else {
    text(ctx, "TAUX", MARGIN, y, { size: 8, bold: true, color: MUTED });
    textRight(ctx, "BASE HT", MARGIN + largeur / 2, y, { size: 8, bold: true, color: MUTED });
    textRight(ctx, "TVA COLLECTÉE", right, y, { size: 8, bold: true, color: MUTED });
    y -= 6;
    rule(ctx, y);
    y -= 14;

    for (const entree of z.tva) {
      text(ctx, `${entree.taux} %`, MARGIN, y, { size: 9 });
      textRight(ctx, money(entree.baseHt), MARGIN + largeur / 2, y, { size: 9 });
      textRight(ctx, money(entree.tva), right, y, { size: 9 });
      y -= 14;
    }
  }

  if (z.rattrapagesOffline > 0) {
    y -= 6;
    text(
      ctx,
      `${z.rattrapagesOffline} vente(s) hors ligne rattachée(s) à cette journée : elles ont eu lieu un jour`,
      MARGIN,
      y,
      { size: 8, color: MUTED },
    );
    y -= 10;
    text(
      ctx,
      "dont la caisse était déjà clôturée, et figurent donc dans ce Z, pas dans celui de leur date.",
      MARGIN,
      y,
      { size: 8, color: MUTED },
    );
  }

  // ── Signatures : deux cadres, comme sur le bordereau ──
  //
  // Pas de QR ici. Il avait été ajouté pour épargner au comptable la
  // saisie du CA, de la TVA et de l'écart — trois nombres qu'il recopie
  // une fois par jour. Le gain ne valait pas un symbole de cinq
  // centimètres sur une pièce qu'on classe.
  y -= 40;
  const largeurCadre = (right - MARGIN - 24) / 2;
  for (const [index, titre] of [
    "Cachet et signature du pharmacien",
    "Visa du comptable",
  ].entries()) {
    const x = MARGIN + index * (largeurCadre + 24);
    ctx.page.drawRectangle({
      x,
      y: y - 60,
      width: largeurCadre,
      height: 60,
      borderColor: RULE,
      borderWidth: 0.7,
    });
    text(ctx, titre, x + 8, y - 14, { size: 8, color: MUTED });
  }

  // Un Z tient sur une page : ses sections sont de taille fixe, seule la
  // ventilation TVA varie, et de trois lignes au plus.
  piedDePage(ctx, 1, 1);

  return doc.save();
}
