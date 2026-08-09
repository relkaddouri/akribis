import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory fake for the Prisma client, including a faithful
 * `$transaction`: it snapshots state before running the callback and
 * restores it if the callback throws, so these tests can prove
 * `createSale` really rolls back on an oversell instead of just
 * rejecting the request while leaving partial writes behind.
 */
const state = vi.hoisted(() => {
  type FakeProduct = {
    id: string;
    pharmacyId: string;
    name: string;
    price: number;
    quantityInStock: number;
  };
  type FakeSale = {
    id: string;
    pharmacyId: string;
    userId: string;
    paymentMethod: string;
    totalAmount: number;
    createdAt: Date;
  };
  type FakeSaleItem = {
    pharmacyId: string;
    saleId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
  };
  type FakeStockMovement = {
    pharmacyId: string;
    productId: string;
    type: string;
    quantity: number;
    reason: string;
  };

  return {
    products: [] as FakeProduct[],
    sales: [] as FakeSale[],
    saleItems: [] as FakeSaleItem[],
    stockMovements: [] as FakeStockMovement[],
    nextSaleId: 1,
  };
});

function makeTx() {
  return {
    product: {
      findMany: async ({
        where,
      }: {
        where: { id: { in: string[] }; pharmacyId: string };
      }) =>
        state.products.filter(
          (p) => where.id.in.includes(p.id) && p.pharmacyId === where.pharmacyId,
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; pharmacyId: string; quantityInStock: { gte: number } };
        data: { quantityInStock: { decrement: number } };
      }) => {
        const matches = state.products.filter(
          (p) =>
            p.id === where.id &&
            p.pharmacyId === where.pharmacyId &&
            p.quantityInStock >= where.quantityInStock.gte,
        );
        for (const product of matches) {
          product.quantityInStock -= data.quantityInStock.decrement;
        }
        return { count: matches.length };
      },
    },
    sale: {
      create: async ({
        data,
      }: {
        data: { pharmacyId: string; userId: string; paymentMethod: string; totalAmount: number };
      }) => {
        const sale = { id: `sale-${state.nextSaleId++}`, createdAt: new Date(), ...data };
        state.sales.push(sale);
        return sale;
      },
    },
    saleItem: {
      create: async ({ data }: { data: (typeof state.saleItems)[number] }) => {
        state.saleItems.push(data);
        return data;
      },
    },
    stockMovement: {
      create: async ({ data }: { data: (typeof state.stockMovements)[number] }) => {
        state.stockMovements.push(data);
        return data;
      },
    },
  };
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => {
      const snapshot = {
        products: state.products.map((p) => ({ ...p })),
        sales: [...state.sales],
        saleItems: [...state.saleItems],
        stockMovements: [...state.stockMovements],
      };
      try {
        return await fn(makeTx());
      } catch (err) {
        state.products = snapshot.products;
        state.sales = snapshot.sales;
        state.saleItems = snapshot.saleItems;
        state.stockMovements = snapshot.stockMovements;
        throw err;
      }
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    pharmacyId: "pharmacy-1",
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const { createSale } = await import("@/lib/server/sales");

function seedProduct(overrides: Partial<{ id: string; name: string; price: number; quantityInStock: number; pharmacyId: string }> = {}) {
  const product = {
    id: overrides.id ?? "product-1",
    pharmacyId: overrides.pharmacyId ?? "pharmacy-1",
    name: overrides.name ?? "Doliprane 500mg",
    price: overrides.price ?? 12.5,
    quantityInStock: overrides.quantityInStock ?? 10,
  };
  state.products.push(product);
  return product;
}

beforeEach(() => {
  state.products = [];
  state.sales = [];
  state.saleItems = [];
  state.stockMovements = [];
  state.nextSaleId = 1;
});

describe("createSale", () => {
  it("decrements stock by the sold quantity", async () => {
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 3 }] });

    expect(state.products.find((p) => p.id === "p1")?.quantityInStock).toBe(7);
  });

  it("records a matching sale, sale item and stock movement", async () => {
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    const receipt = await createSale({
      paymentMethod: "CARD",
      items: [{ productId: "p1", quantity: 2 }],
    });

    expect(receipt.totalAmount).toBe(25);
    expect(receipt.paymentMethod).toBe("CARD");
    expect(state.sales).toHaveLength(1);
    expect(state.sales[0]).toMatchObject({ id: receipt.id, paymentMethod: "CARD", totalAmount: 25 });

    expect(state.saleItems).toHaveLength(1);
    expect(state.saleItems[0]).toMatchObject({
      saleId: receipt.id,
      productId: "p1",
      quantity: 2,
      unitPrice: 12.5,
    });

    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements[0]).toMatchObject({ productId: "p1", type: "OUT", quantity: 2 });
  });

  it("rejects a sale that exceeds available stock", async () => {
    seedProduct({ id: "p1", quantityInStock: 2, price: 12.5 });

    await expect(
      createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 5 }] }),
    ).rejects.toThrow(/stock insuffisant/i);

    // Nothing was written: not the stock, not the sale.
    expect(state.products.find((p) => p.id === "p1")?.quantityInStock).toBe(2);
    expect(state.sales).toHaveLength(0);
    expect(state.saleItems).toHaveLength(0);
  });

  it("rolls back the whole cart when only one line oversells (atomicity)", async () => {
    seedProduct({ id: "ok", quantityInStock: 10, price: 5 });
    seedProduct({ id: "short", quantityInStock: 1, price: 5 });

    await expect(
      createSale({
        paymentMethod: "CASH",
        items: [
          { productId: "ok", quantity: 3 },
          { productId: "short", quantity: 5 },
        ],
      }),
    ).rejects.toThrow(/stock insuffisant/i);

    // The first line's stock decrement must be undone too, not just the
    // failing one — otherwise a multi-item sale could partially apply.
    expect(state.products.find((p) => p.id === "ok")?.quantityInStock).toBe(10);
    expect(state.products.find((p) => p.id === "short")?.quantityInStock).toBe(1);
    expect(state.sales).toHaveLength(0);
  });

  it("scopes the sale to the caller's pharmacy and rejects a product from another pharmacy", async () => {
    seedProduct({ id: "other-pharmacy-product", pharmacyId: "pharmacy-2", quantityInStock: 10 });

    await expect(
      createSale({
        paymentMethod: "CASH",
        items: [{ productId: "other-pharmacy-product", quantity: 1 }],
      }),
    ).rejects.toThrow(/introuvable/i);

    expect(state.sales).toHaveLength(0);
  });
});
