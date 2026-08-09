import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type LocalProduct } from "@/lib/offline/db";
import { setOfflineSession } from "@/lib/offline/session";
import { processQueue, getSnapshot } from "@/lib/offline/sync-engine";
import { countPendingSyncItems } from "@/lib/offline/sync-queue";
import { createSale } from "@/lib/offline/sales";
import { updateProduct } from "@/lib/offline/products";

/**
 * These tests exercise the real Dexie database (via fake-indexeddb,
 * wired globally in tests/setup.ts) and the real sync engine — only the
 * lib/server/* functions it eventually calls are mocked, standing in
 * for Postgres.
 */
const remote = vi.hoisted(() => ({
  createProduct: vi.fn(),
  getProduct: vi.fn(),
  listProducts: vi.fn(),
  updateProduct: vi.fn(),
  createSale: vi.fn(),
  receiveOrder: vi.fn(),
}));

vi.mock("@/lib/server/products", () => ({
  createProduct: remote.createProduct,
  getProduct: remote.getProduct,
  listProducts: remote.listProducts,
  updateProduct: remote.updateProduct,
}));

vi.mock("@/lib/server/sales", () => ({
  createSale: remote.createSale,
}));

vi.mock("@/lib/server/orders", () => ({
  receiveOrder: remote.receiveOrder,
}));

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

function seedProduct(overrides: Partial<LocalProduct> = {}): LocalProduct {
  const now = new Date();
  return {
    id: "p1",
    pharmacyId: "pharmacy-1",
    name: "Doliprane 500mg",
    form: "Comprimé",
    dosage: null,
    laboratory: null,
    barcode: null,
    dci: null,
    photoUrl: null,
    category: null,
    price: 10,
    pph: null,
    tvaVente: null,
    tvaAchat: null,
    lowStockThreshold: 0,
    quantityInStock: 5,
    nearestExpiryDate: null,
    remboursable: false,
    baseRemboursement: null,
    posologieEnfant: null,
    posologieAdulte: null,
    monographie: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "synced",
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  remote.listProducts.mockResolvedValue([]);
  setOfflineSession("pharmacy-1", "user-1");
  setOnline(true);
  const db = getDb();
  await db.products.clear();
  await db.syncQueue.clear();
  await db.conflictLog.clear();
});

describe("offline sale during a connection loss", () => {
  it("queues the sale and decrements local stock immediately while offline", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5 }));

    setOnline(false);

    const receipt = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 2 }],
    });

    expect(receipt.totalAmount).toBe(20);

    const cached = await db.products.get("p1");
    expect(cached?.quantityInStock).toBe(3);

    const queued = await db.syncQueue.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("pending");
    expect(queued[0].type).toBe("createSale");
    // Never attempted while offline — no network call should have happened.
    expect(remote.createSale).not.toHaveBeenCalled();
  });

  it("syncs the queued sale to the server once the connection returns", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5 }));

    setOnline(false);
    const receipt = await createSale({
      paymentMethod: "CARD",
      items: [{ productId: "p1", quantity: 2 }],
    });

    // Connection comes back.
    setOnline(true);
    remote.createSale.mockResolvedValue({
      id: receipt.id,
      createdAt: new Date(),
      paymentMethod: "CARD",
      totalAmount: 20,
      clientName: null,
      items: [],
    });

    await processQueue();

    expect(remote.createSale).toHaveBeenCalledTimes(1);
    expect(remote.createSale).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: "CARD",
        items: [{ productId: "p1", quantity: 2 }],
      }),
      { id: receipt.id },
    );

    const [queued] = await db.syncQueue.toArray();
    expect(queued.status).toBe("synced");

    // Stock stays at the optimistic value — the sync only confirms the
    // write, it doesn't re-decrement.
    const cached = await db.products.get("p1");
    expect(cached?.quantityInStock).toBe(3);
  });

  it("retries a sync that failed on the first attempt and succeeds on the next", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5 }));

    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });

    setOnline(true);
    remote.createSale.mockRejectedValueOnce(new Error("Erreur interne du serveur"));

    await processQueue();

    let [queued] = await db.syncQueue.toArray();
    expect(queued.status).toBe("failed");
    expect(queued.attempts).toBe(1);
    expect(remote.createSale).toHaveBeenCalledTimes(1);

    remote.createSale.mockResolvedValueOnce({
      id: queued.entityId,
      createdAt: new Date(),
      paymentMethod: "CASH",
      totalAmount: 10,
      clientName: null,
      items: [],
    });

    await processQueue();

    [queued] = await db.syncQueue.toArray();
    expect(queued.status).toBe("synced");
    expect(remote.createSale).toHaveBeenCalledTimes(2);
  });

  it("logs a resolved conflict instead of retrying forever when the server rejects for insufficient stock", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5 }));

    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 5 }] });

    setOnline(true);
    remote.createSale.mockRejectedValue(new Error('Stock insuffisant pour "Doliprane 500mg" (0 disponible(s)).'));

    await processQueue();

    const [queued] = await db.syncQueue.toArray();
    expect(queued.status).toBe("failed");
    expect(queued.attempts).toBe(5); // maxed out immediately — retrying won't fix a stock conflict

    const conflicts = await db.conflictLog.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe("sync_rejected");
    expect(conflicts[0].entityType).toBe("sale");

    // Resolved — must not linger in the "en attente" badge count forever.
    expect(await countPendingSyncItems()).toBe(0);

    // A later processQueue() call must not keep hammering the server for this one.
    await processQueue();
    expect(remote.createSale).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying forever, and keeps counting as pending, when the database is unreachable", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5 }));

    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });

    // navigator.onLine reports true (device has a network interface) even
    // though the database itself is unreachable — this is the exact error
    // Prisma throws in that case.
    setOnline(true);
    remote.createSale.mockRejectedValue(
      new Error("Can't reach database server at `aws-0-eu-west-1.pooler.supabase.com`"),
    );

    for (let i = 0; i < 8; i++) {
      await processQueue();
    }

    // Never abandoned, unlike a resolved business rejection: no cap on
    // attempts, so it must still count as pending after many failures.
    const [queued] = await db.syncQueue.toArray();
    expect(queued.status).toBe("failed");
    expect(queued.attempts).toBe(0);
    expect(await countPendingSyncItems()).toBe(1);
    expect(await db.conflictLog.count()).toBe(0);

    // The "online" badge must not lie while the database is unreachable.
    expect(getSnapshot().status).toBe("offline");

    // Connectivity comes back.
    remote.createSale.mockResolvedValueOnce({
      id: queued.entityId,
      createdAt: new Date(),
      paymentMethod: "CASH",
      totalAmount: 10,
      clientName: null,
      items: [],
    });

    await processQueue();

    const [synced] = await db.syncQueue.toArray();
    expect(synced.status).toBe("synced");
    expect(getSnapshot().status).toBe("online");
  });
});

