/**
 * Cash-drawer maths for the POS: how much to hand back, or how much is
 * still missing. Pure and data-layer-agnostic, same split as
 * lib/pos/cart.ts, so the arithmetic the cashier trusts at the counter is
 * unit-tested rather than tangled into a component.
 */

import { round2 } from "@/lib/pos/cart";

export type ChangeCalculation = {
  /** true once the cash received covers the total. */
  isSufficient: boolean;
  /** Money to hand back. 0 while the payment is short. */
  change: number;
  /**
   * How much is still owed. 0 once covered. Deliberately a positive
   * number: showing "-37,50" as change is the confusing display this
   * replaces.
   */
  missing: number;
};

export function computeChange(total: number, received: number): ChangeCalculation {
  const difference = round2(received - total);

  if (difference >= 0) {
    return { isSufficient: true, change: difference, missing: 0 };
  }
  return { isSufficient: false, change: 0, missing: round2(-difference) };
}

/** Note denominations the quick-fill buttons round up to. */
export const QUICK_CASH_STEPS = [20, 50, 100, 200] as const;

/**
 * Round-number suggestions above `total`, for the notes a customer
 * actually hands over.
 *
 * Only amounts strictly greater than the total are offered — a button
 * equal to the total would compute zero change, which the "exact" button
 * already covers more clearly. Duplicates are collapsed, so a 90 MAD
 * total doesn't offer 100 twice (round-up-to-50 and round-up-to-100 both
 * land there).
 */
export function quickCashAmounts(total: number): number[] {
  if (total <= 0) return [];

  const suggestions = new Set<number>();
  for (const step of QUICK_CASH_STEPS) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) suggestions.add(rounded);
  }

  return [...suggestions].sort((a, b) => a - b);
}
