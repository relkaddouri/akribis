"use server";

/**
 * Period-over-period revenue and gross margin for the dashboard.
 *
 * Kept separate from lib/server/dashboard.ts because the two answer
 * different questions: that module reports *point-in-time* stock state
 * (what's on the shelves right now), this one reports *flow* over a
 * window (what was sold), which is the only kind of figure a
 * "vs période précédente" comparison can honestly be made from.
 */

import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import {
  computeVariation,
  getPeriodRanges,
  type DateRange,
  type Period,
  type Variation,
} from "@/lib/dashboard/periods";

export type PeriodMetric = {
  current: number;
  previous: number;
  variation: Variation;
};

export type PeriodStats = {
  period: Period;
  revenue: PeriodMetric;
  margin: PeriodMetric;
  salesCount: PeriodMetric;
  /**
   * Margin can only be computed for sale lines whose product has a
   * `purchasePrice`. Surfacing the ratio lets the UI warn instead of
   * quietly under-reporting margin as if the gap didn't exist.
   */
  marginCoverage: { linesWithCost: number; totalLines: number };
};

type Totals = { revenue: number; margin: number; salesCount: number; linesWithCost: number; totalLines: number };

async function totalsFor(pharmacyId: string, range: DateRange): Promise<Totals> {
  const where = {
    pharmacyId,
    // Half-open window: `gte` from, `lt` to — see getPeriodRanges.
    createdAt: { gte: range.from, lt: range.to },
  };

  const [aggregate, lines] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.saleItem.findMany({
      where: { pharmacyId, sale: { createdAt: { gte: range.from, lt: range.to } } },
      select: {
        quantity: true,
        unitPrice: true,
        product: { select: { purchasePrice: true } },
      },
    }),
  ]);

  let margin = 0;
  let linesWithCost = 0;
  for (const line of lines) {
    const purchasePrice = line.product.purchasePrice;
    if (purchasePrice === null) continue;
    linesWithCost += 1;
    margin += (Number(line.unitPrice) - Number(purchasePrice)) * line.quantity;
  }

  return {
    revenue: Number(aggregate._sum.totalAmount ?? 0),
    margin: Math.round(margin * 100) / 100,
    salesCount: aggregate._count._all,
    linesWithCost,
    totalLines: lines.length,
  };
}

/**
 * NOTE ON MARGIN ACCURACY: `purchasePrice` is the product's *current*
 * cost, not the cost at the time of sale — the schema doesn't snapshot it
 * on SaleItem the way it does `unitPrice`. Margin for past periods
 * therefore shifts if a product's cost is edited. Pinning this down would
 * mean adding a `purchasePrice` column to SaleItem, which is a schema
 * change well beyond "add the new data" — flagged rather than silently
 * presented as exact.
 */
export async function getPeriodStats(period: Period): Promise<PeriodStats> {
  const user = await requireUser();
  const { current, previous } = getPeriodRanges(period);

  const [currentTotals, previousTotals] = await Promise.all([
    totalsFor(user.pharmacyId, current),
    totalsFor(user.pharmacyId, previous),
  ]);

  return {
    period,
    revenue: {
      current: currentTotals.revenue,
      previous: previousTotals.revenue,
      variation: computeVariation(currentTotals.revenue, previousTotals.revenue),
    },
    margin: {
      current: currentTotals.margin,
      previous: previousTotals.margin,
      variation: computeVariation(currentTotals.margin, previousTotals.margin),
    },
    salesCount: {
      current: currentTotals.salesCount,
      previous: previousTotals.salesCount,
      variation: computeVariation(currentTotals.salesCount, previousTotals.salesCount),
    },
    marginCoverage: {
      linesWithCost: currentTotals.linesWithCost,
      totalLines: currentTotals.totalLines,
    },
  };
}
