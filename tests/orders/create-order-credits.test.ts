import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory Prisma fake for order creation, same approach as
 * tests/orders/receive-order.test.ts.
 *
 * What this suite protects is money: a supplier credit applied to an order
 * must be marked spent in the same transaction that saves the order. The
 * fake therefore implements `updateMany` as a real conditional UPDATE —
 * no row matches when the remaining balance is short — so a double spend
 * shows up as a failure instead of being quietly absorbed.
 */
const state = vi.hoisted(() => ({
  suppliers: [
    { id: "supplier-1", pharmacyId: "pharmacy-1" },
    { id: "supplier-2", pharmacyId: "pharmacy-1" },
  ],
  products: [
    { id: "p1", pharmacyId: "pharmacy-1" },
    { id: "p2", pharmacyId: "pharmacy-1" },
  ],
  credits: [] as Array<{
    id: string;
    pharmacyId: string;
    supplierId: string;
    numero: number;
    statut: string;
    modeCompensation: string;
    montantRestant: number;
    dateEmission: Date;
  }>,
  orders: [] as Array<{ id: string; numero: number; supplierId: string }>,
  counters: new Map<string, number>(),
  /** Fires after the credits are read, to simulate a concurrent writer. */
  afterCreditRead: null as null | (() => void),
}));

class FakeDecimal {
  constructor(public value: number | string) {}
  valueOf() {
    return Number(this.value);
  }
  toString() {
    return String(this.value);
  }
}

function makeTx() {
  return {
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
    supplierCredit: {
      findMany: async ({
        where,
      }: {
        where: {
          id: { in: string[] };
          pharmacyId: string;
          supplierId: string;
          statut: string;
          modeCompensation: string;
          montantRestant: { gt: number };
        };
      }) => {
        const rows = state.credits
          .filter(
            (credit) =>
              where.id.in.includes(credit.id) &&
              credit.pharmacyId === where.pharmacyId &&
              credit.supplierId === where.supplierId &&
              credit.statut === where.statut &&
              credit.modeCompensation === where.modeCompensation &&
              credit.montantRestant > where.montantRestant.gt,
          )
          .sort((a, b) => a.dateEmission.getTime() - b.dateEmission.getTime())
          // Copies, like a real query result: the caller works from the
          // values it read, not from live rows another writer may change.
          .map((credit) => ({ ...credit }));
        state.afterCreditRead?.();
        return rows;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; pharmacyId: string; montantRestant: { gte: FakeDecimal } };
        data: { montantRestant: { decrement: FakeDecimal } };
      }) => {
        const credit = state.credits.find(
          (c) => c.id === where.id && c.pharmacyId === where.pharmacyId,
        );
        // Mirrors the conditional UPDATE: no row matches when the credit
        // no longer holds the amount this order wants to take.
        if (!credit) return { count: 0 };
        if (credit.montantRestant < Number(where.montantRestant.gte.valueOf())) {
          return { count: 0 };
        }
        credit.montantRestant -= Number(data.montantRestant.decrement.valueOf());
        return { count: 1 };
      },
    },
    order: {
      create: async ({ data }: { data: { numero: number; supplierId: string } }) => {
        const order = {
          id: `order-${state.orders.length + 1}`,
          numero: data.numero,
          supplierId: data.supplierId,
        };
        state.orders.push(order);
        return order;
      },
    },
  };
}

vi.mock("@/lib/db/generated/client", () => ({ Prisma: { Decimal: FakeDecimal } }));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    supplier: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) =>
        state.suppliers.find((s) => s.id === where.id && s.pharmacyId === where.pharmacyId) ?? null,
    },
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] }; pharmacyId: string } }) =>
        state.products.filter(
          (p) => where.id.in.includes(p.id) && p.pharmacyId === where.pharmacyId,
        ),
    },
    $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> =>
      fn(makeTx()),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "user-1",
    email: "owner@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "pharmacy-1",
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createOrder } = await import("@/lib/server/orders");

function credit(overrides: Partial<(typeof state.credits)[number]> = {}) {
  return {
    id: "credit-1",
    pharmacyId: "pharmacy-1",
    supplierId: "supplier-1",
    numero: 1,
    statut: "RECU",
    modeCompensation: "AVOIR_CREDIT",
    montantRestant: 300,
    dateEmission: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  };
}

