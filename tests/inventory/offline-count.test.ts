import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type LocalProduct } from "@/lib/offline/db";
import { setOfflineSession } from "@/lib/offline/session";
import { processQueue } from "@/lib/offline/sync-engine";
import { countPendingSyncItems } from "@/lib/offline/sync-queue";
import {
  applyAdjustments,
  buildLocalVarianceReport,
  listSessionCounts,
  recordCount,
  startInventorySession,
} from "@/lib/offline/inventory";

/**
 * The real Dexie store and the real sync engine, with a stand-in server
 * that behaves like the network does: unreachable while offline, and able
 * to lose a reply after committing.
 *
 * The scenario is the one that revealed the delivery-duplication bug —
 * count with no signal, reconnect, replay — asked of a module written with
 * that lesson already applied.
 */
class OfflineFetchError extends TypeError {
  constructor(message = "Failed to fetch") {
    super(message);
  }
}

const server = vi.hoisted(() => ({
  sessions: [] as Array<{ id: string; statut: string }>,
  /** Keyed `sessionId:productId`, so a duplicated count would be visible. */
  counts: new Map<string, { quantiteComptee: number; writes: number }>(),
  products: new Map<string, number>(),
  movements: [] as Array<{ productId: string; quantity: number; type: string }>,
}));

function guard() {
  if (!navigator.onLine) throw new OfflineFetchError();
}

vi.mock("@/lib/server/inventory", () => ({
  startInventorySession: vi.fn(
    async (input: { lines: Array<{ productId: string; quantiteTheorique: number }> }, options?: { id?: string }) => {
      guard();
      const id = options?.id ?? crypto.randomUUID();
      const existing = server.sessions.find((s) => s.id === id);
      // Mirrors the real guard: a replay finds the session and returns it.
      if (existing) {
        return { id, statut: existing.statut, dateDebut: new Date(), dateFin: null, skippedProductIds: [] };
      }
      server.sessions.push({ id, statut: "en_cours" });
      for (const line of input.lines) {
        server.counts.set(`${id}:${line.productId}`, { quantiteComptee: -1, writes: 0 });
      }
      return { id, statut: "en_cours", dateDebut: new Date(), dateFin: null, skippedProductIds: [] };
    },
  ),
  recordInventoryCount: vi.fn(
    async (input: { sessionId: string; productId: string; quantiteComptee: number }) => {
      guard();
      const key = `${input.sessionId}:${input.productId}`;
      const row = server.counts.get(key);
      // The (session, product) unique index: a replay rewrites one row.
      server.counts.set(key, {
        quantiteComptee: input.quantiteComptee,
        writes: (row?.writes ?? 0) + 1,
      });
    },
  ),
  applyInventoryAdjustments: vi.fn(
    async (input: {
      sessionId: string;
      adjustments: Array<{ productId: string; quantiteComptee: number; ecart: number }>;
    }) => {
      guard();
      const session = server.sessions.find((s) => s.id === input.sessionId);
      if (!session) throw new Error("Session d'inventaire introuvable.");
      if (session.statut === "termine") return;
      for (const adjustment of input.adjustments) {
        server.products.set(adjustment.productId, adjustment.quantiteComptee);
        server.movements.push({
          productId: adjustment.productId,
          quantity: Math.abs(adjustment.ecart),
          type: adjustment.ecart > 0 ? "IN" : "OUT",
        });
      }
      session.statut = "termine";
    },
  ),
}));

vi.mock("@/lib/server/products", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  getProduct: vi.fn(),
  listProducts: vi.fn(async () => {
    guard();
    return [];
  }),
}));
vi.mock("@/lib/server/sales", () => ({ createSale: vi.fn() }));
vi.mock("@/lib/server/orders", () => ({ receiveOrder: vi.fn() }));

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

