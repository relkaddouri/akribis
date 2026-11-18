import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ReceiptBranding } from "@/lib/server/pharmacy";
import { formatMad } from "@/lib/invoices/totals";
import {
  A4,
  fit,
  MARGIN,
  MUTED,
  piedDePage,
  rule,
  text,
  textRight,
  type PdfContext,
} from "@/lib/pdf/document";
import { formatOrderNumber } from "@/lib/orders/numbering";

export type PurchaseOrderDocument = {
  numero: number;
  createdAt: Date;
  supplierName: string;
  supplierPhone: string | null;
  supplierEmail: string | null;
  lines: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
  totalAmount: number;
};

/**
 * Renders the purchase order the pharmacy sends to its supplier.
 *
 * Shares every drawing primitive with the invoice renderer
 * (lib/pdf/document.ts) so both documents carry the same margins,
 * typography and rules — a supplier receiving both should see one house
 * style, not two.
 */
export async function renderPurchaseOrderPdf(
  order: PurchaseOrderDocument,
  branding: ReceiptBranding,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Bon de commande ${formatOrderNumber(order.numero)}`);
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

  // ── Header: the ordering pharmacy on the left, document identity right ──
  text(ctx, branding.pharmacyName, MARGIN, y, { size: 16, bold: true });
  textRight(ctx, "BON DE COMMANDE", right, y, { size: 16, bold: true });
  y -= 18;

  for (const line of [
    branding.address,
    branding.phone,
    branding.ice ? `ICE : ${branding.ice}` : null,
  ]) {
    if (!line) continue;
    text(ctx, line, MARGIN, y, { size: 9, color: MUTED });
    y -= 12;
  }

  let metaY = A4.height - MARGIN - 18;
  textRight(ctx, formatOrderNumber(order.numero), right, metaY, { size: 11, bold: true });
  metaY -= 13;
  textRight(ctx, order.createdAt.toLocaleDateString("fr-FR"), right, metaY, {
    size: 9,
    color: MUTED,
  });

  y = Math.min(y, metaY) - 22;
  rule(ctx, y);
  y -= 20;

  // ── Supplier the order is addressed to ──
  text(ctx, "Fournisseur", MARGIN, y, { size: 9, color: MUTED });
  y -= 14;
  text(ctx, order.supplierName, MARGIN, y, { size: 11, bold: true });
  y -= 13;
  for (const line of [order.supplierPhone, order.supplierEmail]) {
    if (!line) continue;
    text(ctx, line, MARGIN, y, { size: 9, color: MUTED });
    y -= 12;
  }
  y -= 14;

  // ── Ordered lines ──
  const COL_QTY = MARGIN + 300;
  const COL_PU = MARGIN + 390;
  const COL_TOTAL = right;

  text(ctx, "Produit", MARGIN, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "Qté", COL_QTY, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "P.U.", COL_PU, y, { size: 9, bold: true, color: MUTED });
  textRight(ctx, "Total", COL_TOTAL, y, { size: 9, bold: true, color: MUTED });
  y -= 8;
  rule(ctx, y);
  y -= 16;

  for (const line of order.lines) {
    // Paginate before drawing, so a line is never split across pages.
    if (y < MARGIN + 100) {
      page = doc.addPage([A4.width, A4.height]);
      ctx = { page, font, bold };
      pages.push(ctx);
      y = A4.height - MARGIN;
    }
    text(ctx, fit(ctx, line.productName, 285, 10), MARGIN, y);
    textRight(ctx, String(line.quantity), COL_QTY, y);
    textRight(ctx, line.unitPrice.toFixed(2), COL_PU, y);
    textRight(ctx, (line.unitPrice * line.quantity).toFixed(2), COL_TOTAL, y);
    y -= 16;
  }

  y -= 4;
  rule(ctx, y);
  y -= 20;

  textRight(ctx, "Total commande", right - 110, y, { size: 12, bold: true });
  textRight(ctx, formatMad(order.totalAmount), right, y, { size: 12, bold: true });

  pages.forEach((pageDuDocument, index) =>
    piedDePage(pageDuDocument, index + 1, pages.length),
  );

  return doc.save();
}
