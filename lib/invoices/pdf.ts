import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { InvoiceDetail } from "@/lib/server/invoices";
import type { ReceiptBranding } from "@/lib/server/pharmacy";
import { formatMad, summariseTvaByRate } from "@/lib/invoices/totals";
import { chargeUtileQr } from "@/lib/invoices/qr-code";
import { matriceQr, PART_LOGO } from "@/lib/pdf/qr-code";
import {
  A4,
  chargerIconeAkribis,
  chargerLogo,
  fit,
  MARGIN,
  MUTED,
  piedDePage,
  qrMatrix,
  RULE,
  rule,
  text,
  textRight,
  type PdfContext,
} from "@/lib/pdf/document";

/**
 * Renders an invoice to a real PDF. The drawing primitives live in
 * lib/pdf/document.ts, shared with the purchase order so both documents
 * keep the same typography and margins.
 */

/**
 * Côté du QR code, en points PDF. 100 pt ≈ 3,5 cm.
 *
 * ## D'où vient ce chiffre
 *
 * Deux facteurs, et un seul est négociable. La charge utile porte
 * désormais l'UUID, les identifiants fiscaux, les trois montants et une
 * empreinte : environ 170 caractères, soit 53 modules au niveau de
 * correction Q — niveau imposé par l'icône posée au centre. Il faut
 * ensuite 0,9 mm par module, seuil tiré de ce qu'on a réellement observé :
 * le téléphone de l'officine a décodé sans peine un symbole à 0,91 mm.
 * 53 × 0,9 mm ≈ 136 pt, arrondi à 140.
 *
 * Le compte de modules ne bouge pas avec les montants : une journée à
 * 1,5 million de dirhams allonge la charge de neuf caractères et reste
 * dans la même version de symbole.
 *
 * Le symbole a donc regrossi après avoir été ramené à 100 pt, et ce n'est
 * pas un retour en arrière : c'est le prix de six champs de plus. Le
 * réduire demanderait d'en retirer — l'UUID pèse à lui seul trente-sept
 * caractères.
 */
const COTE_QR = 140;

/**
 * Hauteur réservée en bas de page pour le bloc des totaux et le QR code.
 *
 * C'est ce que la boucle des lignes garde libre avant de passer à la page
 * suivante. Sans la part du QR, un tableau qui s'arrête juste au-dessus
 * de la limite laissait le symbole se dessiner par-dessus les totaux —
 * illisible, et sur la seule zone de la facture qui doit l'être.
 */
const RESERVE_BAS_DE_PAGE = 140 + COTE_QR + 24;