function product(id: string, name: string, quantityInStock: number, price = 10): LocalProduct {
  const now = new Date();
  return {
    id,
    pharmacyId: "pharmacy-1",
    name,
    form: "Comprimé",
    dosage: null,
    laboratory: null,
    barcode: null,
    dci: null,
    photoUrl: null,
    category: null,
    price,
    pph: null,
    tvaVente: null,
    tvaAchat: null,
    lowStockThreshold: 0,
    quantityInStock,
    nearestExpiryDate: null,
    remboursable: false,
    baseRemboursement: null,
    posologieEnfant: null,
    posologieAdulte: null,
    monographie: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "synced",
  };
}

/**
 * The offline layer fires `void processQueue()` after every write. Those
 * promises outlive the test that started them, and a straggler landing in
 * the next test consumes a `mockImplementationOnce` meant for it — which
 * showed up as a count lost in whichever test happened to run second.
 * Draining them while still offline keeps each test self-contained.
 */
async function settleBackgroundSync() {
  setOnline(false);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Drains the queue instead of assuming one pass empties it.
 *
 * `processQueue` returns immediately when a pass is already running, and
 * the offline layer fires one after every write. A single awaited call can
 * therefore be the one that no-ops while the floating pass is still mid-
 * flight — which showed up as a count that never synced, about one run in
 * five. The poller behaves the same way in production: it keeps going
 * until nothing is left.
 */
async function drainQueue(maxPasses = 10) {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    await processQueue();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if ((await countPendingSyncItems()) === 0) return;
  }
}

beforeEach(async () => {
  await settleBackgroundSync();
  vi.clearAllMocks();
  server.sessions = [];
  server.counts = new Map();
  server.products = new Map();
  server.movements = [];
  setOfflineSession("pharmacy-1", "user-1");
  setOnline(true);

  const db = getDb();
  await db.products.clear();
  await db.syncQueue.clear();
  await db.conflictLog.clear();
  await db.inventorySessions.clear();
  await db.inventoryCounts.clear();
  await db.products.bulkPut([
    product("p1", "Doliprane 500mg", 40, 12.5),
    product("p2", "Augmentin 1g", 12, 60),
    product("p3", "Sérum physiologique", 8, 5),
  ]);
});

describe("counting an entire session with no network", () => {
  it("opens the session from the cached products alone", async () => {
    setOnline(false);

    const session = await startInventorySession();

    expect(session.statut).toBe("en_cours");
    const counts = await listSessionCounts(session.id);
    // Expected quantities come from the local product cache, frozen now.
    expect(counts).toHaveLength(3);
    expect(counts.map((c) => c.quantiteTheorique).sort((a, b) => a - b)).toEqual([8, 12, 40]);
    expect(counts.every((c) => c.quantiteComptee === null)).toBe(true);
  });

  it("keeps the expected quantity frozen while the shelves keep moving", async () => {
    setOnline(false);
    const session = await startInventorySession();

    // A sale goes through at the till during the count.
    await getDb().products.update("p1", { quantityInStock: 36 });

    const counts = await listSessionCounts(session.id);
    const line = counts.find((c) => c.productId === "p1")!;
    // Still 40. Re-reading it would quietly erase the very discrepancy the
    // count exists to reveal.
    expect(line.quantiteTheorique).toBe(40);
  });

  it("records every count locally and queues each one separately", async () => {
    setOnline(false);
    const session = await startInventorySession();

    await recordCount(session.id, "p1", 37);
    await recordCount(session.id, "p2", 12);

    const counts = await listSessionCounts(session.id);
    expect(counts.find((c) => c.productId === "p1")!.quantiteComptee).toBe(37);
    expect(counts.find((c) => c.productId === "p2")!.quantiteComptee).toBe(12);
    // One for the session, one per count — a tablet dying mid-inventory
    // must not take the morning's counting with it.
    expect(await countPendingSyncItems()).toBe(3);
  });

  it("builds the variance report offline, listing only real gaps", async () => {
    setOnline(false);
    const session = await startInventorySession();
    await recordCount(session.id, "p1", 37);
    await recordCount(session.id, "p2", 12);

    const report = await buildLocalVarianceReport(session.id);

    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toMatchObject({ productId: "p1", ecart: -3, valeurEcart: -37.5 });
    // p3 was never counted: absent from the report rather than reported as
    // a total loss, and the progress figure says so.
    expect(report.countedCount).toBe(2);
    expect(report.totalCount).toBe(3);
  });
});

