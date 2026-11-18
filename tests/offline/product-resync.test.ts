import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type LocalProduct } from "@/lib/offline/db";
import { setOfflineSession } from "@/lib/offline/session";
import { productFormSchema } from "@/lib/validations/products";

/**
 * Pushing up products that only ever existed on one device.
 *
 * The sync engine reconciles one way — it pulls the server's products into
 * the cache — so a `createProduct` write that was lost leaves a product
 * that is local for ever. It behaves normally in Stock and at the till,
 * then breaks as soon as another module references it server-side: an
 * inventory session over such a product died on a foreign key and could
 * not open at all.
 */
const remote = vi.hoisted(() => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  getProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

vi.mock("@/lib/server/products", () => remote);

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
    categorie: null,
    sousCategorie: null,
    actifLocalement: true,
    price: 12.5,
    pph: null,
    tvaVente: null,
    tvaAchat: null,
    lowStockThreshold: 5,
    quantityInStock: 40,
    nearestExpiryDate: null,
    remboursable: false,
    baseRemboursement: null,
    posologieEnfant: null,
    posologieAdulte: null,
    monographie: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
    ...overrides,
  };
}

const { findProductsMissingFromServer, resyncProductsMissingFromServer } = await import(
  "@/lib/offline/products"
);

beforeEach(async () => {
  vi.clearAllMocks();
  setOfflineSession("pharmacy-1", "user-1");
  const db = getDb();
  await db.products.clear();
  await db.syncQueue.clear();
});

describe("finding what the server never received", () => {
  it("lists local products the server does not have", async () => {
    await getDb().products.bulkPut([
      seedProduct({ id: "known", name: "Augmentin 1g" }),
      seedProduct({ id: "local-only", name: "Créé hors ligne" }),
    ]);
    remote.listProducts.mockResolvedValue([{ id: "known" }]);

    const { pushable } = await findProductsMissingFromServer();

    expect(pushable.map((product) => product.id)).toEqual(["local-only"]);
  });

  it("finds nothing when the server has everything", async () => {
    await getDb().products.put(seedProduct({ id: "known" }));
    remote.listProducts.mockResolvedValue([{ id: "known" }]);

    const { pushable, duplicates } = await findProductsMissingFromServer();
    expect(pushable).toHaveLength(0);
    expect(duplicates).toHaveLength(0);
  });

  it("ignores another pharmacy's cached rows", async () => {
    await getDb().products.bulkPut([
      seedProduct({ id: "mine" }),
      seedProduct({ id: "theirs", pharmacyId: "pharmacy-2" }),
    ]);
    remote.listProducts.mockResolvedValue([]);

    const { pushable } = await findProductsMissingFromServer();

    expect(pushable.map((product) => product.id)).toEqual(["mine"]);
  });
});

