import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ReceiptBranding } from "@/lib/server/pharmacy";
import {
  A4,
  fit,
  MARGIN,
  MUTED,
  rule,
  text,
  textRight,
  type PdfContext,
} from "@/lib/pdf/document";
import { formatDeliveryNumber, formatOrderNumber } from "@/lib/orders/numbering";

export type DeliveryNoteDocument = {
  numero: number;
  dateReception: Date;
  orderNumero: number;
  supplierName: string;
  lines: Array<{
    productName: string;
    /** What the order asked for, for the gap column. */
    quantiteCommandee: number;
    quantiteRecue: number;
  }>;
};

/**
 * Renders the delivery note for one reception — what actually arrived on a
 * given day, against what the order asked for.
 *
 * Shares every drawing primitive with the invoice and purchase-order
 * renderers (lib/pdf/document.ts), so the three documents a supplier sees
 * carry one house style.
 */
export async function renderDeliveryNotePdf(
  delivery: DeliveryNoteDocument,
  branding: ReceiptBranding,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Bon de livraison ${formatDeliveryNumber(delivery.numero)}`);
  doc.setCreator("Akribis");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([A4.width, A4.height]);
  let ctx: PdfContext = { page, font, bold };

  const right = A4.width - MARGIN;
  let y = A4.height - MARGIN;

  text(ctx, branding.pharmacyName, MARGIN, y, { size: 16, bold: true });
  textRight(ctx, "BON DE LIVRAISON", right, y, { size: 16, bold: true });
  y -= 18;

  for (const line of [branding.address, branding.phone, branding.ice ? `ICE : ${branding.ice}` : null]) {
    if (!line) continue;
    text(ctx, line, MARGIN, y, { size: 9, color: MUTED });
    y -= 12;
  }

  let metaY = A4.height - MARGIN - 18;
  textRight(ctx, formatDeliveryNumber(delivery.numero), right, metaY, { size: 11, bold: true });
  metaY -= 13;
  textRight(ctx, delivery.dateReception.toLocaleDateString("fr-FR"), right, metaY, {
    size: 9,
    color: MUTED,
  });
  metaY -= 13;
  // The order it settles against — a delivery note read on its own is
  // meaningless without it.
  textRight(ctx, `Commande ${formatOrderNumber(delivery.orderNumero)}`, right, metaY, {
    size: 9,
    color: MUTED,
  });

  y = Math.min(y, metaY) - 22;
  rule(ctx, y);
  y -= 20;

  text(ctx, "Fournisseur", MARGIN, y, { size: 9, color: MUTED });
  y -= 14;
  text(ctx, delivery.supplierName, MARGIN, y, { size: 11, bold: true });
  y -= 26;

  const COL_ORDERED = MARGIN + 300;
  const COL_RECEIVED = MARGIN + 390;
  const COL_GAP = right;

  text(ctx, "Produit", MARGIN, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "Commandé", COL_ORDERED, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "Reçu", COL_RECEIVED, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "Écart", COL_GAP, y, { size: 9, bold: true, color: MUTED });
  y -= 8;
  rule(ctx, y);
  y -= 16;

  for (const line of delivery.lines) {
    if (y < MARGIN + 80) {
      page = doc.addPage([A4.width, A4.height]);
      ctx = { page, font, bold };
      y = A4.height - MARGIN;
    }
    const gap = line.quantiteRecue - line.quantiteCommandee;
    text(ctx, fit(ctx, line.productName, 285, 10), MARGIN, y);
    textRight(ctx, String(line.quantiteCommandee), COL_ORDERED, y);
    textRight(ctx, String(line.quantiteRecue), COL_RECEIVED, y);
    // Signed, so a short delivery and an over-delivery read differently
    // at a glance; a dash when they match exactly.
    textRight(ctx, gap === 0 ? "—" : gap > 0 ? `+${gap}` : String(gap), COL_GAP, y);
    y -= 16;
  }

  y -= 4;
  rule(ctx, y);
  y -= 24;

  const totalReceived = delivery.lines.reduce((sum, line) => sum + line.quantiteRecue, 0);
  textRight(ctx, "Total reçu", right - 90, y, { size: 12, bold: true });
  textRight(ctx, `${totalReceived} unité${totalReceived > 1 ? "s" : ""}`, right, y, {
    size: 12,
    bold: true,
  });

  return doc.save();
}
