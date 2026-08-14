import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory fakes for Prisma, mirroring the pattern used for
 * createSale's tests: a faithful `$transaction` (mutates the shared
 * state directly, since `receiveOrder` doesn't need rollback coverage
 * here) plus a direct `prisma.order.findFirst` for the final
 * `getOrder()` re-fetch that isn't part of the transaction.
 */
const state = vi.hoisted(() => {
  type FakeOrder = {
    id: string;
    pharmacyId: string;
    supplierId: string;
    status: string;
    numero: number;
    createdAt: Date;
  };
  type FakeOrderItem = {
    id: string;
    pharmacyId: string;
    orderId: string;
    productId: string;
    quantity: number;
    receivedQuantity: number;
    unitPrice: number;
  };
  type FakeProduct = {
    id: string;
    pharmacyId: string;
    name: string;
    quantityInStock: number;
  };
  type FakeSupplier = { id: string; pharmacyId: string; name: string };

  return {
    orders: [] as FakeOrder[],
    orderItems: [] as FakeOrderItem[],
    products: [] as FakeProduct[],
    suppliers: [] as FakeSupplier[],
    stockMovements: [] as Array<{ productId: string; type: string; quantity: number }>,
    deliveries: [] as Array<{ id: string; orderId: string; numero: number }>,
    deliveryItems: [] as Array<{
      deliveryId: string;
      orderItemId: string;
      productId: string;
      quantiteRecue: number;
    }>,
    counters: new Map<string, number>(),
  };
});

function makeTx() {
  return {
    // Stands in for the atomic INSERT ... ON CONFLICT DO UPDATE that
    // allocates document numbers; applied synchronously, as Postgres
    // applies that single statement.
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(" ");
      if (!/INSERT INTO document_counters/i.test(sql)) {
        throw new Error(`Unexpected raw SQL: ${sql}`);
      }
      const [pharmacyId, scope] = values as [string, string];
      const key = `${pharmacyId}:${scope}`;
      const next = (state.counters.get(key) ?? 0) + 1;
      state.counters.set(key, next);
      return Promise.resolve([{ last_sequence: next }]);
    },
    delivery: {
      create: async ({
        data,
      }: {
        data: { orderId: string; numero: number };
      }) => {
        const delivery = {
          id: `dl${state.deliveries.length + 1}`,
          orderId: data.orderId,
          numero: data.numero,
        };
        state.deliveries.push(delivery);
        return { id: delivery.id };
      },
    },
    deliveryItem: {
      create: async ({
        data,
      }: {
        data: {
          deliveryId: string;
          orderItemId: string;
          productId: string;
          quantiteRecue: number;
        };
      }) => {
        state.deliveryItems.push(data);
        return data;
      },
    },
    order: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; pharmacyId: string };
      }) => {
        const order = state.orders.find(
          (o) => o.id === where.id && o.pharmacyId === where.pharmacyId,
        );
        if (!order) return null;
        // Clone each item: a real Prisma query result is a plain,
        // independent object, so mutating a row later via
        // `orderItem.update` must not retroactively change the
        // `receivedQuantity` already captured here in `order.items`.
        return {
          ...order,
          items: state.orderItems.filter((i) => i.orderId === order.id).map((i) => ({ ...i })),
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: string };
      }) => {
        const order = state.orders.find((o) => o.id === where.id);
        if (order) order.status = data.status;
        return order;
      },
    },
    orderItem: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { receivedQuantity: { increment: number } };
      }) => {
        const item = state.orderItems.find((i) => i.id === where.id);
        if (item) item.receivedQuantity += data.receivedQuantity.increment;
        return item;
      },
    },
    product: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { quantityInStock: { increment: number } };
      }) => {
        const product = state.products.find((p) => p.id === where.id);
        if (product) product.quantityInStock += data.quantityInStock.increment;
        return product;
      },
    },
    stockMovement: {
      create: async ({
        data,
      }: {
        data: { productId: string; type: string; quantity: number };
      }) => {
        state.stockMovements.push(data);
        return data;
      },
    },
  };
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> =>
      fn(makeTx()),
    order: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; pharmacyId: string };
      }) => {
        const order = state.orders.find(
          (o) => o.id === where.id && o.pharmacyId === where.pharmacyId,
        );
        if (!order) return null;
        const supplier = state.suppliers.find((s) => s.id === order.supplierId)!;
        const items = state.orderItems
          .filter((i) => i.orderId === order.id)
          .map((item) => ({
            ...item,
            product: { name: state.products.find((p) => p.id === item.productId)!.name },
          }));
        return { ...order, supplier: { name: supplier.name }, items };
      },
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

const { receiveOrder } = await import("@/lib/server/orders");

