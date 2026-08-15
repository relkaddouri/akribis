import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Opening a session, against the case that broke it in real use.
 *
 * A device's product cache can be ahead of the server: a product created
 * offline whose own sync never landed still sits in IndexedDB. Inserting a
 * count line for it violates the foreign key on `products`, which rolls the
 * whole transaction back — so no session is created at all, and every count
 * queued behind it then fails with "session introuvable". One unsynced
 * product was enough to make the module unusable.
 *
 * The fake reproduces that constraint: createMany throws for an unknown
 * product id, exactly as Postgres does.
 */
const state = vi.hoisted(() => ({
  products: [] as Array<{ id: string; pharmacyId: string }>,
  sessions: [] as Array<{ id: string; pharmacyId: string; statut: string }>,
  counts: [] as Array<{ sessionId: string; productId: string; quantiteTheorique: number }>,
}));

function makeTx() {
  return {
    inventorySession: {
      create: async ({ data }: { data: { id?: string; pharmacyId: string; statut: string } }) => {
        const session = {
          id: data.id ?? crypto.randomUUID(),
          pharmacyId: data.pharmacyId,
          statut: data.statut,
        };
        state.sessions.push(session);
        return { ...session, dateDebut: new Date(), dateFin: null };
      },
    },
    inventoryCount: {
      createMany: async ({ data }: { data: (typeof state.counts)[number][] }) => {
        for (const row of data) {
          // The foreign key. Postgres rejects the whole statement, and with
          // it the transaction that created the session.
          if (!state.products.some((p) => p.id === row.productId)) {
            state.sessions.pop();
            throw new Error(
              "Foreign key constraint violated on the constraint: `inventory_counts_product_id_fkey`",
            );
          }
          state.counts.push(row);
        }
        return { count: data.length };
      },
    },
  };
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    inventorySession: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) => {
        const session = state.sessions.find(
          (s) => s.id === where.id && s.pharmacyId === where.pharmacyId,
        );
        return session ? { ...session, dateDebut: new Date(), dateFin: null } : null;
      },
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
  requireUser: async () => ({
    id: "user-1",
    email: "owner@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "pharmacy-1",
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { startInventorySession } = await import("@/lib/server/inventory");

const STARTED_AT = "2026-08-15T08:00:00.000Z";

beforeEach(() => {
  state.products = [
    { id: "p1", pharmacyId: "pharmacy-1" },
    { id: "p2", pharmacyId: "pharmacy-1" },
  ];
  state.sessions = [];
  state.counts = [];
});

describe("opening a session from a device cache", () => {
  it("opens over the products the server knows", async () => {
    const session = await startInventorySession(
      {
        startedAt: STARTED_AT,
        lines: [
          { productId: "p1", quantiteTheorique: 40 },
          { productId: "p2", quantiteTheorique: 12 },
        ],
      },
      { id: "session-1" },
    );

    expect(session.id).toBe("session-1");
    expect(state.counts).toHaveLength(2);
    expect(session.skippedProductIds).toEqual([]);
  });

  it("still opens when the device holds a product the server has never seen", async () => {
    const session = await startInventorySession(
      {
        startedAt: STARTED_AT,
        lines: [
          { productId: "p1", quantiteTheorique: 40 },
          // Created offline, sync abandoned — no row in `products`.
          { productId: "jamais-synchronise", quantiteTheorique: 5 },
          { productId: "p2", quantiteTheorique: 12 },
        ],
      },
      { id: "session-1" },
    );

    // The session exists. Before the fix, the foreign key took it down with
    // the unknown product, and every queued count failed behind it.
    expect(state.sessions).toHaveLength(1);
    expect(session.id).toBe("session-1");
    expect(state.counts.map((c) => c.productId).sort()).toEqual(["p1", "p2"]);
  });

  it("reports the products it left out rather than dropping them silently", async () => {
    const session = await startInventorySession(
      {
        startedAt: STARTED_AT,
        lines: [
          { productId: "p1", quantiteTheorique: 40 },
          { productId: "jamais-synchronise", quantiteTheorique: 5 },
        ],
      },
      { id: "session-1" },
    );

    // The sync engine turns this into a conflict-log entry: a product that
    // will never be adjusted has to be visible somewhere.
    expect(session.skippedProductIds).toEqual(["jamais-synchronise"]);
  });

  it("opens even when the server knows none of the products", async () => {
    state.products = [];

    const session = await startInventorySession(
      { startedAt: STARTED_AT, lines: [{ productId: "p1", quantiteTheorique: 40 }] },
      { id: "session-1" },
    );

    expect(state.sessions).toHaveLength(1);
    expect(state.counts).toHaveLength(0);
    expect(session.skippedProductIds).toEqual(["p1"]);
  });

  it("is a no-op when replayed", async () => {
    const input = {
      startedAt: STARTED_AT,
      lines: [{ productId: "p1", quantiteTheorique: 40 }],
    };

    await startInventorySession(input, { id: "session-1" });
    await startInventorySession(input, { id: "session-1" });

    expect(state.sessions).toHaveLength(1);
    expect(state.counts).toHaveLength(1);
  });
});
