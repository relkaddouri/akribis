import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type LocalProduct } from "@/lib/offline/db";
import { setOfflineSession } from "@/lib/offline/session";
import { processQueue, getSnapshot, syncStatusLabel } from "@/lib/offline/sync-engine";
import {
  countPendingSyncItems,
  discardStalledSyncItems,
  enqueue,
  listOutstandingSyncItems,
  listPendingSyncItems,
  MAX_SYNC_ATTEMPTS,
} from "@/lib/offline/sync-queue";
import { createSale } from "@/lib/offline/sales";
import { clearConflicts } from "@/lib/offline/conflict-log";
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
  // Several tests move the clock to step over a retry backoff; without
  // this they would inherit the previous test's fake "now".
  vi.useRealTimers();
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
      priceDrifts: [],
    });

    await processQueue();

    expect(remote.createSale).toHaveBeenCalledTimes(1);
    expect(remote.createSale).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: "CARD",
        // The price travels with the line. Sending quantity alone let the
        // server reprice the sale from the catalogue at sync time.
        items: [{ productId: "p1", quantity: 2, unitPrice: 10 }],
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
      priceDrifts: [],
    });

    // An error the engine can't interpret now waits out a backoff before
    // being tried again, so the clock has to move for the retry to be due.
    vi.setSystemTime(new Date(Date.now() + 60_000));
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
    // A status of its own, rather than a maxed-out attempt counter. The old
    // encoding made a refusal indistinguishable from a write that had
    // merely failed too often — and the engine gave up on both.
    expect(queued.status).toBe("rejected");

    const conflicts = await db.conflictLog.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe("sync_rejected");
    expect(conflicts[0].entityType).toBe("sale");

    // Resolved — must not linger in the "en attente" badge count forever.
    expect(await countPendingSyncItems()).toBe(0);

    // A later processQueue() call must not keep hammering the server for
    // this one, however much time passes.
    vi.setSystemTime(new Date(Date.now() + 60 * 60_000));
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
      priceDrifts: [],
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

describe("a network failure the message pattern doesn't recognise", () => {
  /**
   * Diagnostic bug ②. Safari phrases a failed fetch "Load failed", which
   * matched none of the connectivity patterns, so the failure was filed as
   * "unknown", the attempt counter advanced, and after five passes the sale
   * dropped out of the queue and off the pending badge — gone, with nothing
   * anywhere to say so.
   */
  async function queueOneSale() {
    await getDb().products.put(seedProduct({ quantityInStock: 5 }));
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });
    setOnline(true);
  }

  it.each([
    ["Load failed"],
    ["The network connection was lost."],
    ["The Internet connection appears to be offline."],
    ["NetworkError when attempting to fetch resource."],
    ["Network request failed"],
  ])("keeps the sale queued through repeated %s", async (message) => {
    await queueOneSale();
    // A plain Error, deliberately: this exercises the wording list. A
    // TypeError would be caught by the type check alone and would prove
    // nothing about the patterns.
    remote.createSale.mockRejectedValue(new Error(message));

    for (let pass = 0; pass < 10; pass += 1) await processQueue();

    const [queued] = await getDb().syncQueue.toArray();
    expect(queued.status).toBe("failed");
    // Read as connectivity, so the counter never advances and the write is
    // never a candidate for abandonment.
    expect(queued.attempts).toBe(0);
    expect(await countPendingSyncItems()).toBe(1);
  });

  it("recognises a failed fetch by its type, whatever the browser calls it", async () => {
    await queueOneSale();
    // The wording no engine has invented yet. Every engine still rejects a
    // fetch that never completed with a TypeError, which is why the type is
    // checked before the wording.
    remote.createSale.mockRejectedValue(new TypeError("Une formulation inédite"));

    for (let pass = 0; pass < 10; pass += 1) await processQueue();

    const [queued] = await getDb().syncQueue.toArray();
    expect(queued.attempts).toBe(0);
    expect(await countPendingSyncItems()).toBe(1);
  });

  it("delivers the sale once the connection returns", async () => {
    await queueOneSale();
    remote.createSale.mockRejectedValue(new Error("Load failed"));
    for (let pass = 0; pass < 10; pass += 1) await processQueue();

    remote.createSale.mockResolvedValueOnce({
      id: "sale-1",
      createdAt: new Date(),
      paymentMethod: "CASH",
      totalAmount: 10,
      clientName: null,
      items: [],
      priceDrifts: [],
    });
    await processQueue();

    const [item] = await getDb().syncQueue.toArray();
    expect(item.status).toBe("synced");
    expect(await countPendingSyncItems()).toBe(0);
  });
});