describe("the connection comes back", () => {
  it("loses no count and creates exactly one session", async () => {
    setOnline(false);
    const session = await startInventorySession();
    await recordCount(session.id, "p1", 37);
    await recordCount(session.id, "p2", 12);
    await recordCount(session.id, "p3", 8);
    expect(await countPendingSyncItems()).toBe(4);

    await settleBackgroundSync();
    setOnline(true);
    await drainQueue();

    expect(await countPendingSyncItems()).toBe(0);
    expect(server.sessions).toHaveLength(1);
    expect(server.counts.get(`${session.id}:p1`)!.quantiteComptee).toBe(37);
    expect(server.counts.get(`${session.id}:p2`)!.quantiteComptee).toBe(12);
    expect(server.counts.get(`${session.id}:p3`)!.quantiteComptee).toBe(8);
  });

  it("duplicates nothing when replies are lost and the queue replays", async () => {
    setOnline(false);
    const session = await startInventorySession();
    await recordCount(session.id, "p1", 37);
    await recordCount(session.id, "p2", 12);
    await applyAdjustments(session.id);

    // Let the offline-phase background syncs settle before arming the
    // lost-reply behaviour, so the wrappers below are consumed by this
    // test's own replay and nothing else.
    await settleBackgroundSync();
    setOnline(true);

    // Every server call commits and then loses its reply — the exact
    // at-least-once window that duplicated delivery receipts.
    const inventory = await import("@/lib/server/inventory");
    for (const fn of [
      inventory.startInventorySession,
      inventory.recordInventoryCount,
      inventory.applyInventoryAdjustments,
    ]) {
      const mocked = vi.mocked(fn as (...args: never[]) => Promise<unknown>);
      const commit = mocked.getMockImplementation()!;
      mocked.mockImplementationOnce(async (...args: never[]) => {
        await commit(...args);
        throw new OfflineFetchError();
      });
    }

    await drainQueue();

    expect(await countPendingSyncItems()).toBe(0);
    expect(server.sessions).toHaveLength(1);
    // Three rows, one per product in the session — a replayed count is an
    // update of its own row, not a second row. It is written twice on
    // purpose; what must never double is the row, the session, or the
    // stock movement.
    expect(server.counts.size).toBe(3);
    expect(server.counts.get(`${session.id}:p1`)!.quantiteComptee).toBe(37);
    expect(server.counts.get(`${session.id}:p2`)!.quantiteComptee).toBe(12);
    expect(server.movements).toHaveLength(1);
    expect(server.movements[0]).toMatchObject({ productId: "p1", quantity: 3, type: "OUT" });
    // Stock is the counted figure, not a delta applied twice.
    expect(server.products.get("p1")).toBe(37);
  });

  it("applies the correction to local stock immediately, before any sync", async () => {
    setOnline(false);
    const session = await startInventorySession();
    await recordCount(session.id, "p1", 37);
    await recordCount(session.id, "p3", 11);

    await applyAdjustments(session.id);

    const db = getDb();
    expect((await db.products.get("p1"))!.quantityInStock).toBe(37);
    expect((await db.products.get("p3"))!.quantityInStock).toBe(11);
    // Untouched: counted exactly as expected, so not in the report at all.
    expect((await db.products.get("p2"))!.quantityInStock).toBe(12);
    expect((await db.inventorySessions.get(session.id))!.statut).toBe("termine");
  });

  it("refuses to apply a session twice, locally", async () => {
    setOnline(false);
    const session = await startInventorySession();
    await recordCount(session.id, "p1", 37);
    await applyAdjustments(session.id);

    await expect(applyAdjustments(session.id)).rejects.toThrow(/déjà terminé/);
    expect((await getDb().products.get("p1"))!.quantityInStock).toBe(37);
  });
});
