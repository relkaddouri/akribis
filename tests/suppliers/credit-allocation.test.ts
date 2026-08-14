import { describe, expect, it } from "vitest";
import { allocateCredits, type UsableCredit } from "@/lib/suppliers/credit-allocation";

function credit(id: string, montantRestant: number, numero = 1): UsableCredit {
  return { id, numero, montantRestant };
}

describe("allocateCredits", () => {
  it("deducts a credit smaller than the order in full", () => {
    const result = allocateCredits(1000, [credit("a", 250)]);

    expect(result.deducted).toBe(250);
    expect(result.finalTotal).toBe(750);
    expect(result.consumed).toEqual([{ id: "a", amount: 250 }]);
  });

  it("consumes only part of a credit larger than the order, keeping the rest", () => {
    // 400 credit against a 300 order: 100 must survive for a future order
    // rather than being burned or driving the total negative.
    const result = allocateCredits(300, [credit("a", 400)]);

    expect(result.deducted).toBe(300);
    expect(result.finalTotal).toBe(0);
    expect(result.consumed).toEqual([{ id: "a", amount: 300 }]);
  });

  it("never drives the order below zero", () => {
    const result = allocateCredits(100, [credit("a", 500), credit("b", 500)]);

    expect(result.finalTotal).toBe(0);
    expect(result.deducted).toBe(100);
  });

  it("stops consuming once the order is covered", () => {
    // The second credit is untouched, so it stays usable next time.
    const result = allocateCredits(200, [credit("a", 200), credit("b", 300)]);

    expect(result.consumed).toEqual([{ id: "a", amount: 200 }]);
    expect(result.consumed.some((entry) => entry.id === "b")).toBe(false);
  });

  it("spreads across several credits when one isn't enough", () => {
    const result = allocateCredits(500, [credit("a", 200), credit("b", 200), credit("c", 200)]);

    expect(result.deducted).toBe(500);
    expect(result.consumed).toEqual([
      { id: "a", amount: 200 },
      { id: "b", amount: 200 },
      { id: "c", amount: 100 },
    ]);
  });

  it("ignores an exhausted credit instead of recording a zero consumption", () => {
    const result = allocateCredits(500, [credit("spent", 0), credit("b", 100)]);

    expect(result.consumed).toEqual([{ id: "b", amount: 100 }]);
  });

  it("deducts nothing when no credit is selected", () => {
    const result = allocateCredits(750, []);

    expect(result.deducted).toBe(0);
    expect(result.finalTotal).toBe(750);
  });

  it("handles an empty order without consuming anything", () => {
    const result = allocateCredits(0, [credit("a", 500)]);

    expect(result.deducted).toBe(0);
    expect(result.consumed).toEqual([]);
  });

  it("stays exact to the centime", () => {
    const result = allocateCredits(100.05, [credit("a", 33.35), credit("b", 66.7)]);

    expect(result.deducted).toBe(100.05);
    expect(result.finalTotal).toBe(0);
  });

  it("makes the per-credit amounts add up to the deduction", () => {
    const result = allocateCredits(1234.56, [credit("a", 500.11), credit("b", 800.45)]);

    const sum = result.consumed.reduce((total, entry) => total + entry.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(result.deducted);
    expect(Math.round((result.deducted + result.finalTotal) * 100) / 100).toBe(1234.56);
  });
});