describe("the safety net: nothing is ever dropped silently", () => {
  async function queueOneSale() {
    await getDb().products.put(seedProduct({ quantityInStock: 5 }));
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });
    setOnline(true);
  }

  it("keeps an unrecognised error in the queue past the old cut-off, and flags it", async () => {
    await queueOneSale();
    // Deliberately nothing like a network error and nothing like a business
    // rejection — the class the engine cannot interpret.
    remote.createSale.mockRejectedValue(new Error("Une erreur totalement inattendue"));

    for (let pass = 0; pass < 30; pass += 1) {
      vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
      await processQueue();
    }

    const [queued] = await getDb().syncQueue.toArray();
    expect(queued.status).toBe("failed");
    // It gave up counting, but it did not give up: still queued, still
    // counted, and now reported as needing a human.
    expect(queued.attempts).toBeGreaterThanOrEqual(MAX_SYNC_ATTEMPTS);
    expect(await countPendingSyncItems()).toBe(1);
    expect(getSnapshot().stalledCount).toBe(1);
  });

  it("spaces retries out instead of hammering the server every pass", async () => {
    await queueOneSale();
    remote.createSale.mockRejectedValue(new Error("Une erreur totalement inattendue"));

    await processQueue();
    expect(remote.createSale).toHaveBeenCalledTimes(1);

    // Immediately after a failure the item is not due yet.
    await processQueue();
    await processQueue();
    expect(remote.createSale).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
    await processQueue();
    expect(remote.createSale).toHaveBeenCalledTimes(2);
  });

  it("still parks a business rejection instead of retrying it forever", async () => {
    await queueOneSale();
    remote.createSale.mockRejectedValue(new Error('Stock insuffisant pour "Doliprane 500mg" (0 disponible(s)).'));

    for (let pass = 0; pass < 10; pass += 1) {
      vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
      await processQueue();
    }

    // The server refused on the merits; retrying changes nothing. It leaves
    // the pending count — but only because it is recorded in the conflict
    // log, which is where the pharmacist can still find it.
    expect(remote.createSale).toHaveBeenCalledTimes(1);
    expect(await countPendingSyncItems()).toBe(0);
    expect(getSnapshot().stalledCount).toBe(0);
    expect(await getDb().conflictLog.count()).toBe(1);
  });
});

describe("the price on the ticket is the price that counts", () => {
  /**
   * Diagnostic bug ③, from the till's side. The queued payload carried
   * only {productId, quantity}, so the server priced the line from the
   * catalogue whenever the sale happened to reach it — and the customer's
   * ticket and the accounts stopped agreeing.
   */
  it("queues the price the ticket was printed with, not the price at sync time", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5, price: 10 }));

    setOnline(false);
    const receipt = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 2 }],
    });
    expect(receipt.totalAmount).toBe(20);

    // The shelf price rises while the sale is still waiting in the queue —
    // a stock edit, or a refresh from the server.
    await db.products.update("p1", { price: 15 });

    setOnline(true);
    remote.createSale.mockResolvedValue({
      id: receipt.id,
      createdAt: new Date(),
      paymentMethod: "CASH",
      totalAmount: 20,
      clientName: null,
      items: [],
      priceDrifts: [],
    });
    await processQueue();

    const [, options] = remote.createSale.mock.calls[0]!;
    const [sent] = remote.createSale.mock.calls[0]!;
    expect(options).toEqual({ id: receipt.id });
    // 10, the figure the customer walked out with.
    expect(sent.items).toEqual([{ productId: "p1", quantity: 2, unitPrice: 10 }]);
  });

  it("notes a catalogue gap without touching the amount", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5, price: 10 }));

    setOnline(false);
    const receipt = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 2 }],
    });

    setOnline(true);
    remote.createSale.mockResolvedValue({
      id: receipt.id,
      createdAt: new Date(),
      paymentMethod: "CASH",
      totalAmount: 20,
      clientName: null,
      items: [],
      priceDrifts: [
        { productId: "p1", productName: "Doliprane 500mg", chargedPrice: 10, catalogPrice: 15 },
      ],
    });
    await processQueue();

    const [queued] = await db.syncQueue.toArray();
    // Synced, not in conflict: nothing failed and nothing was rejected.
    expect(queued.status).toBe("synced");

    const [logged] = await db.conflictLog.toArray();
    expect(logged.resolution).toBe("price_drift");
    expect(logged.entityType).toBe("sale");
    expect(logged.detail).toContain("10.00");
    expect(logged.detail).toContain("15.00");
  });

  it("logs nothing when the price never moved", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5, price: 10 }));

    setOnline(false);
    const receipt = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 1 }],
    });

    setOnline(true);
    remote.createSale.mockResolvedValue({
      id: receipt.id,
      createdAt: new Date(),
      paymentMethod: "CASH",
      totalAmount: 10,
      clientName: null,
      items: [],
      priceDrifts: [],
    });
    await processQueue();

    expect(await db.conflictLog.count()).toBe(0);
  });
});

