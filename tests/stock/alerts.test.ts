import { describe, expect, it } from "vitest";
import {
  daysUntil,
  getExpiryAlerts,
  getLowStockAlerts,
  isLowStock,
  type ProductForAlerts,
} from "@/lib/stock/alerts";

function product(overrides: Partial<ProductForAlerts> = {}): ProductForAlerts {
  return {
    id: "p1",
    name: "Doliprane 500mg",
    quantityInStock: 10,
    lowStockThreshold: 5,
    nearestExpiryDate: null,
    ...overrides,
  };
}

describe("isLowStock", () => {
  it("is false when stock is comfortably above the threshold", () => {
    expect(isLowStock({ quantityInStock: 10, lowStockThreshold: 5 })).toBe(false);
  });

  it("is true when stock is below the threshold", () => {
    expect(isLowStock({ quantityInStock: 3, lowStockThreshold: 5 })).toBe(true);
  });

  it("is true when stock exactly equals the threshold (boundary)", () => {
    expect(isLowStock({ quantityInStock: 5, lowStockThreshold: 5 })).toBe(true);
  });

  it("is true at zero stock even with a zero threshold", () => {
    expect(isLowStock({ quantityInStock: 0, lowStockThreshold: 0 })).toBe(true);
  });
});

describe("getLowStockAlerts", () => {
  it("only returns products at or below their threshold", () => {
    const products = [
      product({ id: "ok", quantityInStock: 20, lowStockThreshold: 5 }),
      product({ id: "low", quantityInStock: 2, lowStockThreshold: 5 }),
    ];

    const alerts = getLowStockAlerts(products);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].productId).toBe("low");
  });

  it("sorts the most depleted stock first", () => {
    const products = [
      product({ id: "a", quantityInStock: 4, lowStockThreshold: 5 }),
      product({ id: "b", quantityInStock: 0, lowStockThreshold: 5 }),
      product({ id: "c", quantityInStock: 5, lowStockThreshold: 5 }),
    ];

    const alerts = getLowStockAlerts(products);

    expect(alerts.map((a) => a.productId)).toEqual(["b", "a", "c"]);
  });

  it("returns an empty list when nothing is low", () => {
    expect(getLowStockAlerts([product({ quantityInStock: 100, lowStockThreshold: 5 })])).toEqual(
      [],
    );
  });
});

describe("daysUntil", () => {
  const from = new Date("2026-08-01T15:00:00Z");

  it("counts whole days regardless of time of day", () => {
    expect(daysUntil(new Date("2026-08-31T00:00:00Z"), from)).toBe(30);
    expect(daysUntil(new Date("2026-09-30T23:59:00Z"), from)).toBe(60);
    expect(daysUntil(new Date("2026-10-30T08:00:00Z"), from)).toBe(90);
  });

  it("is zero for the current day", () => {
    expect(daysUntil(new Date("2026-08-01T02:00:00Z"), from)).toBe(0);
  });

  it("is negative for a past date", () => {
    expect(daysUntil(new Date("2026-07-01T00:00:00Z"), from)).toBe(-31);
  });
});

describe("getExpiryAlerts", () => {
  const from = new Date("2026-08-01T00:00:00Z");

  it("ignores products with no expiry date", () => {
    expect(getExpiryAlerts([product({ nearestExpiryDate: null })], 30, from)).toEqual([]);
  });

  it("excludes products expiring further out than the threshold", () => {
    const products = [product({ id: "far", nearestExpiryDate: "2027-01-01" })];
    expect(getExpiryAlerts(products, 30, from)).toEqual([]);
  });

  it("includes products expiring within the threshold", () => {
    const products = [product({ id: "soon", nearestExpiryDate: "2026-08-20" })];
    const alerts = getExpiryAlerts(products, 30, from);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].productId).toBe("soon");
    expect(alerts[0].daysUntilExpiry).toBe(19);
  });

  it("includes already-expired products with a negative day count", () => {
    const products = [product({ id: "expired", nearestExpiryDate: "2026-07-01" })];
    const alerts = getExpiryAlerts(products, 30, from);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].daysUntilExpiry).toBe(-31);
  });

  it("respects the 30/60/90-day configurable thresholds", () => {
    const products = [
      product({ id: "d10", nearestExpiryDate: "2026-08-11" }),
      product({ id: "d45", nearestExpiryDate: "2026-09-15" }),
      product({ id: "d75", nearestExpiryDate: "2026-10-15" }),
    ];

    expect(getExpiryAlerts(products, 30, from).map((a) => a.productId)).toEqual(["d10"]);
    expect(getExpiryAlerts(products, 60, from).map((a) => a.productId)).toEqual(["d10", "d45"]);
    expect(getExpiryAlerts(products, 90, from).map((a) => a.productId)).toEqual([
      "d10",
      "d45",
      "d75",
    ]);
  });

  it("sorts the most urgent (soonest or most overdue) first", () => {
    const products = [
      product({ id: "later", nearestExpiryDate: "2026-08-25" }),
      product({ id: "expired", nearestExpiryDate: "2026-07-15" }),
      product({ id: "soon", nearestExpiryDate: "2026-08-05" }),
    ];

    const alerts = getExpiryAlerts(products, 90, from);

    expect(alerts.map((a) => a.productId)).toEqual(["expired", "soon", "later"]);
  });

  it("accepts Date objects as well as ISO strings", () => {
    const products = [product({ id: "date-obj", nearestExpiryDate: new Date("2026-08-10") })];
    expect(getExpiryAlerts(products, 30, from)).toHaveLength(1);
  });
});
