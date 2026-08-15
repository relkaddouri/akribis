import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory Prisma fake for applying a stock count, same approach as
 * tests/orders/receive-order.test.ts.
 *
 * What this suite protects is the arithmetic of a correction. A count is
 * the one moment a pharmacist asserts what is physically on the shelf, and
 * the recorded stock has to end up at that number exactly — not at the
 * expected figure nudged by a delta, which lands somewhere nobody counted
 * as soon as anything else moved in between.
 */
const state = vi.hoisted(() => ({
  /** Statements issued inside the transaction — must not grow with the count. */
  queryCount: 0,
  sessions: [] as Array<{ id: string; pharmacyId: string; statut: string; dateFin: Date | null }>,
  products: [] as Array<{ id: string; pharmacyId: string; name: string; quantityInStock: number }>,
  stockMovements: [] as Array<{
    productId: string;
    type: string;
    quantity: number;
    reason: string;
    createdAt: Date;
  }>,
}));

function makeTx() {
  return {
    inventorySession: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) =>
        state.sessions.find((s) => s.id === where.id && s.pharmacyId === where.pharmacyId) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { statut: string; dateFin: Date };
      }) => {
        const session = state.sessions.find((s) => s.id === where.id);
        if (session) {
          session.statut = data.statut;
          session.dateFin = data.dateFin;
        }
        return session;
      },
    },
    product: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) =>
        state.products.find((p) => p.id === where.id && p.pharmacyId === where.pharmacyId) ?? null,
      findMany: async ({ where }: { where: { id: { in: string[] }; pharmacyId: string } }) => {
        state.queryCount += 1;
        return state.products.filter(
          (p) => where.id.in.includes(p.id) && p.pharmacyId === where.pharmacyId,
        );
      },
    },
    /**
     * Stands in for the bulk `UPDATE ... FROM (VALUES ...)`. The pairs are
     * read from the fragments the caller composed rather than by parsing
     * SQL, so the test still checks *which* product gets *which* quantity —
     * the thing that matters — without pretending to be Postgres.
     */
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      state.queryCount += 1;
      const pairs = (values[0] as FakeSql).pairs;
      const pharmacyId = values[1] as string;
      let affected = 0;
      for (const [id, qty] of pairs) {
        const product = state.products.find((p) => p.id === id && p.pharmacyId === pharmacyId);
        if (!product) continue;
        product.quantityInStock = qty;
        affected += 1;
      }
      return affected;
    },
    stockMovement: {
      createMany: async ({ data }: { data: (typeof state.stockMovements)[number][] }) => {
        state.queryCount += 1;
        state.stockMovements.push(...data);
        return { count: data.length };
      },
    },
  };
}

/** What `Prisma.sql` / `Prisma.join` produce, reduced to what the fake needs. */
type FakeSql = { pairs: Array<[string, number]> };