describe("the badge with an empty queue", () => {
  /**
   * Diagnostic bug ④. With nothing queued, the only server call in a pass
   * is the product refresh, and its failure was swallowed whole. So a
   * pharmacy whose database was unreachable — but which happened to have
   * synced everything — was told it was online, right up until the next
   * sale failed.
   *
   * `navigator.onLine` cannot catch this on its own: it only reports
   * whether the device has a network interface, and it stays true through
   * a router that routes nowhere or a Supabase outage.
   */
  it("reports offline when the database is unreachable and nothing is queued", async () => {
    expect(await countPendingSyncItems()).toBe(0);
    setOnline(true);
    remote.listProducts.mockRejectedValue(
      new Error("Can't reach database server at `aws-0-eu-west-1.pooler.supabase.com`"),
    );

    await processQueue();

    expect(getSnapshot().status).toBe("offline");
    expect(syncStatusLabel(getSnapshot().status)).toBe("Hors ligne");
  });

  it("still reports online when the server answers and nothing is queued", async () => {
    expect(await countPendingSyncItems()).toBe(0);
    setOnline(true);
    remote.listProducts.mockResolvedValue([]);

    await processQueue();

    // The inverse mistake would be just as bad: a pharmacy told it is
    // offline stops trusting the badge entirely.
    expect(getSnapshot().status).toBe("online");
    expect(syncStatusLabel(getSnapshot().status)).toBe("En ligne");
  });

  it("comes back online once the database answers again", async () => {
    setOnline(true);
    remote.listProducts.mockRejectedValue(new Error("Can't reach database server"));
    await processQueue();
    expect(getSnapshot().status).toBe("offline");

    remote.listProducts.mockResolvedValue([]);
    await processQueue();

    expect(getSnapshot().status).toBe("online");
  });

  it("does not call the connection down over an error that isn't about the network", async () => {
    setOnline(true);
    // A bug in the refresh itself, not a connectivity problem. Reporting
    // "Hors ligne" here would send someone to check the router over a
    // defect in this code — the refresh stays best-effort and silent.
    remote.listProducts.mockRejectedValue(new Error("Cannot read properties of undefined"));

    await processQueue();

    expect(getSnapshot().status).toBe("online");
  });
});

describe("what the header shows for each state", () => {
  // The badge renders this string directly, so testing the mapping is
  // testing the badge.
  it("names every state in plain French", () => {
    expect(syncStatusLabel("online")).toBe("En ligne");
    expect(syncStatusLabel("offline")).toBe("Hors ligne");
    expect(syncStatusLabel("syncing")).toBe("Synchronisation...");
  });
});

