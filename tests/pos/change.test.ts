import { describe, expect, it } from "vitest";
import { computeChange, quickCashAmounts, QUICK_CASH_STEPS } from "@/lib/pos/change";

describe("computeChange", () => {
  it("returns the change owed when the customer pays more than the total", () => {
    expect(computeChange(62.5, 100)).toEqual({
      isSufficient: true,
      change: 37.5,
      missing: 0,
    });
  });

  it("treats an exact payment as sufficient, with nothing to hand back", () => {
    expect(computeChange(62.5, 62.5)).toEqual({
      isSufficient: true,
      change: 0,
      missing: 0,
    });
  });

  it("reports what is still missing as a positive amount, never a negative change", () => {
    // The whole point of the field: "-37,50 to give back" is the
    // confusing display this replaces.
    const result = computeChange(100, 62.5);

    expect(result.isSufficient).toBe(false);
    expect(result.change).toBe(0);
    expect(result.missing).toBe(37.5);
  });

  it("does not drift on floating-point cents", () => {
    // 0.1 + 0.2 style errors would surface as 19.999999999999996 here.
    expect(computeChange(0.3, 20.3).change).toBe(20);
    expect(computeChange(19.99, 20).change).toBe(0.01);
  });

  it("treats nothing received on a zero total as covered", () => {
    expect(computeChange(0, 0).isSufficient).toBe(true);
  });

  it("reports the full total as missing when nothing has been handed over yet", () => {
    expect(computeChange(45, 0).missing).toBe(45);
  });
});

describe("quickCashAmounts", () => {
  it("suggests the round notes just above the total", () => {
    expect(quickCashAmounts(62.5)).toEqual([80, 100, 200]);
  });

  it("never suggests an amount at or below the total", () => {
    const total = 137.25;
    for (const amount of quickCashAmounts(total)) {
      expect(amount).toBeGreaterThan(total);
    }
  });

  it("collapses duplicates when several steps land on the same note", () => {
    // 90 rounds up to 100 for both the 50 and the 100 step; offering the
    // same button twice would be noise.
    const suggestions = quickCashAmounts(90);

    expect(new Set(suggestions).size).toBe(suggestions.length);
    expect(suggestions).toContain(100);
  });

  it("skips a step that lands exactly on the total", () => {
    // A 100 MAD total is already a multiple of the 20, 50 and 100 steps,
    // so none of them clears it — only the 200 note is worth offering.
    // A "100" button here would compute zero change, which the exact
    // payment already covers more clearly.
    expect(quickCashAmounts(100)).toEqual([200]);
  });

  it("returns nothing for an empty cart", () => {
    expect(quickCashAmounts(0)).toEqual([]);
  });

  it("keeps the suggestions sorted ascending", () => {
    const suggestions = quickCashAmounts(37);
    expect([...suggestions].sort((a, b) => a - b)).toEqual(suggestions);
  });

  it("still suggests notes above a total larger than every step", () => {
    const suggestions = quickCashAmounts(430);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(Math.max(...suggestions)).toBeGreaterThan(430);
    // Every suggestion is a multiple of one of the configured steps.
    for (const amount of suggestions) {
      expect(QUICK_CASH_STEPS.some((step) => amount % step === 0)).toBe(true);
    }
  });
});