function seedOrder({
  itemsSpec,
}: {
  itemsSpec: Array<{ quantity: number; quantityInStock?: number; receivedQuantity?: number }>;
}) {
  const orderId = `order-${state.orders.length + 1}`;
  state.suppliers.push({ id: "supplier-1", pharmacyId: "pharmacy-1", name: "Pharma Distrib" });
  state.orders.push({
    id: orderId,
    pharmacyId: "pharmacy-1",
    supplierId: "supplier-1",
    status: "ENVOYEE",
    numero: state.orders.length + 1,
    createdAt: new Date(),
  });

  const itemIds = itemsSpec.map((spec, index) => {
    const productId = `${orderId}-product-${index}`;
    state.products.push({
      id: productId,
      pharmacyId: "pharmacy-1",
      name: `Produit ${index}`,
      quantityInStock: spec.quantityInStock ?? 0,
    });
    const itemId = `${orderId}-item-${index}`;
    state.orderItems.push({
      id: itemId,
      pharmacyId: "pharmacy-1",
      orderId,
      productId,
      quantity: spec.quantity,
      receivedQuantity: spec.receivedQuantity ?? 0,
      unitPrice: 10,
    });
    return itemId;
  });

  return { orderId, itemIds };
}

beforeEach(() => {
  state.orders = [];
  state.orderItems = [];
  state.products = [];
  state.suppliers = [];
  state.stockMovements = [];
  state.deliveries = [];
  state.deliveryItems = [];
  state.counters = new Map();
});

describe("receiveOrder", () => {
  it("sets status to PARTIELLEMENT_RECUE and updates stock when only part of the order arrives", async () => {
    const { orderId, itemIds } = seedOrder({ itemsSpec: [{ quantity: 10, quantityInStock: 5 }] });

    const result = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 4 }],
    });

    expect(result.status).toBe("PARTIELLEMENT_RECUE");
    expect(result.items[0].receivedQuantity).toBe(4);
    expect(state.products[0].quantityInStock).toBe(9); // 5 + 4
    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements[0]).toMatchObject({
      productId: state.products[0].id,
      type: "IN",
      quantity: 4,
    });
  });

  it("sets status to RECUE once every line is fully received", async () => {
    const { orderId, itemIds } = seedOrder({ itemsSpec: [{ quantity: 10, quantityInStock: 0 }] });

    const result = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 10 }],
    });

    expect(result.status).toBe("RECUE");
    expect(result.items[0].receivedQuantity).toBe(10);
    expect(state.products[0].quantityInStock).toBe(10);
  });

  it("moves from PARTIELLEMENT_RECUE to RECUE across two separate receptions of the same order", async () => {
    const { orderId, itemIds } = seedOrder({ itemsSpec: [{ quantity: 10, quantityInStock: 0 }] });

    const first = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 6 }],
    });
    // Six of ten in: still outstanding, so the order must not close yet.
    expect(first.status).toBe("PARTIELLEMENT_RECUE");

    const second = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 4 }],
    });

    // 6 + 4 = the 10 ordered, so the cumulative total — not this single
    // reception — is what flips the order to RECUE.
    expect(second.status).toBe("RECUE");
    expect(second.items[0].receivedQuantity).toBe(10);
    expect(state.products[0].quantityInStock).toBe(10);

    // Each reception leaves its own delivery note, with its own number:
    // two shipments must be two traceable documents, not one running total.
    expect(state.deliveries).toHaveLength(2);
    expect(state.deliveries.map((d) => d.numero)).toEqual([1, 2]);
    expect(state.deliveryItems.map((i) => i.quantiteRecue)).toEqual([6, 4]);
    expect(new Set(state.deliveryItems.map((i) => i.deliveryId)).size).toBe(2);
  });

  it("keeps the order PARTIELLEMENT_RECUE when only one of several lines is received", async () => {
    const { orderId, itemIds } = seedOrder({
      itemsSpec: [
        { quantity: 5, quantityInStock: 0 },
        { quantity: 3, quantityInStock: 0 },
      ],
    });

    const result = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 5 }],
    });

    expect(result.status).toBe("PARTIELLEMENT_RECUE");
    expect(state.products[0].quantityInStock).toBe(5);
    expect(state.products[1].quantityInStock).toBe(0); // untouched second line
  });

  it("clamps an over-reported receipt to what's still outstanding on the line", async () => {
    const { orderId, itemIds } = seedOrder({ itemsSpec: [{ quantity: 5, quantityInStock: 0 }] });

    const result = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 50 }],
    });

    expect(result.status).toBe("RECUE");
    expect(result.items[0].receivedQuantity).toBe(5);
    expect(state.products[0].quantityInStock).toBe(5);
  });
});