describe("the sync panel tells one story", () => {
  /**
   * Reported from real use: the panel showed "6 écritures bloquées — les
   * tentatives continuent" and, directly beneath, "Aucun élément en
   * attente."
   *
   * The two lines read different queries. `listPendingSyncItems` answers
   * "what is due for another attempt right now" — a scheduling question,
   * time-filtered since retry backoff was introduced. The panel was using
   * it to answer "what is still owed to the server", and an item waiting
   * out its backoff is owed but not due, so it vanished from the list
   * while still being counted above it.
   */
  async function queueFailingSales(count: number) {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 50 }));
    setOnline(false);
    for (let i = 0; i < count; i += 1) {
      await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });
    }
    setOnline(true);
    remote.createSale.mockRejectedValue(new Error("Une erreur totalement inattendue"));
    // Enough passes to push every item past the stalled threshold.
    for (let pass = 0; pass < 10; pass += 1) {
      vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
      await processQueue();
    }
  }

  it("lists every outstanding write, including the ones waiting out a backoff", async () => {
    await queueFailingSales(6);

    // Not due right now — correct, and what the engine needs.
    expect(await listPendingSyncItems()).toHaveLength(0);

    // Still owed — what the panel must show. Six counted, six listed.
    const outstanding = await listOutstandingSyncItems();
    expect(outstanding).toHaveLength(6);
    expect(await countPendingSyncItems()).toBe(6);
    expect(getSnapshot().stalledCount).toBe(6);
  });

  it("never counts an item it would not also list", async () => {
    await queueFailingSales(3);

    // The invariant the panel's two lines broke: anything the badge counts
    // must be somewhere in the list underneath it.
    const outstanding = await listOutstandingSyncItems();
    expect(outstanding).toHaveLength(await countPendingSyncItems());
    expect(outstanding.filter((item) => item.isStalled)).toHaveLength(
      getSnapshot().stalledCount,
    );
  });

  it("marks which of them are merely waiting and which are stuck", async () => {
    await queueFailingSales(2);
    // A fresh write, queued after the others got stuck.
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });
    setOnline(true);

    const outstanding = await listOutstandingSyncItems();
    expect(outstanding).toHaveLength(3);
    expect(outstanding.filter((item) => item.isStalled)).toHaveLength(2);
    expect(outstanding.filter((item) => !item.isStalled)).toHaveLength(1);
  });

  it("says nothing is outstanding only when nothing actually is", async () => {
    expect(await listOutstandingSyncItems()).toHaveLength(0);
    expect(await countPendingSyncItems()).toBe(0);
  });
});

describe("the badge during a total network cut", () => {
  it("reports offline even when every queued write is waiting out a backoff", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 50 }));
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });

    setOnline(true);
    remote.createSale.mockRejectedValue(new Error("Une erreur totalement inattendue"));
    for (let pass = 0; pass < 8; pass += 1) {
      vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
      await processQueue();
    }

    // Now the network goes down entirely, while the item sits in backoff.
    // No queued item is attempted this pass, so the only thing that can
    // reveal the outage is the product refresh.
    remote.createSale.mockRejectedValue(new Error("Failed to fetch"));
    remote.listProducts.mockRejectedValue(new Error("Failed to fetch"));
    await processQueue();

    expect(getSnapshot().status).toBe("offline");
    expect(syncStatusLabel(getSnapshot().status)).toBe("Hors ligne");
  });

  it("reports offline when the device itself has no network", async () => {
    setOnline(false);
    await processQueue();

    expect(getSnapshot().status).toBe("offline");
  });
});

