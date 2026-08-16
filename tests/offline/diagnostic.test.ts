import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type LocalProduct } from "@/lib/offline/db";
import { setOfflineSession } from "@/lib/offline/session";
import { getSnapshot, processQueue } from "@/lib/offline/sync-engine";
import { countPendingSyncItems } from "@/lib/offline/sync-queue";
import { createProduct, updateProduct } from "@/lib/offline/products";
import { createSale } from "@/lib/offline/sales";
import { receiveOrder } from "@/lib/offline/orders";
import type { ProductFormInput } from "@/lib/validations/products";

/**
 * DIAGNOSTIC ONLY — not a regression suite.
 *
 * Written to answer "what actually happens offline?" for each user-facing
 * action, by driving the real Dexie store and the real sync engine with a
 * stand-in server that behaves like the network does: a Server Action
 * invoked with no connectivity rejects with a fetch error, it does not
 * quietly no-op.
 *
 * Every expectation here records OBSERVED behaviour, including the broken
 * ones. Do not "fix" a failing expectation by changing the number — the
 * numbers are the report.
 *
 * All four bugs it originally recorded — ① deliveries duplicated on
 * replay, ② Safari network errors misclassified and writes silently
 * dropped, ③ sales repriced from the catalogue at sync time, ④ the badge
 * claiming "En ligne" over an unreachable database — have since been
 * fixed, and these scenarios now record the corrected behaviour. Their
 * regression coverage lives in tests/orders/receive-order.test.ts,
 * tests/offline/sync-engine.test.ts and tests/pos/create-sale.test.ts.
 *
 * What this file still documents, and what remains true, is which actions
 * have an offline layer at all: products, sales and delivery receipts do;
 * clients, returns, purchase orders, supplier credits and the news feed
 * do not, and throw with no network.
 */

/** Mirrors a Server Action's failure mode when the browser has no network. */
class OfflineFetchError extends TypeError {
  constructor(message = "Failed to fetch") {
    super(message);
  }
}

const server = vi.hoisted(() => ({
  /** Rows the stand-in Postgres holds, so duplication is observable. */
  products: new Map<string, { id: string; name: string; quantityInStock: number; updatedAt: Date }>(),
  sales: [] as Array<{ id: string; clientId?: string; paymentMethod: string }>,
  deliveries: [] as Array<{
    id?: string;
    orderId: string;
    lines: Array<{ orderItemId: string; qty: number }>;
  }>,
  /** Server-side received totals per order line, as receiveOrder maintains them. */
  receivedByLine: new Map<string, number>(),
  orderedByLine: new Map<string, number>(),
  clients: [] as Array<{ id: string; name: string }>,
  orders: [] as Array<{ id: string }>,
  credits: [] as Array<{ id: string; statut: string }>,
  returns: [] as Array<{ saleId: string }>,
  /** Set to override the failure a call rejects with (e.g. a Safari message). */
  failWith: null as string | null,
}));

/** Any server call: unreachable while offline, exactly like a real Server Action. */
function guard() {
  if (server.failWith) throw new OfflineFetchError(server.failWith);
  if (!navigator.onLine) throw new OfflineFetchError();
}

vi.mock("@/lib/server/products", () => ({
  createProduct: vi.fn(async (input: { name: string; quantityInStock: number }, options?: { id?: string }) => {
    guard();
    const row = {
      id: options?.id ?? crypto.randomUUID(),
      name: input.name,
      quantityInStock: Number(input.quantityInStock),
      updatedAt: new Date(),
    };
    server.products.set(row.id, row);
    return { ...makeRemoteProduct(row.id), name: row.name, quantityInStock: row.quantityInStock };
  }),
  updateProduct: vi.fn(async (id: string, input: { name: string; quantityInStock: number }) => {
    guard();
    const row = { id, name: input.name, quantityInStock: Number(input.quantityInStock), updatedAt: new Date() };
    server.products.set(id, row);
    return { ...makeRemoteProduct(id), name: row.name, quantityInStock: row.quantityInStock };
  }),
  getProduct: vi.fn(async (id: string) => {
    guard();
    const row = server.products.get(id);
    return row ? { ...makeRemoteProduct(id), name: row.name, updatedAt: row.updatedAt } : null;
  }),
  listProducts: vi.fn(async () => {
    guard();
    return [];
  }),
}));

