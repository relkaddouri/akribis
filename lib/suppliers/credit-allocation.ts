/**
 * Applying supplier credits to an order total. Pure and data-layer
 * agnostic, same split as lib/stock/alerts.ts, so the arithmetic that
 * decides how much money is deducted — and how much credit survives for
 * next time — is testable without a database.
 */

import { round2 } from "@/lib/pos/cart";

export type UsableCredit = {
  id: string;
  numero: number;
  /** Still available; a credit partially spent on an earlier order carries less. */
  montantRestant: number;
};

export type CreditAllocation = {
  /** Per credit: how much of it this order consumes. */
  consumed: Array<{ id: string; amount: number }>;
  /** Total taken off the order. */
  deducted: number;
  /** What remains to pay after the deduction; never negative. */
  finalTotal: number;
};

/**
 * Spreads the selected credits across the order total, in the order given.
 *
 * Deduction stops at the order total: a credit worth more than the order is
 * consumed only up to that amount and keeps the rest for a future order —
 * an order can't go below zero, and the surplus must not simply vanish.
 */
export function allocateCredits(orderTotal: number, credits: UsableCredit[]): CreditAllocation {
  let remainingToCover = Math.max(0, round2(orderTotal));
  const consumed: Array<{ id: string; amount: number }> = [];

  for (const credit of credits) {
    if (remainingToCover <= 0) break;
    const available = Math.max(0, round2(credit.montantRestant));
    if (available <= 0) continue;

    const amount = round2(Math.min(available, remainingToCover));
    consumed.push({ id: credit.id, amount });
    remainingToCover = round2(remainingToCover - amount);
  }

  const deducted = round2(consumed.reduce((sum, entry) => sum + entry.amount, 0));
  return { consumed, deducted, finalTotal: round2(Math.max(0, orderTotal - deducted)) };
}