describe("queueing them for upload", () => {
  it("keeps the local id, so existing references still match", async () => {
    await getDb().products.put(seedProduct({ id: "local-only" }));
    remote.listProducts.mockResolvedValue([]);

    const result = await resyncProductsMissingFromServer();

    expect(result).toEqual({ queued: 1, alreadyQueued: 0 });
    const [item] = await getDb().syncQueue.toArray();
    expect(item.type).toBe("createProduct");
    expect(item.entityId).toBe("local-only");
    // The id travels in the payload too — that is what makes the upload
    // idempotent and keeps inventory counts and sale lines pointing at it.
    expect((item.payload as { id: string }).id).toBe("local-only");
  });

  it("builds a payload the server will actually accept", async () => {
    // The whole point of the push. A payload the schema rejects would be
    // queued, refused, and retried for ever without anyone understanding
    // why the product never appears.
    await getDb().products.put(
      seedProduct({
        id: "complet",
        name: "Produit complet",
        dosage: "500mg",
        category: "Antibiotiques",
        price: 42.75,
        pph: 30,
        tvaVente: 20,
        remboursable: true,
        baseRemboursement: 12,
        nearestExpiryDate: new Date("2027-03-31T00:00:00.000Z"),
      }),
    );
    remote.listProducts.mockResolvedValue([]);

    await resyncProductsMissingFromServer();

    const [item] = await getDb().syncQueue.toArray();
    const parsed = productFormSchema.safeParse((item.payload as { input: unknown }).input);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Produit complet");
    expect(parsed.data?.price).toBe(42.75);
    expect(parsed.data?.quantityInStock).toBe(40);
    expect(parsed.data?.category).toBe("Antibiotiques");
    expect(parsed.data?.nearestExpiryDate).toBe("2027-03-31");
  });

  it("accepts a bare product with every optional field empty", async () => {
    await getDb().products.put(seedProduct({ id: "minimal" }));
    remote.listProducts.mockResolvedValue([]);

    await resyncProductsMissingFromServer();

    const [item] = await getDb().syncQueue.toArray();
    const parsed = productFormSchema.safeParse((item.payload as { input: unknown }).input);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.dosage).toBeNull();
    expect(parsed.data?.nearestExpiryDate).toBeNull();
  });

  it("does not queue a product that is already waiting to be sent", async () => {
    await getDb().products.put(seedProduct({ id: "local-only" }));
    remote.listProducts.mockResolvedValue([]);

    await resyncProductsMissingFromServer();
    const second = await resyncProductsMissingFromServer();

    // Queueing it twice would attempt the same insert twice; the second
    // would fail on the primary key and sit in the badge for ever.
    expect(second).toEqual({ queued: 0, alreadyQueued: 1 });
    expect(await getDb().syncQueue.count()).toBe(1);
  });

  it("queues nothing when there is nothing to push", async () => {
    await getDb().products.put(seedProduct({ id: "known" }));
    remote.listProducts.mockResolvedValue([{ id: "known" }]);

    expect(await resyncProductsMissingFromServer()).toEqual({ queued: 0, alreadyQueued: 0 });
    expect(await getDb().syncQueue.count()).toBe(0);
  });

  it("refuses to send a product the server already has under another id", async () => {
    // The failure seen in real use: P2002 on (pharmacy_id, barcode). The
    // product was created offline, its sync lost, then created again from
    // elsewhere — so the barcode is upstream under a different id, and
    // matching on id alone declared it "missing".
    await getDb().products.put(
      seedProduct({ id: "cree-hors-ligne", name: "Doliprane", barcode: "3400930000001" }),
    );
    remote.listProducts.mockResolvedValue([
      { id: "id-serveur", name: "Doliprane 500mg", barcode: "3400930000001" },
    ]);

    const { pushable, duplicates } = await findProductsMissingFromServer();

    expect(pushable).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.remoteId).toBe("id-serveur");
    expect(duplicates[0]!.remoteName).toBe("Doliprane 500mg");

    const result = await resyncProductsMissingFromServer();
    expect(result.queued).toBe(0);
    expect(await getDb().syncQueue.count()).toBe(0);
  });

  it("still sends products with no barcode at all", async () => {
    // Null barcodes are not covered by the unique index — Postgres allows
    // any number of them — so they say nothing about identity.
    await getDb().products.bulkPut([
      seedProduct({ id: "sans-code-1", name: "Préparation A", barcode: null }),
      seedProduct({ id: "sans-code-2", name: "Préparation B", barcode: null }),
    ]);
    remote.listProducts.mockResolvedValue([{ id: "autre", name: "Autre", barcode: null }]);

    const { pushable, duplicates } = await findProductsMissingFromServer();

    expect(pushable.map((product) => product.id).sort()).toEqual(["sans-code-1", "sans-code-2"]);
    expect(duplicates).toHaveLength(0);
  });

  it("sends the safe ones even when another is a duplicate", async () => {
    await getDb().products.bulkPut([
      seedProduct({ id: "nouveau", name: "Vraiment nouveau", barcode: "3400930000002" }),
      seedProduct({ id: "doublon", name: "Doublon", barcode: "3400930000001" }),
    ]);
    remote.listProducts.mockResolvedValue([
      { id: "id-serveur", name: "Doliprane 500mg", barcode: "3400930000001" },
    ]);

    const result = await resyncProductsMissingFromServer();

    // One blocked product must not hold back the others.
    expect(result.queued).toBe(1);
    const [item] = await getDb().syncQueue.toArray();
    expect(item.entityId).toBe("nouveau");
  });
});