describe("last-write-wins conflict resolution on product edits", () => {
  it("discards a stale local edit and logs it when the server has a newer version", async () => {
    const db = getDb();
    await db.products.put(seedProduct());

    setOnline(false);
    await updateProduct("p1", {
      name: "Doliprane 500mg (édité hors-ligne)",
      form: "Comprimé",
      dosage: "",
      laboratory: "",
      barcode: "",
      dci: "",
      price: "10",
      lowStockThreshold: "0",
      quantityInStock: "5",
      nearestExpiryDate: "",
    });

    setOnline(true);
    const newerRemoteProduct = {
      id: "p1",
      pharmacyId: "pharmacy-1",
      name: "Doliprane 500mg (édité ailleurs)",
      form: "Comprimé",
      dosage: null,
      laboratory: null,
      barcode: null,
      dci: null,
      price: 11,
      lowStockThreshold: 0,
      quantityInStock: 5,
      nearestExpiryDate: null,
      createdAt: new Date(),
      updatedAt: new Date(Date.now() + 60_000), // newer than our local edit
    };
    remote.getProduct.mockResolvedValue(newerRemoteProduct);

    await processQueue();

    expect(remote.updateProduct).not.toHaveBeenCalled();

    const [queued] = await db.syncQueue.toArray();
    expect(queued.status).toBe("synced"); // resolved, not stuck retrying

    const conflicts = await db.conflictLog.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe("remote_wins");
    expect(conflicts[0].entityType).toBe("product");

    const cached = await db.products.get("p1");
    expect(cached?.name).toBe("Doliprane 500mg (édité ailleurs)");
  });

  it("applies the local edit when it's newer than the server's version", async () => {
    const db = getDb();
    await db.products.put(seedProduct());

    setOnline(false);
    await updateProduct("p1", {
      name: "Doliprane 500mg (édité hors-ligne)",
      form: "Comprimé",
      dosage: "",
      laboratory: "",
      barcode: "",
      dci: "",
      price: "12",
      lowStockThreshold: "0",
      quantityInStock: "5",
      nearestExpiryDate: "",
    });

    setOnline(true);
    remote.getProduct.mockResolvedValue({
      ...seedProduct(),
      updatedAt: new Date(Date.now() - 60_000), // older than our local edit
    });
    remote.updateProduct.mockResolvedValue({
      ...seedProduct(),
      name: "Doliprane 500mg (édité hors-ligne)",
      price: 12,
      updatedAt: new Date(),
    });

    await processQueue();

    expect(remote.updateProduct).toHaveBeenCalledTimes(1);
    const conflicts = await db.conflictLog.toArray();
    expect(conflicts).toHaveLength(0);
  });
});