const items = [{ productId: "p1", quantity: "2", unitPrice: "100" }];

beforeEach(() => {
  state.credits = [];
  state.orders = [];
  state.counters = new Map();
  state.afterCreditRead = null;
});

describe("applying supplier credits to a new order", () => {
  it("leaves credits untouched when none are selected", async () => {
    state.credits = [credit()];

    await createOrder({ supplierId: "supplier-1", items });

    // Not selecting a credit is a real choice — keeping it for a bigger
    // order later — so nothing may be spent behind the pharmacist's back.
    expect(state.credits[0]!.montantRestant).toBe(300);
  });

  it("spends only what the order costs, keeping the surplus", async () => {
    state.credits = [credit({ montantRestant: 300 })];

    // Order is 2 × 100 = 200 against a 300 credit.
    await createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] });

    expect(state.credits[0]!.montantRestant).toBe(100);
  });

  it("cannot spend the same credit twice", async () => {
    state.credits = [credit({ montantRestant: 200 })];

    await createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] });
    expect(state.credits[0]!.montantRestant).toBe(0);

    // Fully consumed: the second order must not find it usable at all.
    await expect(
      createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] }),
    ).rejects.toThrow(/ne sont plus disponibles/);
    expect(state.credits[0]!.montantRestant).toBe(0);
  });

  it("aborts when the credit is drained between the read and the write", async () => {
    state.credits = [credit({ montantRestant: 250 })];

    // The exact race a second till would cause: this order reads 250 and
    // decides to take 200, but another order empties the credit before the
    // UPDATE lands. The conditional `gte` must catch it — an order that
    // saved anyway would have deducted money that no longer existed.
    state.afterCreditRead = () => {
      state.afterCreditRead = null;
      state.credits[0]!.montantRestant = 10;
    };

    await expect(
      createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] }),
    ).rejects.toThrow(/utilisé entre-temps/);
    expect(state.credits[0]!.montantRestant).toBe(10);
  });

  it("never deducts more than a credit holds across successive orders", async () => {
    state.credits = [credit({ montantRestant: 250 })];

    // Two 200 MAD orders against a 250 MAD credit: the first takes 200,
    // the second can only take the 50 left. The balance may never go below
    // zero, however many orders are placed.
    await createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] });
    await createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] });

    expect(state.credits[0]!.montantRestant).toBe(0);
  });

  it("spreads several credits across one order, oldest first", async () => {
    state.credits = [
      credit({ id: "credit-1", numero: 1, montantRestant: 120 }),
      credit({
        id: "credit-2",
        numero: 2,
        montantRestant: 500,
        dateEmission: new Date("2026-08-05T10:00:00Z"),
      }),
    ];

    await createOrder({
      supplierId: "supplier-1",
      items,
      creditIds: ["credit-1", "credit-2"],
    });

    // 200 to cover: the older credit is drained first, the newer one tops up.
    expect(state.credits[0]!.montantRestant).toBe(0);
    expect(state.credits[1]!.montantRestant).toBe(420);
  });

  it("refuses a credit belonging to another supplier", async () => {
    state.credits = [credit({ supplierId: "supplier-2" })];

    await expect(
      createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] }),
    ).rejects.toThrow(/ne sont plus disponibles/);
    expect(state.credits[0]!.montantRestant).toBe(300);
    expect(state.orders).toHaveLength(0);
  });

  it("refuses a claim the supplier has not confirmed yet", async () => {
    // An `emis` claim is a request, not money in hand.
    state.credits = [credit({ statut: "EMIS" })];

    await expect(
      createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] }),
    ).rejects.toThrow(/ne sont plus disponibles/);
    expect(state.orders).toHaveLength(0);
  });

  it("refuses a claim the supplier refunded in cash", async () => {
    // That money already came back; deducting it here would pay twice.
    state.credits = [credit({ modeCompensation: "ESPECES" })];

    await expect(
      createOrder({ supplierId: "supplier-1", items, creditIds: ["credit-1"] }),
    ).rejects.toThrow(/ne sont plus disponibles/);
    expect(state.orders).toHaveLength(0);
  });
});
