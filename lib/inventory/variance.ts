/**
 * Pure variance arithmetic for stock counts. Framework- and data-layer
 * agnostic, same split as lib/stock/alerts.ts, so the numbers a pharmacist
 * acts on are testable without a database or a browser.
 */

import { round2 } from "@/lib/pos/cart";

export type CountLine = {
  productId: string;
  productName: string;
  /** Stock as recorded when the product entered the session. */
  quantiteTheorique: number;
  /** Null until someone counts the shelf — not the same thing as zero. */
  quantiteComptee: number | null;
  /** Unit value, captured with the line, used to price the variance. */
  unitPrice: number;
};

export type VarianceLine = CountLine & {
  quantiteComptee: number;
  /** Counted minus expected: negative is missing stock, positive is surplus. */
  ecart: number;
  /** What the gap is worth, signed the same way. */
  valeurEcart: number;
};

export type VarianceReport = {
  lines: VarianceLine[];
  /** Products counted so far, and how many the session holds in total. */
  countedCount: number;
  totalCount: number;
  /** Signed sum of the variance values — the net effect on stock value. */
  totalValeur: number;
  /** Units missing and units in surplus, kept apart: they don't cancel out
   *  as an operational signal even though their values do. */
  totalManquant: number;
  totalSurplus: number;
};

/** A line counted exactly as expected is not a variance. */
export function hasVariance(line: CountLine): line is CountLine & { quantiteComptee: number } {
  return line.quantiteComptee !== null && line.quantiteComptee !== line.quantiteTheorique;
}

export function countProgress(lines: CountLine[]): { counted: number; total: number } {
  return {
    counted: lines.filter((line) => line.quantiteComptee !== null).length,
    total: lines.length,
  };
}

/**
 * The report a pharmacist signs off on.
 *
 * Uncounted lines are left out entirely rather than treated as zero: a
 * shelf nobody reached is not a shelf found empty, and reporting it as a
 * total loss would be an invented figure.
 */
export function buildVarianceReport(lines: CountLine[]): VarianceReport {
  const varianceLines: VarianceLine[] = lines.filter(hasVariance).map((line) => {
    const ecart = line.quantiteComptee - line.quantiteTheorique;
    return { ...line, ecart, valeurEcart: round2(ecart * line.unitPrice) };
  });

  const progress = countProgress(lines);

  return {
    // Biggest money impact first — that is the order someone investigates in.
    lines: varianceLines.sort((a, b) => Math.abs(b.valeurEcart) - Math.abs(a.valeurEcart)),
    countedCount: progress.counted,
    totalCount: progress.total,
    totalValeur: round2(varianceLines.reduce((sum, line) => sum + line.valeurEcart, 0)),
    totalManquant: varianceLines
      .filter((line) => line.ecart < 0)
      .reduce((sum, line) => sum + Math.abs(line.ecart), 0),
    totalSurplus: varianceLines
      .filter((line) => line.ecart > 0)
      .reduce((sum, line) => sum + line.ecart, 0),
  };
}

/**
 * What each adjusted product's stock becomes: the counted figure itself,
 * never the expected figure shifted by the gap.
 *
 * The distinction matters at sync time. If stock moved between the count
 * and the sync — a sale went through, a delivery landed — applying the
 * delta would carry that movement into the correction and land on a number
 * nobody counted. The shelf was counted; that count is the truth.
 */
export function adjustmentsFrom(report: VarianceReport): Array<{
  productId: string;
  quantiteComptee: number;
  ecart: number;
}> {
  return report.lines.map((line) => ({
    productId: line.productId,
    quantiteComptee: line.quantiteComptee,
    ecart: line.ecart,
  }));
}
