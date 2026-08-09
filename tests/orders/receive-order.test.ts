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
  };
});

function makeTx() {
  return {
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
    status: "PENDING",
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
});

describe("receiveOrder", () => {
  it("sets status to PARTIALLY_RECEIVED and updates stock when only part of the order arrives", async () => {
    const { orderId, itemIds } = seedOrder({ itemsSpec: [{ quantity: 10, quantityInStock: 5 }] });

    const result = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 4 }],
    });

    expect(result.status).toBe("PARTIALLY_RECEIVED");
    expect(result.items[0].receivedQuantity).toBe(4);
    expect(state.products[0].quantityInStock).toBe(9); // 5 + 4
    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements[0]).toMatchObject({
      productId: state.products[0].id,
      type: "IN",
      quantity: 4,
    });
  });

  it("sets status to RECEIVED once every line is fully received", async () => {
    const { orderId, itemIds } = seedOrder({ itemsSpec: [{ quantity: 10, quantityInStock: 0 }] });

    const result = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 10 }],
    });

    expect(result.status).toBe("RECEIVED");
    expect(result.items[0].receivedQuantity).toBe(10);
    expect(state.products[0].quantityInStock).toBe(10);
  });

  it("moves from PARTIALLY_RECEIVED to RECEIVED across two separate receptions of the same order", async () => {
    const { orderId, itemIds } = seedOrder({ itemsSpec: [{ quantity: 10, quantityInStock: 0 }] });

    const first = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 6 }],
    });
    expect(first.status).toBe("PARTIALLY_RECEIVED");

    const second = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 4 }],
    });

    expect(second.status).toBe("RECEIVED");
    expect(second.items[0].receivedQuantity).toBe(10);
    expect(state.products[0].quantityInStock).toBe(10);
  });

  it("keeps the order PARTIALLY_RECEIVED when only one of several lines is received", async () => {
    const { orderId, itemIds } = seedOrder({
      itemsSpec: [
        { quantity: 5, quantityInStock: 0 },
        { quantity: 3, quantityInStock: 0 },
      ],
    });

    const result = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 5 }],
    });

    expect(result.status).toBe("PARTIALLY_RECEIVED");
    expect(state.products[0].quantityInStock).toBe(5);
    expect(state.products[1].quantityInStock).toBe(0); // untouched second line
  });

  it("clamps an over-reported receipt to what's still outstanding on the line", async () => {
    const { orderId, itemIds } = seedOrder({ itemsSpec: [{ quantity: 5, quantityInStock: 0 }] });

    const result = await receiveOrder(orderId, {
      lines: [{ orderItemId: itemIds[0], receivedQuantity: 50 }],
    });

    expect(result.status).toBe("RECEIVED");
    expect(result.items[0].receivedQuantity).toBe(5);
    expect(state.products[0].quantityInStock).toBe(5);
  });
});
