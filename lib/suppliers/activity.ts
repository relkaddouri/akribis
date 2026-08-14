/**
 * Pure summary arithmetic for a supplier's activity — the three headline
 * figures on the supplier detail sheet. Framework- and data-layer-agnostic,
 * same split as lib/stock/alerts.ts, so the counting rules are testable
 * without a database.
 */

import { round2 } from "@/lib/pos/cart";

/**
 * Orders still expecting something from the supplier.
 *
 * Received and closed orders are done business; a draft has not been sent
 * yet but is still an open intention, so it counts as in progress rather
 * than disappearing from the figure entirely.
 */
export const IN_PROGRESS_ORDER_STATUSES = [
  "BROUILLON",
  "ENVOYEE",
  "PARTIELLEMENT_RECUE",
] as const;

export type SupplierActivityOrder = {
  createdAt: Date;
  status: string;
  totalAmount: number;
};

export type SupplierActivityCredit = {
  statut: "emis" | "recu";
};

export type SupplierActivitySummary = {
  /** Ordered value over the trailing 12 months, not the calendar year. */
  orderedLast12Months: number;
  ordersInProgress: number;
  /** Claims the supplier has not answered yet. */
  creditsAwaitingConfirmation: number;
};

export function isOrderInProgress(status: string): boolean {
  return (IN_PROGRESS_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * The window is a rolling 12 months back from `now`, so the figure means
 * the same thing whichever day it is read — a calendar-year total would
 * collapse to almost nothing every January.
 */
export function summariseSupplierActivity(
  orders: SupplierActivityOrder[],
  credits: SupplierActivityCredit[],
  now: Date = new Date(),
): SupplierActivitySummary {
  const since = new Date(now);
  since.setFullYear(since.getFullYear() - 1);

  const orderedLast12Months = round2(
    orders
      .filter((order) => order.createdAt >= since && order.createdAt <= now)
      .reduce((sum, order) => sum + order.totalAmount, 0),
  );

  return {
    orderedLast12Months,
    ordersInProgress: orders.filter((order) => isOrderInProgress(order.status)).length,
    creditsAwaitingConfirmation: credits.filter((credit) => credit.statut === "emis").length,
  };
}
