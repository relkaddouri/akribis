import { describe, expect, it } from "vitest";
import {
  computeReturnStatus,
  formatSaleReference,
  remainingReturnable,
  saleReferenceToIdFragment,
  validateReturn,
  type ReturnableLine,
} from "@/lib/sales/returns";

function line(overrides: Partial<ReturnableLine> = {}): ReturnableLine {
  return {
    saleItemId: "si1",
    productId: "p1",
    productName: "Doliprane 500mg",
    quantity: 4,
    returnedQuantity: 0,
    unitPrice: 15.5,
    ...overrides,
  };
}

describe("computeReturnStatus", () => {
  it("is 'none' when nothing has come back", () => {
    expect(computeReturnStatus([{ quantity: 4, returnedQuantity: 0 }])).toBe("none");
  });

  it("is 'partial' when only some units have come back", () => {
    expect(computeReturnStatus([{ quantity: 4, returnedQuantity: 1 }])).toBe("partial");
  });

  it("is 'full' only when every unit sold has come back", () => {
    expect(computeReturnStatus([{ quantity: 4, returnedQuantity: 4 }])).toBe("full");
  });

  it("stays 'partial' when one line is fully returned but another isn't", () => {
    // The status describes the sale, not a single line — a sale with one
    // product fully returned and another untouched is not a full return.
    expect(
      computeReturnStatus([
        { quantity: 2, returnedQuantity: 2 },
        { quantity: 3, returnedQuantity: 0 },
      ]),
    ).toBe("partial");
  });

  it("is 'full' when every line of a multi-line sale is fully returned", () => {
    expect(
      computeReturnStatus([
        { quantity: 2, returnedQuantity: 2 },
        { quantity: 3, returnedQuantity: 3 },
      ]),
    ).toBe("full");
  });

  it("treats a sale with no lines as 'none' rather than 'full'", () => {
    expect(computeReturnStatus([])).toBe("none");
  });
});

describe("validateReturn", () => {
  it("refuses an empty request", () => {
    const result = validateReturn([line()], [{ saleItemId: "si1", quantity: 0, restock: true }]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("empty");
  });

  it("refuses a line that doesn't belong to the sale", () => {
    const result = validateReturn(
      [line()],
      [{ saleItemId: "other", quantity: 1, restock: true }],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_line");
  });

  it("refuses more than was sold", () => {
    const result = validateReturn([line({ quantity: 4 })], [
      { saleItemId: "si1", quantity: 5, restock: true },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("exceeds_remaining");
  });

  it("accounts for earlier returns when capping the quantity", () => {
    // 4 sold, 3 already back: only 1 may still be returned.
    const partiallyReturned = [line({ quantity: 4, returnedQuantity: 3 })];

    expect(
      validateReturn(partiallyReturned, [{ saleItemId: "si1", quantity: 2, restock: true }]).ok,
    ).toBe(false);
    expect(
      validateReturn(partiallyReturned, [{ saleItemId: "si1", quantity: 1, restock: true }]).ok,
    ).toBe(true);
  });

  it("computes the refund from the price actually paid", () => {
    const result = validateReturn([line({ unitPrice: 15.5 })], [
      { saleItemId: "si1", quantity: 2, restock: true },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0]!.refundAmount).toBe(31);
      expect(result.totalRefund).toBe(31);
    }
  });

  it("makes the per-line refunds add up to the total handed back", () => {
    const result = validateReturn(
      [
        line({ saleItemId: "a", unitPrice: 3.33, quantity: 3 }),
        line({ saleItemId: "b", unitPrice: 1.11, productId: "p2", quantity: 7 }),
      ],
      [
        { saleItemId: "a", quantity: 3, restock: true },
        { saleItemId: "b", quantity: 7, restock: false },
      ],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const sum = result.lines.reduce((total, l) => total + l.refundAmount, 0);
      expect(Math.round(sum * 100) / 100).toBe(result.totalRefund);
    }
  });

  it("carries the per-line restock decision through untouched", () => {
    // A recalled batch is refunded but destroyed; an ordinary return goes
    // back on the shelf. Both can appear in the same return.
    const result = validateReturn(
      [line({ saleItemId: "a" }), line({ saleItemId: "b", productId: "p2" })],
      [
        { saleItemId: "a", quantity: 1, restock: false },
        { saleItemId: "b", quantity: 1, restock: true },
      ],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines.map((l) => l.restock)).toEqual([false, true]);
    }
  });

  it("ignores zero-quantity lines instead of rejecting the whole request", () => {
    const result = validateReturn(
      [line({ saleItemId: "a" }), line({ saleItemId: "b", productId: "p2" })],
      [
        { saleItemId: "a", quantity: 0, restock: true },
        { saleItemId: "b", quantity: 2, restock: true },
      ],
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lines).toHaveLength(1);
  });
});

describe("remainingReturnable", () => {
  it("never goes negative, even on inconsistent data", () => {
    expect(remainingReturnable(line({ quantity: 2, returnedQuantity: 5 }))).toBe(0);
  });
});

describe("sale reference", () => {
  it("is derived from the sale id and stays stable", () => {
    const id = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
    expect(formatSaleReference(id)).toBe("VTE-1A2B3C4D");
    expect(formatSaleReference(id)).toBe(formatSaleReference(id));
  });

  it("accepts the pasted reference or the bare fragment when searching", () => {
    expect(saleReferenceToIdFragment("VTE-1A2B3C4D")).toBe("1a2b3c4d");
    expect(saleReferenceToIdFragment("vte1a2b3c4d")).toBe("1a2b3c4d");
    expect(saleReferenceToIdFragment("  1A2B3C4D ")).toBe("1a2b3c4d");
  });
});
