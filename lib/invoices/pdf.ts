import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { InvoiceDetail } from "@/lib/server/invoices";
import { formatMad, summariseTvaByRate } from "@/lib/invoices/totals";
import {
  A4,
  fit,
  MARGIN,
  MUTED,
  rule,
  RULE,
  text,
  textRight,
  type PdfContext,
} from "@/lib/pdf/document";

/**
 * Renders an invoice to a real PDF. The drawing primitives live in
 * lib/pdf/document.ts, shared with the purchase order so both documents
 * keep the same typography and margins.
 */

export async function renderInvoicePdf(invoice: InvoiceDetail): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Facture ${invoice.number}`);
  doc.setCreator("Akribis");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([A4.width, A4.height]);
  let ctx: PdfContext = { page, font, bold };

  const right = A4.width - MARGIN;
  let y = A4.height - MARGIN;

  // ── Header: issuer on the left, invoice identity on the right ──
  text(ctx, invoice.pharmacyName, MARGIN, y, { size: 16, bold: true });
  textRight(ctx, "FACTURE", right, y, { size: 16, bold: true });
  y -= 18;

  for (const line of [
    invoice.pharmacyAddress,
    invoice.pharmacyPhone,
    invoice.pharmacyIce ? `ICE : ${invoice.pharmacyIce}` : null,
  ]) {
    if (!line) continue;
    text(ctx, line, MARGIN, y, { size: 9, color: MUTED });
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
    if (y < MARGIN + 140) {
      page = doc.addPage([A4.width, A4.height]);
      ctx = { page, font, bold };
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

  return doc.save();
}
