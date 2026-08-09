/**
 * VAT arithmetic for invoices. Pure and data-layer-agnostic, so the
 * rounding rules — the part that has to be right to the centime on a
 * legal document — can be tested without a database.
 *
 * PRICES ARE HELD EXCLUSIVE OF TAX. A sale line's `unitPrice` is an HT
 * amount, so VAT is added on top (`HT × rate`), not extracted from it.
 * A consequence worth knowing: an invoice's TTC total is therefore
 * higher than the `totalAmount` recorded on the sale it bills, since the
 * POS totals the same HT prices.
 */

/** Rounds to 2 decimals, away from zero on a .005 tie, avoiding float drift. */
export function roundCentimes(value: number): number {
  const scaled = value * 100;
  // `Math.round` alone mis-handles cases like 1.005 * 100 = 100.49999...
  const rounded = Math.round(Number(scaled.toFixed(6)));
  return rounded / 100;
}

export type InvoiceLineInput = {
  productId: string | null;
  designation: string;
  quantity: number;
  /** Unit price excluding tax. */
  unitPriceHt: number;
  /** VAT percentage, e.g. 20 for 20 %. */
  tvaRate: number;
};

export type ComputedInvoiceLine = InvoiceLineInput & {
  totalHt: number;
  totalTva: number;
  totalTtc: number;
};

export type InvoiceTotals = {
  lines: ComputedInvoiceLine[];
  totalHt: number;
  totalTva: number;
  totalTtc: number;
};

/**
 * Rounding happens per line, and the invoice totals are the sum of the
 * already-rounded lines. Rounding only at the end instead would print
 * line amounts that don't add up to the stated total — the first thing an
 * auditor notices.
 */
export function computeInvoiceTotals(inputs: InvoiceLineInput[]): InvoiceTotals {
  const lines: ComputedInvoiceLine[] = inputs.map((line) => {
    const totalHt = roundCentimes(line.unitPriceHt * line.quantity);
    const totalTva = roundCentimes(totalHt * (line.tvaRate / 100));
    return {
      ...line,
      totalHt,
      totalTva,
      totalTtc: roundCentimes(totalHt + totalTva),
    };
  });

  const totalHt = roundCentimes(lines.reduce((sum, line) => sum + line.totalHt, 0));
  const totalTva = roundCentimes(lines.reduce((sum, line) => sum + line.totalTva, 0));

  return { lines, totalHt, totalTva, totalTtc: roundCentimes(totalHt + totalTva) };
}

/** Per-rate recap ("dont TVA 20 % : x MAD"), which an invoice must show when rates differ. */
export function summariseTvaByRate(
  lines: ComputedInvoiceLine[],
): Array<{ rate: number; baseHt: number; tva: number }> {
  const byRate = new Map<number, { baseHt: number; tva: number }>();
  for (const line of lines) {
    const entry = byRate.get(line.tvaRate) ?? { baseHt: 0, tva: 0 };
    entry.baseHt += line.totalHt;
    entry.tva += line.totalTva;
    byRate.set(line.tvaRate, entry);
  }

  return [...byRate.entries()]
    .map(([rate, { baseHt, tva }]) => ({
      rate,
      baseHt: roundCentimes(baseHt),
      tva: roundCentimes(tva),
    }))
    .sort((a, b) => a.rate - b.rate);
}

export function formatMad(amount: number): string {
  return `${amount.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MAD`;
}