vi.mock("@/lib/server/sales", () => ({
  createSale: vi.fn(async (input: { clientId?: string; paymentMethod: string }, options?: { id?: string }) => {
    guard();
    const id = options?.id ?? crypto.randomUUID();
    if (server.sales.some((sale) => sale.id === id)) {
      // Postgres would reject the duplicate primary key.
      throw new Error("Unique constraint failed on the fields: (`id`)");
    }
    server.sales.push({ id, clientId: input.clientId, paymentMethod: input.paymentMethod });
    return { id, priceDrifts: [] };
  }),
}));

vi.mock("@/lib/server/orders", () => ({
  receiveOrder: vi.fn(async (
    orderId: string,
    input: { lines: Array<{ orderItemId: string; receivedQuantity: number }> },
    options?: { id?: string },
  ) => {
    guard();
    // Reproduces lib/server/orders.ts, idempotency check included: a
    // delivery whose id is already on file has been applied, so a replay
    // changes nothing.
    if (options?.id && server.deliveries.some((d) => d.id === options.id)) {
      return { id: orderId };
    }
    // Each line is clamped to what is still outstanding.
    const lines: Array<{ orderItemId: string; qty: number }> = [];
    for (const line of input.lines) {
      const ordered = server.orderedByLine.get(line.orderItemId) ?? 0;
      const already = server.receivedByLine.get(line.orderItemId) ?? 0;
      const toReceive = Math.max(0, Math.min(line.receivedQuantity, ordered - already));
      if (toReceive > 0) {
        server.receivedByLine.set(line.orderItemId, already + toReceive);
        lines.push({ orderItemId: line.orderItemId, qty: toReceive });
      }
    }
    server.deliveries.push({ id: options?.id, orderId, lines });
    return { id: orderId };
  }),
  createOrder: vi.fn(async () => {
    guard();
    const order = { id: crypto.randomUUID() };
    server.orders.push(order);
    return order;
  }),
}));

vi.mock("@/lib/server/clients", () => ({
  addClient: vi.fn(async (input: { name: string }) => {
    guard();
    const client = { id: crypto.randomUUID(), name: input.name };
    server.clients.push(client);
    return client;
  }),
  listClients: vi.fn(async () => {
    guard();
    return server.clients;
  }),
}));

vi.mock("@/lib/server/sales-returns", () => ({
  createSaleReturn: vi.fn(async (saleId: string) => {
    guard();
    server.returns.push({ saleId });
    return { returnId: crypto.randomUUID(), totalRefund: 0 };
  }),
}));

vi.mock("@/lib/server/supplier-credits", () => ({
  createSupplierCredit: vi.fn(async () => {
    guard();
    const credit = { id: crypto.randomUUID(), statut: "EMIS" };
    server.credits.push(credit);
    return credit;
  }),
  settleSupplierCredit: vi.fn(async (id: string) => {
    guard();
    const credit = server.credits.find((c) => c.id === id);
    if (credit) credit.statut = "RECU";
    return credit;
  }),
}));

vi.mock("@/lib/server/publications", () => ({
  listPublications: vi.fn(async () => {
    guard();
    return [{ id: "pub-1", title: "Nouvelle réglementation" }];
  }),
}));