describe("clearing out writes that can never succeed", () => {
  async function stallOne() {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 50 }));
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });
    setOnline(true);
    remote.createSale.mockRejectedValue(new Error("Une erreur totalement inattendue"));
    for (let pass = 0; pass < 10; pass += 1) {
      vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
      await processQueue();
    }
  }

  it("discards a stalled write and returns what was thrown away", async () => {
    await stallOne();
    expect(await countPendingSyncItems()).toBe(1);

    const removed = await discardStalledSyncItems();

    expect(removed).toHaveLength(1);
    // Returned, not just deleted: the caller has to be able to say what it
    // destroyed, or the trace it writes afterwards would be empty.
    expect(removed[0]!.type).toBe("createSale");
    expect(removed[0]!.lastError).toContain("inattendue");
    expect(await countPendingSyncItems()).toBe(0);
  });

  it("refuses to touch a write that is merely waiting its turn", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 50 }));
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });

    const removed = await discardStalledSyncItems();

    // Not stalled — it has every chance of going through on the next pass.
    // Deleting it would be exactly the data loss this queue exists to stop.
    expect(removed).toHaveLength(0);
    expect(await countPendingSyncItems()).toBe(1);
  });

  it("leaves healthy writes alone while removing the stuck one", async () => {
    await stallOne();
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });
    setOnline(true);

    expect(await countPendingSyncItems()).toBe(2);
    await discardStalledSyncItems();

    const left = await listOutstandingSyncItems();
    expect(left).toHaveLength(1);
    expect(left[0]!.isStalled).toBe(false);
  });

  it("empties the conflict log on request and reports how many went", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5 }));
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 5 }] });
    setOnline(true);
    remote.createSale.mockRejectedValue(new Error('Stock insuffisant pour "Doliprane 500mg".'));
    await processQueue();
    expect(await db.conflictLog.count()).toBe(1);

    expect(await clearConflicts()).toBe(1);
    expect(await db.conflictLog.count()).toBe(0);
  });
});

describe("the order writes reach the server", () => {
  /**
   * Found by a flaky inventory test, and a real hazard rather than a test
   * artefact: opening a stock count queues the session and its first counts
   * within the same millisecond, and sorting the queue on `createdAt` alone
   * left those ties in arbitrary order. A count arriving before the session
   * that owns it is refused outright — the count is simply lost.
   */
  it("keeps strict insertion order for writes queued in the same millisecond", async () => {
    const db = getDb();
    const now = new Date("2026-08-15T10:00:00.000Z");
    vi.setSystemTime(now);

    // Twenty of them: Dexie returns rows in primary-key (uuid) order, which
    // bears no relation to insertion order, so with enough items the raw
    // order is essentially certain to differ from the order they were
    // written in. Four would sometimes come back already sorted and prove
    // nothing.
    const expected = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    for (const entityId of expected) {
      await enqueue({ type: "createSale", entityId, payload: {}, clientTimestamp: now });
    }

    const queued = await db.syncQueue.toArray();
    // Same millisecond for every one of them, by construction.
    expect(new Set(queued.map((item) => item.createdAt.getTime())).size).toBe(1);
    // The raw read really is out of order — otherwise this test would pass
    // whatever the sort did.
    expect(queued.map((item) => item.entityId)).not.toEqual(expected);

    const pending = await listPendingSyncItems();
    expect(pending.map((item) => item.entityId)).toEqual(expected);
  });

  it("puts an older write ahead of a newer one regardless of insertion counter", async () => {
    vi.setSystemTime(new Date("2026-08-15T10:00:00.000Z"));
    await enqueue({
      type: "createSale",
      entityId: "older",
      payload: {},
      clientTimestamp: new Date(),
    });

    vi.setSystemTime(new Date("2026-08-15T11:00:00.000Z"));
    await enqueue({
      type: "createProduct",
      entityId: "newer",
      payload: {},
      clientTimestamp: new Date(),
    });

    const pending = await listPendingSyncItems();
    expect(pending.map((item) => item.entityId)).toEqual(["older", "newer"]);
  });
});

describe("a write that collides with a row already on the server", () => {
  it("parks a unique-constraint violation instead of retrying it for ever", async () => {
    const db = getDb();
    await db.products.put(seedProduct({ quantityInStock: 5 }));
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });

    setOnline(true);
    // Seen in real use when pushing up a product whose barcode was already
    // upstream under another id. The row it collides with is not going
    // anywhere, so every retry fails identically.
    remote.createSale.mockRejectedValue(
      new Error("Unique constraint failed on the fields: (`pharmacy_id`, `barcode`)"),
    );

    for (let pass = 0; pass < 6; pass += 1) {
      vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
      await processQueue();
    }

    // Attempted once, then parked and recorded — not hammered, and not
    // left lighting up the badge for days.
    expect(remote.createSale).toHaveBeenCalledTimes(1);
    expect(await countPendingSyncItems()).toBe(0);
    const [logged] = await db.conflictLog.toArray();
    expect(logged.resolution).toBe("sync_rejected");
    expect(logged.detail).toContain("Unique constraint failed");
  });
});