export async function renderInvoicePdf(
  invoice: InvoiceDetail,
  /**
   * Pour le logo seulement. Le nom, l'adresse et les identifiants
   * viennent de la facture elle-même, où ils ont été recopiés à
   * l'émission : une officine qui déménage ne doit pas réécrire ses
   * anciennes factures. Le logo, lui, est un ornement — le prendre au
   * jour d'aujourd'hui ne fausse rien.
   */
  branding?: ReceiptBranding,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Facture ${invoice.number}`);
  doc.setCreator("Akribis");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([A4.width, A4.height]);
  let ctx: PdfContext = { page, font, bold };
  /*
   * Les pages sont collectées au fil du rendu : le pied porte « Page X
   * sur Y », et Y n'est connu qu'une fois la dernière ligne écrite.
   */
  const pages: PdfContext[] = [ctx];

  const right = A4.width - MARGIN;
  let y = A4.height - MARGIN;

  // ── En-tête : l'officine à gauche, la facture à droite. Même dessin que
  //    le bordereau et le Journal Z — ces pièces se rangent dans le même
  //    classeur, et une seule qui détonne se lit comme venant d'ailleurs.
  const logo = branding?.showLogo ? await chargerLogo(doc, branding.logoUrl) : null;
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

  text(ctx, invoice.pharmacyName, xTexte, y, { size: 16, bold: true });
  textRight(ctx, "FACTURE", right, y, { size: 16, bold: true });
  y -= 18;

  for (const line of [
    invoice.pharmacyAddress,
    invoice.pharmacyPhone,
    invoice.pharmacyIdentifiantFiscal ? `IF : ${invoice.pharmacyIdentifiantFiscal}` : null,
    invoice.pharmacyIce ? `ICE : ${invoice.pharmacyIce}` : null,
  ]) {
    if (!line) continue;
    text(ctx, line, xTexte, y, { size: 9, color: MUTED });
    y -= 12;
  }

  let metaY = A4.height - MARGIN - 18;
  textRight(ctx, invoice.number, right, metaY, { size: 11, bold: true });
  metaY -= 13;
  textRight(ctx, invoice.issuedAt.toLocaleDateString("fr-FR"), right, metaY, {
    size: 9,
    color: MUTED,
  });
  if (invoice.status === "cancelled") {
    metaY -= 13;
    textRight(ctx, "ANNULEE", right, metaY, { size: 10, bold: true, color: rgb(0.8, 0.1, 0.1) });
  }

  y = Math.min(y, metaY) - 22;
  rule(ctx, y);
  y -= 20;

  // ── Bill-to. Same block whatever the payer is: individual, insurer or
  //    company — the format makes no distinction. ──
  text(ctx, "Facturé à", MARGIN, y, { size: 9, color: MUTED });
  y -= 14;
  text(ctx, invoice.clientName ?? "Client de passage", MARGIN, y, { size: 11, bold: true });
  y -= 26;

  // ── Line-items table ──
  const COL_QTY = MARGIN + 250;
  const COL_PU = MARGIN + 320;
  const COL_TVA = MARGIN + 390;
  const COL_HT = right;

  text(ctx, "Désignation", MARGIN, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "Qté", COL_QTY, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "P.U. HT", COL_PU, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "TVA", COL_TVA, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "Total HT", COL_HT, y, { size: 9, bold: true, color: MUTED });
  y -= 8;
  rule(ctx, y);
  y -= 16;

  for (const line of invoice.lines) {
    // Paginate before drawing, so a line is never split across pages.
    if (y < MARGIN + RESERVE_BAS_DE_PAGE) {
      page = doc.addPage([A4.width, A4.height]);
      ctx = { page, font, bold };
      pages.push(ctx);
      y = A4.height - MARGIN;
    }
    text(ctx, fit(ctx, line.designation, 235, 10), MARGIN, y);
    textRight(ctx, String(line.quantity), COL_QTY, y);
    textRight(ctx, line.unitPriceHt.toFixed(2), COL_PU, y);
    textRight(ctx, `${line.tvaRate.toFixed(0)} %`, COL_TVA, y);
    textRight(ctx, line.totalHt.toFixed(2), COL_HT, y);
    y -= 16;
  }

  y -= 4;
  rule(ctx, y);
  y -= 20;

  // ── Totals, plus the per-rate VAT recap an invoice must carry when
  //    several rates appear on the same document. ──
  const labelRight = right - 110;
  const recap = summariseTvaByRate(
    invoice.lines.map((line) => ({
      productId: null,
      designation: line.designation,
      quantity: line.quantity,
      unitPriceHt: line.unitPriceHt,
      tvaRate: line.tvaRate,
      totalHt: line.totalHt,
      totalTva: line.totalTva,
      totalTtc: line.totalTtc,
    })),
  );

  textRight(ctx, "Total HT", labelRight, y, { size: 10, color: MUTED });
  textRight(ctx, formatMad(invoice.totalHt), right, y, { size: 10 });
  y -= 15;

  for (const entry of recap) {
    textRight(ctx, `TVA ${entry.rate.toFixed(0)} %`, labelRight, y, { size: 10, color: MUTED });
    textRight(ctx, formatMad(entry.tva), right, y, { size: 10 });
    y -= 15;
  }

  if (recap.length > 1) {
    textRight(ctx, "Total TVA", labelRight, y, { size: 10, color: MUTED });
    textRight(ctx, formatMad(invoice.totalTva), right, y, { size: 10 });
    y -= 15;
  }

  y -= 4;
  ctx.page.drawLine({
    start: { x: labelRight - 60, y },
    end: { x: right, y },
    thickness: 0.7,
    color: RULE,
  });
  y -= 18;
  textRight(ctx, "Total TTC", labelRight, y, { size: 12, bold: true });
  textRight(ctx, formatMad(invoice.totalTtc), right, y, { size: 12, bold: true });

  // ── QR code, en bas à droite de la dernière page ──
  //
  // Position fixe, et non à la suite du flux : le bas de page est le seul
  // endroit où le symbole se trouve toujours au même endroit quelle que
  // soit la longueur du tableau. C'est ce qui permet de le scanner sans
  // chercher, et ce que `RESERVE_BAS_DE_PAGE` garde libre.
  const matrice = matriceQr(
    chargeUtileQr({
      uuid: invoice.id,
      identifiantFiscal: invoice.pharmacyIdentifiantFiscal,
      ice: invoice.pharmacyIce,
      numero: invoice.number,
      dateEmission: invoice.issuedAt,
      totalHt: invoice.totalHt,
      totalTva: invoice.totalTva,
      totalTtc: invoice.totalTtc,
    }),
    // Niveau Q : l'icône au centre détruit des modules, et il faut de quoi
    // les reconstruire. Le niveau M par défaut suffirait sur le papier —
    // moins de 5 % de la surface est recouverte — mais les modules perdus
    // sont **contigus**, et un paquet d'un seul tenant pèse plus lourd sur
    // la correction que la même quantité éparpillée.
    "Q",
  );
  qrMatrix(ctx, matrice, right - COTE_QR, MARGIN, COTE_QR, {
    logo: (await chargerIconeAkribis(doc)) ?? undefined,
    partLogo: PART_LOGO,
  });
  textRight(ctx, "Facture électronique", right, MARGIN + COTE_QR + 6, {
    size: 8,
    color: MUTED,
  });

  pages.forEach((pageDuDocument, index) =>
    piedDePage(pageDuDocument, index + 1, pages.length),
  );

  return doc.save();
}