function makeRemoteProduct(id: string) {
  const now = new Date();
  return {
    id,
    pharmacyId: "pharmacy-1",
    name: "Produit",
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
    quantityInStock: 0,
    nearestExpiryDate: null,
    remboursable: false,
    baseRemboursement: null,
    posologieEnfant: null,
    posologieAdulte: null,
    monographie: null,
    createdAt: now,
    updatedAt: now,
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

function seedProduct(overrides: Partial<LocalProduct> = {}): LocalProduct {
  return { ...makeRemoteProduct("p1"), syncStatus: "synced", quantityInStock: 5, ...overrides } as LocalProduct;
}

const productInput: ProductFormInput = {
  name: "Paracétamol 1g",
  form: "Comprimé",
  dosage: "",
  laboratory: "",
  barcode: "",
  dci: "",
  photoUrl: "",
  category: "",
  price: "12.5",
  pph: "",
  tvaVente: "",
  tvaAchat: "",
  lowStockThreshold: "5",
  quantityInStock: "20",
  nearestExpiryDate: "",
  remboursable: false,
  baseRemboursement: "",
  posologieEnfant: "",
  posologieAdulte: "",
  monographie: "",
};

beforeEach(async () => {
  vi.clearAllMocks();
  server.products.clear();
  server.sales = [];
  server.deliveries = [];
  server.receivedByLine.clear();
  server.orderedByLine.clear();
  server.clients = [];
  server.orders = [];
  server.credits = [];
  server.returns = [];
  server.failWith = null;
  setOfflineSession("pharmacy-1", "user-1");
  setOnline(true);
  const db = getDb();
  await db.products.clear();
  await db.syncQueue.clear();
  await db.conflictLog.clear();
});

describe("1-2. products — the only entity with a local table", () => {
  it("creates offline, stores in Dexie, syncs on reconnect without duplicating", async () => {
    setOnline(false);
    const created = await createProduct(productInput);

    expect(await getDb().products.get(created.id)).toBeTruthy();
    expect(await countPendingSyncItems()).toBe(1);

    setOnline(true);
    await processQueue();

    expect(await countPendingSyncItems()).toBe(0);
    // The client-generated id survives the round trip, so replaying the
    // queue cannot insert the same product twice.
    expect(server.products.size).toBe(1);
    expect([...server.products.keys()][0]).toBe(created.id);
  });

  it("edits offline and syncs on reconnect", async () => {
    await getDb().products.put(seedProduct());
    setOnline(false);
    await updateProduct("p1", { ...productInput, quantityInStock: "42" });

    expect((await getDb().products.get("p1"))!.quantityInStock).toBe(42);
    expect(await countPendingSyncItems()).toBe(1);

    setOnline(true);
    await processQueue();
    expect(await countPendingSyncItems()).toBe(0);
    expect(server.products.get("p1")!.quantityInStock).toBe(42);
  });
});

describe("3. POS sale", () => {
  it("completes offline without a client and syncs once", async () => {
    await getDb().products.put(seedProduct({ quantityInStock: 5 }));
    setOnline(false);

    const receipt = await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 2 }] });

    expect(receipt.totalAmount).toBe(20);
    expect((await getDb().products.get("p1"))!.quantityInStock).toBe(3);

    setOnline(true);
    await processQueue();
    expect(server.sales).toHaveLength(1);
    expect(await countPendingSyncItems()).toBe(0);
  });

  it("completes offline WITH a client id, but the id must already be known", async () => {
    await getDb().products.put(seedProduct({ quantityInStock: 5 }));
    setOnline(false);

    await createSale({
      paymentMethod: "CASH",
      clientId: "client-known",
      items: [{ productId: "p1", quantity: 1 }],
    });

    setOnline(true);
    await processQueue();
    expect(server.sales[0]!.clientId).toBe("client-known");
  });
});

describe("4-5-7-9-10. actions with no offline layer at all", () => {
  it("a sale return throws offline and queues nothing", async () => {
    const { createSaleReturn } = await import("@/lib/server/sales-returns");
    setOnline(false);

    await expect(
      createSaleReturn("sale-1", { lines: [], isLotRecall: false }),
    ).rejects.toThrow("Failed to fetch");
    expect(await countPendingSyncItems()).toBe(0);
    expect(server.returns).toHaveLength(0);
  });

  it("adding a client throws offline and queues nothing", async () => {
    const { addClient } = await import("@/lib/server/clients");
    setOnline(false);

    await expect(addClient({ name: "Nouveau client" })).rejects.toThrow("Failed to fetch");
    expect(await countPendingSyncItems()).toBe(0);
  });

  it("creating a purchase order throws offline and queues nothing", async () => {
    const { createOrder } = await import("@/lib/server/orders");
    setOnline(false);

    await expect(createOrder({ supplierId: "s1", items: [] })).rejects.toThrow("Failed to fetch");
    expect(await countPendingSyncItems()).toBe(0);
  });

  it("issuing and settling a supplier credit both throw offline", async () => {
    const { createSupplierCredit, settleSupplierCredit } = await import("@/lib/server/supplier-credits");
    setOnline(false);

    await expect(
      createSupplierCredit({ supplierId: "s1", motif: "autre", lines: [] }),
    ).rejects.toThrow("Failed to fetch");
    await expect(settleSupplierCredit("credit-1", "especes")).rejects.toThrow("Failed to fetch");
    expect(await countPendingSyncItems()).toBe(0);
  });

  it("the actualités feed throws offline — nothing is cached locally", async () => {
    const { listPublications } = await import("@/lib/server/publications");
    setOnline(false);

    await expect(listPublications()).rejects.toThrow("Failed to fetch");
  });
});

