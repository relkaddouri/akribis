import { describe, expect, it } from "vitest";
import {
  addToCart,
  computeCartTotal,
  getCartItemCount,
  getLineTotal,
  removeFromCart,
  round2,
  setCartLineQuantity,
  type CartLine,
  type CartProduct,
} from "@/lib/pos/cart";

function product(overrides: Partial<CartProduct> = {}): CartProduct {
  return {
    id: "p1",
    name: "Doliprane 500mg",
    price: 12.5,
    quantityInStock: 10,
    ...overrides,
  };
}

describe("round2", () => {
  it("avoids floating point drift", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(19.999999999999996)).toBe(20);
  });
});

describe("getLineTotal / computeCartTotal", () => {
  it("multiplies unit price by quantity", () => {
    expect(getLineTotal({ unitPrice: 12.5, quantity: 3 })).toBe(37.5);
  });

  it("sums line totals across the cart", () => {
    const lines: CartLine[] = [
      { productId: "a", productName: "A", unitPrice: 10, quantity: 2, availableStock: 10 },
      { productId: "b", productName: "B", unitPrice: 5.5, quantity: 3, availableStock: 10 },
    ];
    expect(computeCartTotal(lines)).toBe(36.5);
  });

  it("returns 0 for an empty cart", () => {
    expect(computeCartTotal([])).toBe(0);
  });
});

describe("getCartItemCount", () => {
  it("counts total units, not distinct lines", () => {
    const lines: CartLine[] = [
      { productId: "a", productName: "A", unitPrice: 10, quantity: 2, availableStock: 10 },
      { productId: "b", productName: "B", unitPrice: 5, quantity: 5, availableStock: 10 },
    ];
    expect(getCartItemCount(lines)).toBe(7);
  });
});

describe("addToCart", () => {
  it("adds a new line for a product not yet in the cart", () => {
    const { lines, capped } = addToCart([], product());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productId: "p1", quantity: 1 });
    expect(capped).toBe(false);
  });

  it("increments the existing line instead of duplicating it (repeated barcode scans)", () => {
    const first = addToCart([], product());
    const second = addToCart(first.lines, product(), 1);
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0].quantity).toBe(2);
  });

  it("caps the quantity at the available stock and reports it", () => {
    const { lines, capped } = addToCart([], product({ quantityInStock: 2 }), 5);
    expect(lines[0].quantity).toBe(2);
    expect(capped).toBe(true);
  });

  it("caps cumulative quantity across repeated scans at the available stock", () => {
    const p = product({ quantityInStock: 3 });
    const first = addToCart([], p, 2);
    const second = addToCart(first.lines, p, 2);
    expect(second.lines[0].quantity).toBe(3);
    expect(second.capped).toBe(true);
  });

  it("refuses to add an out-of-stock product", () => {
    const { lines, capped } = addToCart([], product({ quantityInStock: 0 }));
    expect(lines).toHaveLength(0);
    expect(capped).toBe(true);
  });
});

describe("removeFromCart", () => {
  it("removes only the targeted line", () => {
    const lines: CartLine[] = [
      { productId: "a", productName: "A", unitPrice: 10, quantity: 1, availableStock: 10 },
      { productId: "b", productName: "B", unitPrice: 5, quantity: 1, availableStock: 10 },
    ];
    expect(removeFromCart(lines, "a").map((l) => l.productId)).toEqual(["b"]);
  });
});

describe("setCartLineQuantity", () => {
  it("clamps to the line's available stock", () => {
    const lines: CartLine[] = [
      { productId: "a", productName: "A", unitPrice: 10, quantity: 1, availableStock: 4 },
    ];
    expect(setCartLineQuantity(lines, "a", 10)[0].quantity).toBe(4);
  });

  it("never goes below 1", () => {
    const lines: CartLine[] = [
      { productId: "a", productName: "A", unitPrice: 10, quantity: 1, availableStock: 4 },
    ];
    expect(setCartLineQuantity(lines, "a", 0)[0].quantity).toBe(1);
    expect(setCartLineQuantity(lines, "a", -5)[0].quantity).toBe(1);
  });
});
