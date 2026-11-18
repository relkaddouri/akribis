import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/offline/db";
import { setOfflineSession } from "@/lib/offline/session";
import { processQueue } from "@/lib/offline/sync-engine";
import { enqueue } from "@/lib/offline/sync-queue";
import { listLocalSessions, listSessionCounts } from "@/lib/offline/inventory";

/**
 * The inventory module used to push only: a session lived in the browser
 * that created it and nowhere else. A device that had never opened one —
 * or whose site data had been cleared — showed "Aucun inventaire" while
 * the sessions sat in Postgres, unreachable.
 *
 * These tests cover the missing direction, against the real Dexie store
 * (fake-indexeddb, wired in tests/setup.ts) with only lib/server/* mocked.
 */
const remote = vi.hoisted(() => ({
  listInventorySessions: vi.fn(),
  listInventorySessionCounts: vi.fn(),
  recordInventoryCount: vi.fn(),
}));

vi.mock("@/lib/server/inventory", () => ({
  startInventorySession: vi.fn(),
  recordInventoryCount: remote.recordInventoryCount,
  applyInventoryAdjustments: vi.fn(),
  listInventorySessions: remote.listInventorySessions,
  listInventorySessionCounts: remote.listInventorySessionCounts,
}));

vi.mock("@/lib/server/products", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  getProduct: vi.fn(),
  listProducts: vi.fn(async () => []),
}));
vi.mock("@/lib/server/sales", () => ({ createSale: vi.fn() }));
vi.mock("@/lib/server/orders", () => ({ receiveOrder: vi.fn() }));

const SESSION_ID = "session-serveur-1";

function serverSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    pharmacyId: "pharmacy-1",
    statut: "termine" as const,
    dateDebut: new Date("2026-08-16T14:24:30.896Z"),
    dateFin: new Date("2026-08-16T15:02:00.000Z"),
    totalCount: 1,
    countedCount: 1,
    varianceCount: 1,
    varianceValue: 100,
    ...overrides,
  };
}

function serverCount(overrides: Record<string, unknown> = {}) {
  return {
    id: "count-1",
    productId: "p1",
    productName: "Efferalgan 500mg",
    quantiteTheorique: 200,
    unitPrice: 18,
    quantiteComptee: 300,
    dateComptage: new Date("2026-08-16T14:24:37.029Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  setOfflineSession("pharmacy-1", "user-1");
  remote.listInventorySessions.mockResolvedValue([]);
  remote.listInventorySessionCounts.mockResolvedValue([]);
  const db = getDb();
  await db.syncQueue.clear();
  await db.products.clear();
  await db.inventorySessions.clear();
  await db.inventoryCounts.clear();
});

describe("pulling inventory history down from the server", () => {
  it("makes a session the device has never seen appear, with its lines", async () => {
    remote.listInventorySessions.mockResolvedValue([serverSession()]);
    remote.listInventorySessionCounts.mockResolvedValue([serverCount()]);

    await processQueue();

    const sessions = await listLocalSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(SESSION_ID);
    expect(sessions[0].statut).toBe("termine");
    // Filed under the pharmacy, or every screen would filter it straight out.
    expect(sessions[0].pharmacyId).toBe("pharmacy-1");

    const counts = await listSessionCounts(SESSION_ID);
    expect(counts).toHaveLength(1);
    expect(counts[0].quantiteComptee).toBe(300);
    expect(counts[0].quantiteTheorique).toBe(200);
    expect(counts[0].productName).toBe("Efferalgan 500mg");
  });

  it("refreshes a session it already holds without re-reading its lines", async () => {
    remote.listInventorySessions.mockResolvedValue([serverSession({ statut: "en_cours", dateFin: null })]);
    remote.listInventorySessionCounts.mockResolvedValue([serverCount()]);
    await processQueue();
    expect(remote.listInventorySessionCounts).toHaveBeenCalledTimes(1);

    // Someone closed it on another device.
    remote.listInventorySessions.mockResolvedValue([serverSession()]);
    await processQueue();

    const sessions = await listLocalSessions();
    expect(sessions[0].statut).toBe("termine");
    // The lines are the same rows — dragging the whole shelf list down on
    // every pass is exactly what this must not do.
    expect(remote.listInventorySessionCounts).toHaveBeenCalledTimes(1);
  });

  it("leaves a session alone while one of its counts is still queued", async () => {
    const db = getDb();
    await db.inventorySessions.put({
      id: SESSION_ID,
      pharmacyId: "pharmacy-1",
      statut: "en_cours",
      dateDebut: new Date("2026-08-19T09:00:00.000Z"),
      dateFin: null,
      syncStatus: "pending",
    });
    await db.inventoryCounts.put({
      id: "count-local",
      sessionId: SESSION_ID,
      productId: "p1",
      productName: "Efferalgan 500mg",
      quantiteTheorique: 200,
      unitPrice: 18,
      quantiteComptee: 42,
      dateComptage: new Date("2026-08-19T09:30:00.000Z"),
    });

    // A count typed on the shelf that has not landed yet. Parked behind a
    // backoff so it stays unsettled through this pass — the case where the
    // server's copy is genuinely older than the device's.
    const item = await enqueue({
      type: "recordInventoryCount",
      entityId: "count-local",
      payload: { input: { sessionId: SESSION_ID, productId: "p1", quantiteComptee: 42 } },
      clientTimestamp: new Date("2026-08-19T09:30:00.000Z"),
    });
    await db.syncQueue.update(item.id, {
      status: "failed",
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    remote.listInventorySessions.mockResolvedValue([serverSession()]);
    remote.listInventorySessionCounts.mockResolvedValue([serverCount()]);

    await processQueue();

    const sessions = await listLocalSessions();
    // Still open, still holding the figure counted on the shelf: the
    // server's "termine" would have thrown away the morning's work.
    expect(sessions[0].statut).toBe("en_cours");
    const counts = await listSessionCounts(SESSION_ID);
    expect(counts[0].quantiteComptee).toBe(42);
    expect(remote.listInventorySessionCounts).not.toHaveBeenCalled();
  });

  it("keeps draining the queue when the history read fails", async () => {
    remote.listInventorySessions.mockRejectedValue(new Error("boom"));

    await expect(processQueue()).resolves.toBeUndefined();
  });
});