describe("6. credit sale — accepted offline with no balance check", () => {
  it("queues a CREDIT sale offline although the client's balance is unknown locally", async () => {
    await getDb().products.put(seedProduct({ quantityInStock: 5, price: 10 }));
    setOnline(false);

    // No clients table exists in Dexie, so nothing here can consult the
    // account being charged: the sale is taken on trust and reconciled later.
    await createSale({
      paymentMethod: "CREDIT",
      clientId: "client-1",
      items: [{ productId: "p1", quantity: 3 }],
    });

    expect(await countPendingSyncItems()).toBe(1);

    setOnline(true);
    await processQueue();
    expect(server.sales[0]!.paymentMethod).toBe("CREDIT");
  });
});

describe("8. receiving a delivery", () => {
  it("bumps local stock offline and syncs", async () => {
    server.orderedByLine.set("item-1", 10);
    await getDb().products.put(seedProduct({ quantityInStock: 0 }));
    setOnline(false);

    await receiveOrder(
      "order-1",
      { lines: [{ orderItemId: "item-1", receivedQuantity: 10 }] },
      { lines: [{ orderItemId: "item-1", productId: "p1" }] },
    );

    expect((await getDb().products.get("p1"))!.quantityInStock).toBe(10);

    setOnline(true);
    await processQueue();
    expect(server.deliveries).toHaveLength(1);
    expect(server.receivedByLine.get("item-1")).toBe(10);
  });

  it("receives a partial delivery ONCE when the reply is lost and the queue retries", async () => {
    server.orderedByLine.set("item-1", 10);
    await getDb().products.put(seedProduct({ quantityInStock: 0 }));
    setOnline(false);

    // A partial shipment: 5 of the 10 ordered.
    await receiveOrder(
      "order-1",
      { lines: [{ orderItemId: "item-1", receivedQuantity: 5 }] },
      { lines: [{ orderItemId: "item-1", productId: "p1" }] },
    );

    setOnline(true);
    // First attempt commits server-side, then the reply is lost — which
    // the engine sees as a connectivity error and retries forever.
    const orders = await import("@/lib/server/orders");
    const mocked = vi.mocked(orders.receiveOrder);
    const commit = mocked.getMockImplementation()!;
    mocked.mockImplementationOnce(async (orderId, input, options) => {
      // Commits, then loses the reply — the classic at-least-once window.
      // Every argument is forwarded, the delivery id included: dropping it
      // here would fake the very bug this scenario is meant to measure.
      await commit(orderId, input, options);
      throw new OfflineFetchError();
    });

    await processQueue();
    await processQueue();

    // Was the diagnostic's bug ①: with no idempotency key the retry was a
    // second, independent reception, turning 5 units into 10 and letting
    // the order close on goods that never arrived. The client-generated
    // delivery id now makes the replay a no-op.
    expect(server.receivedByLine.get("item-1")).toBe(5);
    expect(server.deliveries).toHaveLength(1);
  });
});

describe("12. the online / offline badge", () => {
  it("reports offline while the device has no network", async () => {
    setOnline(false);
    await processQueue();
    expect(getSnapshot().status).not.toBe("syncing");
  });

  it("reports offline when the queue is empty and the database is unreachable", async () => {
    setOnline(true);
    // Device has a network interface, but nothing answers — the case the
    // badge is supposed to catch.
    server.failWith = "Can't reach database server";

    await processQueue();

    // Was the diagnostic's bug ④: the only server call in an empty-queue
    // pass is the product refresh, and its failure was swallowed whole, so
    // the badge announced "En ligne" over an unreachable database.
    expect(getSnapshot().status).toBe("offline");
  });
});

describe("error classification — which failures are retried", () => {
  it("keeps a write pending forever on a Chrome/Firefox network error", async () => {
    await getDb().products.put(seedProduct());
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });

    setOnline(true);
    server.failWith = "Failed to fetch";
    for (let pass = 0; pass < 8; pass += 1) await processQueue();

    expect(await countPendingSyncItems()).toBe(1);
  });

  it("keeps the write pending when Safari phrases it \"Load failed\"", async () => {
    await getDb().products.put(seedProduct());
    setOnline(false);
    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1 }] });

    setOnline(true);
    // Was the diagnostic's bug ②: Safari's wording matched none of the
    // connectivity patterns, so the failure was filed as unknown, the
    // attempt counter advanced, and after five passes the sale left the
    // queue and the pending badge — gone, with nothing to say so.
    server.failWith = "Load failed";
    for (let pass = 0; pass < 8; pass += 1) await processQueue();

    expect(await countPendingSyncItems()).toBe(1);
    expect(server.sales).toHaveLength(0);
  });
});