vi.mock("@/lib/db/generated/client", () => ({
  Prisma: {
    sql: (_strings: TemplateStringsArray, ...values: unknown[]): FakeSql => ({
      pairs: [[values[0] as string, values[1] as number]],
    }),
    join: (fragments: FakeSql[]): FakeSql => ({
      pairs: fragments.flatMap((fragment) => fragment.pairs),
    }),
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> =>
      fn(makeTx()),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    id: "user-1",
    email: "owner@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "pharmacy-1",
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { applyInventoryAdjustments } = await import("@/lib/server/inventory");

const APPLIED_AT = "2026-08-14T09:30:00.000Z";

function seedSession(id = "session-1") {
  state.sessions.push({ id, pharmacyId: "pharmacy-1", statut: "EN_COURS", dateFin: null });
  return id;
}

function seedProduct(id: string, quantityInStock: number) {
  state.products.push({ id, pharmacyId: "pharmacy-1", name: `Produit ${id}`, quantityInStock });
}

beforeEach(() => {
  state.sessions = [];
  state.products = [];
  state.stockMovements = [];
  state.queryCount = 0;
});

describe("applying a count to stock", () => {
  it("sets stock to the counted quantity, not to a recomputed figure", async () => {
    const sessionId = seedSession();
    seedProduct("p1", 40);
    seedProduct("p2", 5);

    await applyInventoryAdjustments({
      sessionId,
      adjustments: [
        { productId: "p1", quantiteComptee: 37, ecart: -3 },
        { productId: "p2", quantiteComptee: 9, ecart: 4 },
      ],
      appliedAt: APPLIED_AT,
    });

    expect(state.products.find((p) => p.id === "p1")!.quantityInStock).toBe(37);
    expect(state.products.find((p) => p.id === "p2")!.quantityInStock).toBe(9);
  });

  it("lands on the counted figure even if stock moved since the count", async () => {
    const sessionId = seedSession();
    // Counted at 37 in the stockroom; two more were sold at the till before
    // the tablet came back online, so the server now says 38.
    seedProduct("p1", 38);

    await applyInventoryAdjustments({
      sessionId,
      adjustments: [{ productId: "p1", quantiteComptee: 37, ecart: -3 }],
      appliedAt: APPLIED_AT,
    });

    // 37, the shelf as counted. Applying the -3 delta would have given 35 —
    // a number that describes neither the shelf nor the ledger.
    expect(state.products[0]!.quantityInStock).toBe(37);
  });

  it("records one movement per adjusted product, dated when it was applied", async () => {
    const sessionId = seedSession();
    seedProduct("p1", 40);

    await applyInventoryAdjustments({
      sessionId,
      adjustments: [{ productId: "p1", quantiteComptee: 37, ecart: -3 }],
      appliedAt: APPLIED_AT,
    });

    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements[0]).toMatchObject({ productId: "p1", type: "OUT", quantity: 3 });
    // The moment the pharmacist corrected the shelf, not the moment the
    // write happened to reach Postgres.
    expect(state.stockMovements[0]!.createdAt.toISOString()).toBe(APPLIED_AT);
  });

  it("marks a surplus as an inbound movement", async () => {
    const sessionId = seedSession();
    seedProduct("p1", 5);

    await applyInventoryAdjustments({
      sessionId,
      adjustments: [{ productId: "p1", quantiteComptee: 9, ecart: 4 }],
      appliedAt: APPLIED_AT,
    });

    expect(state.stockMovements[0]).toMatchObject({ type: "IN", quantity: 4 });
  });

  it("writes no movement for a product counted exactly as expected", async () => {
    const sessionId = seedSession();
    seedProduct("p1", 40);
    seedProduct("p2", 12);

    // Only p1 is in variance; p2 was counted at 12 and is therefore absent
    // from the adjustments the report produces.
    await applyInventoryAdjustments({
      sessionId,
      adjustments: [{ productId: "p1", quantiteComptee: 37, ecart: -3 }],
      appliedAt: APPLIED_AT,
    });

    // A movement of zero units would be noise in the stock ledger, and
    // would make an untouched product look handled.
    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements.every((m) => m.productId !== "p2")).toBe(true);
    expect(state.products.find((p) => p.id === "p2")!.quantityInStock).toBe(12);
  });

  it("closes the session, stamped with the moment it was applied", async () => {
    const sessionId = seedSession();
    seedProduct("p1", 40);

    await applyInventoryAdjustments({
      sessionId,
      adjustments: [{ productId: "p1", quantiteComptee: 37, ecart: -3 }],
      appliedAt: APPLIED_AT,
    });

    expect(state.sessions[0]!.statut).toBe("TERMINE");
    expect(state.sessions[0]!.dateFin!.toISOString()).toBe(APPLIED_AT);
  });
});

describe("a replayed application", () => {
  it("corrects stock once, however many times it is replayed", async () => {
    const sessionId = seedSession();
    seedProduct("p1", 40);
    const input = {
      sessionId,
      adjustments: [{ productId: "p1", quantiteComptee: 37, ecart: -3 }],
      appliedAt: APPLIED_AT,
    };

    await applyInventoryAdjustments(input);
    await applyInventoryAdjustments(input);
    await applyInventoryAdjustments(input);

    // The closed session is the idempotency key. Without it the second pass
    // would write another movement, and a delta-based correction would have
    // walked stock down to 31.
    expect(state.products[0]!.quantityInStock).toBe(37);
    expect(state.stockMovements).toHaveLength(1);
  });

  it("refuses a late count once the session is closed", async () => {
    const sessionId = seedSession();
    seedProduct("p1", 40);
    await applyInventoryAdjustments({
      sessionId,
      adjustments: [{ productId: "p1", quantiteComptee: 37, ecart: -3 }],
      appliedAt: APPLIED_AT,
    });

    // Nothing to assert beyond the state: a closed session simply absorbs
    // further applications, leaving the signed-off report intact.
    await applyInventoryAdjustments({
      sessionId,
      adjustments: [{ productId: "p1", quantiteComptee: 99, ecart: 62 }],
      appliedAt: APPLIED_AT,
    });

    expect(state.products[0]!.quantityInStock).toBe(37);
  });

  it("refuses a session from another pharmacy", async () => {
    state.sessions.push({
      id: "session-x",
      pharmacyId: "pharmacy-2",
      statut: "EN_COURS",
      dateFin: null,
    });
    seedProduct("p1", 40);

    await expect(
      applyInventoryAdjustments({
        sessionId: "session-x",
        adjustments: [{ productId: "p1", quantiteComptee: 1, ecart: -39 }],
        appliedAt: APPLIED_AT,
      }),
    ).rejects.toThrow(/introuvable/);
    expect(state.products[0]!.quantityInStock).toBe(40);
  });
});

describe("the cost of applying a large count", () => {
  /**
   * Seen in real use: applying an inventory died with
   *   P2028 — A query cannot be executed on an expired transaction.
   *   The timeout was 5000 ms, however 6584 ms passed.
   *
   * The first version issued three round trips per adjusted product — a
   * read, an update, a movement — so an ordinary pharmacy's count was
   * hundreds of sequential queries on one pooled connection. Nothing was
   * applied and the queued write retried for ever.
   *
   * The fix is not a longer timeout: it is a fixed number of statements.
   */
  function seedManyProducts(count: number) {
    const adjustments = [];
    for (let i = 0; i < count; i += 1) {
      state.products.push({
        id: `p${i}`,
        pharmacyId: "pharmacy-1",
        name: `Produit ${i}`,
        quantityInStock: 10,
      });
      adjustments.push({
        productId: `p${i}`,
        productName: `Produit ${i}`,
        quantiteTheorique: 10,
        quantiteComptee: 7,
        ecart: -3,
        valeurEcart: -30,
      });
    }
    return adjustments;
  }

  it("issues the same number of queries for 5 products as for 300", async () => {
    seedSession("session-small");
    const small = seedManyProducts(5);
    await applyInventoryAdjustments({
      sessionId: "session-small",
      adjustments: small,
      appliedAt: APPLIED_AT,
    });
    const forFive = state.queryCount;

    state.products = [];
    state.queryCount = 0;
    seedSession("session-large");
    const large = seedManyProducts(300);
    await applyInventoryAdjustments({
      sessionId: "session-large",
      adjustments: large,
      appliedAt: APPLIED_AT,
    });

    // Constant, not proportional. This is the whole fix.
    expect(state.queryCount).toBe(forFive);
    expect(state.queryCount).toBeLessThanOrEqual(3);
  });

  it("still lands every one of the 300 products on its counted figure", async () => {
    seedSession("session-large");
    const adjustments = seedManyProducts(300);

    await applyInventoryAdjustments({
      sessionId: "session-large",
      adjustments,
      appliedAt: APPLIED_AT,
    });

    // Batching must not quietly drop rows: every product, not just the
    // first page of them.
    expect(state.products.every((product) => product.quantityInStock === 7)).toBe(true);
    expect(state.stockMovements).toHaveLength(300);
  });
});
