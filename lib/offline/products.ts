/**
 * Offline-first read/write layer for products, backed by Dexie
 * (IndexedDB). This is what stock and POS components actually call —
 * never lib/server/products.ts directly.
 *
 * Writes land in the local `products` table immediately (so the UI
 * updates instantly, online or not) and a matching entry is pushed onto
 * the sync queue; the sync engine (lib/offline/sync-engine.ts) applies
 * it against Postgres once the browser is online, resolving any
 * last-write-wins conflict along the way. Reads always come from the
 * local cache, which the sync engine keeps refreshed from the server
 * whenever it's reachable.
 */

import { getDb, type ProductRecord } from "@/lib/offline/db";
import * as remoteProducts from "@/lib/server/products";
import { getOfflinePharmacyId } from "@/lib/offline/session";
import { enqueue } from "@/lib/offline/sync-queue";
import { processQueue } from "@/lib/offline/sync-engine";
import { productFormSchema, type ProductFormInput } from "@/lib/validations/products";

export type { ProductRecord } from "@/lib/offline/db";

export type ListProductsParams = {
  /** Matches against name, barcode and DCI (case-insensitive). */
  search?: string;
  /**
   * N'inclut que les produits que l'officine n'a pas désactivés.
   *
   * Par défaut la liste est complète : le stock, l'inventaire et la
   * resynchronisation doivent voir les produits désactivés — ils existent
   * toujours physiquement. Ce sont les écrans qui *proposent* un produit
   * — comptoir, commande fournisseur — qui demandent le filtre.
   */
  actifsSeulement?: boolean;
};

function toProductRecord(local: ProductRecord): ProductRecord {
  const {
    id,
    pharmacyId,
    name,
    form,
    dosage,
    laboratory,
    barcode,
    dci,
    photoUrl,
    category,
    categorie,
    sousCategorie,
    actifLocalement,
    price,
    pph,
    tvaVente,
    tvaAchat,
    lowStockThreshold,
    quantityInStock,
    nearestExpiryDate,
    remboursable,
    baseRemboursement,
    posologieEnfant,
    posologieAdulte,
    monographie,
    createdAt,
    updatedAt,
  } = local;
  return {
    id,
    pharmacyId,
    name,
    form,
    dosage,
    laboratory,
    barcode,
    dci,
    photoUrl,
    category,
    // Les lignes mises en cache avant l'ajout de ces deux champs ne les
    // portent pas : `undefined` sortirait d'IndexedDB sans que le type le
    // dise. On normalise ici, au seul point de lecture.
    categorie: categorie ?? null,
    sousCategorie: sousCategorie ?? null,
    // Défaut sûr : une ligne mise en cache avant l'ajout du champ est
    // active. L'inverse effacerait tout le stock du comptoir hors ligne.
    actifLocalement: actifLocalement ?? true,
    price,
    pph,
    tvaVente,
    tvaAchat,
    lowStockThreshold,
    quantityInStock,
    nearestExpiryDate,
    remboursable,
    baseRemboursement,
    posologieEnfant,
    posologieAdulte,
    monographie,
    createdAt,
    updatedAt,
  };
}

export async function listProducts(params: ListProductsParams = {}): Promise<ProductRecord[]> {
  const pharmacyId = getOfflinePharmacyId();
  const search = params.search?.trim().toLowerCase();

  const stock = await getDb().products.where("pharmacyId").equals(pharmacyId).toArray();
  const all = params.actifsSeulement
    ? stock.filter((product) => product.actifLocalement !== false)
    : stock;
  const filtered = search
    ? all.filter(
        (product) =>
          product.name.toLowerCase().includes(search) ||
          (product.barcode ?? "").toLowerCase().includes(search) ||
          (product.dci ?? "").toLowerCase().includes(search),
      )
    : all;

  return filtered.sort((a, b) => a.name.localeCompare(b.name)).map(toProductRecord);
}

export async function getProduct(id: string): Promise<ProductRecord | null> {
  const product = await getDb().products.get(id);
  return product ? toProductRecord(product) : null;
}

function fieldsFromInput(data: ReturnType<typeof productFormSchema.parse>) {
  return {
    name: data.name,
    form: data.form,
    dosage: data.dosage,
    laboratory: data.laboratory,
    barcode: data.barcode,
    dci: data.dci,
    photoUrl: data.photoUrl,
    category: data.category,
    price: data.price,
    pph: data.pph ?? null,
    tvaVente: data.tvaVente ?? null,
    tvaAchat: data.tvaAchat ?? null,
    lowStockThreshold: data.lowStockThreshold,
    quantityInStock: data.quantityInStock,
    nearestExpiryDate: data.nearestExpiryDate ? new Date(data.nearestExpiryDate) : null,
    remboursable: data.remboursable,
    baseRemboursement: data.remboursable ? (data.baseRemboursement ?? null) : null,
    posologieEnfant: data.posologieEnfant,
    posologieAdulte: data.posologieAdulte,
    monographie: data.monographie,
  };
}

/**
 * Reflète dans le cache local une désactivation **déjà confirmée par le
 * serveur**, pour que la liste du stock et le comptoir en tiennent compte
 * sans attendre la prochaine synchro descendante.
 *
 * Ne passe pas par la file de synchronisation et ne touche pas au
 * `syncStatus` : il n'y a rien à pousser, le serveur a déjà écrit. Cette
 * bascule demande donc le réseau — c'est un acte d'administration, pas un
 * geste de comptoir, et la refuser hors ligne vaut mieux que de la mettre
 * en file sans savoir ce que le serveur en fera.
 */
export async function markProductActifLocalement(id: string, actif: boolean): Promise<void> {
  const existing = await getDb().products.get(id);
  if (!existing) return;
  await getDb().products.put({ ...existing, actifLocalement: actif });
}

export async function createProduct(input: ProductFormInput): Promise<ProductRecord> {
  const data = productFormSchema.parse(input);
  const pharmacyId = getOfflinePharmacyId();
  const id = crypto.randomUUID();
  const now = new Date();

  const local = {
    id,
    pharmacyId,
    ...fieldsFromInput(data),
    // Un produit saisi à la main n'est rattaché à aucune fiche catalogue.
    // Volontairement hors de `fieldsFromInput`, que `updateProduct`
    // réutilise : les y mettre effacerait la famille d'un produit issu du
    // catalogue à la première modification manuelle.
    categorie: null,
    sousCategorie: null,
    actifLocalement: true,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending" as const,
  };
  await getDb().products.put(local);

  await enqueue({
    type: "createProduct",
    entityId: id,
    payload: { id, input },
    clientTimestamp: now,
  });
  void processQueue();

  return toProductRecord(local);
}

export async function updateProduct(id: string, input: ProductFormInput): Promise<ProductRecord> {
  const data = productFormSchema.parse(input);
  const existing = await getDb().products.get(id);
  if (!existing) {
    throw new Error("Produit introuvable localement.");
  }
  const now = new Date();

  const updated = {
    ...existing,
    ...fieldsFromInput(data),
    updatedAt: now,
    syncStatus: "pending" as const,
  };
  await getDb().products.put(updated);

  await enqueue({
    type: "updateProduct",
    entityId: id,
    payload: { id, input, clientTimestamp: now.toISOString() },
    clientTimestamp: now,
  });
  void processQueue();

  return toProductRecord(updated);
}

/**
 * Rebuilds the form payload the server expects from a cached product, so a
 * product that only ever existed on this device can be pushed up.
 *
 * `purchasePrice` is absent on purpose: the local cache has never carried
 * it, and inventing one would be worse than leaving the margin blank.
 */
function toFormInput(product: ProductRecord): ProductFormInput {
  return {
    name: product.name,
    form: product.form,
    dosage: product.dosage ?? "",
    laboratory: product.laboratory ?? "",
    barcode: product.barcode ?? "",
    dci: product.dci ?? "",
    photoUrl: product.photoUrl ?? "",
    category: (product.category ?? "") as ProductFormInput["category"],
    price: product.price,
    pph: product.pph ?? "",
    tvaVente: product.tvaVente ?? "",
    tvaAchat: product.tvaAchat ?? "",
    quantityInStock: product.quantityInStock,
    lowStockThreshold: product.lowStockThreshold,
    nearestExpiryDate: product.nearestExpiryDate
      ? new Date(product.nearestExpiryDate).toISOString().slice(0, 10)
      : "",
    remboursable: product.remboursable,
    baseRemboursement: product.baseRemboursement ?? "",
    posologieEnfant: product.posologieEnfant ?? "",
    posologieAdulte: product.posologieAdulte ?? "",
    monographie: product.monographie ?? "",
  };
}

/**
 * Products this device holds that the server has never received.
 *
 * They exist because a `createProduct` write was queued and then lost —
 * abandoned by the old silent-drop bug, or discarded by hand from the sync
 * panel. Nothing else reconciles in this direction: the sync engine only
 * ever pulls the server's products down, so without this they stay local
 * for ever, and every module that references them (an inventory session,
 * for instance) breaks on a foreign key the moment it reaches the server.
 *
 * Requires connectivity — it has to ask the server what it actually has.
 */
export type LocalOnlyProducts = {
  /** Neither the id nor the barcode exists upstream — safe to send. */
  pushable: ProductRecord[];
  /**
   * The server already has this product under a different id, matched on
   * barcode. Sending it would break the `(pharmacy_id, barcode)` unique
   * index, so it is surfaced for a decision instead.
   */
  duplicates: Array<{ product: ProductRecord; remoteId: string; remoteName: string }>;
};

export async function findProductsMissingFromServer(): Promise<LocalOnlyProducts> {
  const pharmacyId = getOfflinePharmacyId();
  const remote = await remoteProducts.listProducts();
  const remoteIds = new Set(remote.map((product) => product.id));
  /**
   * Barcodes are unique per pharmacy, so a local product carrying one the
   * server already knows is the same product under another id — typically
   * created offline, its sync lost, then created again from another device.
   * Matching on id alone made the upload fail with P2002.
   *
   * Null barcodes are not indexed: Postgres allows any number of them, and
   * they say nothing about identity.
   */
  const remoteByBarcode = new Map(
    remote
      .filter((product) => product.barcode)
      .map((product) => [product.barcode as string, product]),
  );

  const local = await getDb().products.where("pharmacyId").equals(pharmacyId).toArray();
  const result: LocalOnlyProducts = { pushable: [], duplicates: [] };

  for (const row of local) {
    if (remoteIds.has(row.id)) continue;
    const product = toProductRecord(row);
    const twin = product.barcode ? remoteByBarcode.get(product.barcode) : undefined;
    if (twin) {
      result.duplicates.push({ product, remoteId: twin.id, remoteName: twin.name });
    } else {
      result.pushable.push(product);
    }
  }

  return result;
}

/**
 * Queues the missing products for upload, keeping their local ids so every
 * row that already points at them — inventory counts, sale lines — still
 * matches once they land.
 *
 * Nothing in this app deletes a product, so "absent from the server" can
 * only mean "never arrived"; there is no risk of resurrecting something
 * deliberately removed.
 */
export async function resyncProductsMissingFromServer(): Promise<{
  queued: number;
  alreadyQueued: number;
}> {
  const { pushable } = await findProductsMissingFromServer();
  if (pushable.length === 0) return { queued: 0, alreadyQueued: 0 };

  const db = getDb();
  const inFlight = new Set(
    (await db.syncQueue.where("status").anyOf(["pending", "syncing", "failed"]).toArray())
      .filter((item) => item.type === "createProduct")
      .map((item) => item.entityId),
  );

  let queued = 0;
  let alreadyQueued = 0;
  for (const product of pushable) {
    if (inFlight.has(product.id)) {
      alreadyQueued += 1;
      continue;
    }
    await enqueue({
      type: "createProduct",
      entityId: product.id,
      // Same id as the local row: that is what makes the upload idempotent
      // and keeps existing local references valid.
      payload: { id: product.id, input: toFormInput(product) },
      clientTimestamp: new Date(),
    });
    queued += 1;
  }

  void processQueue();
  return { queued, alreadyQueued };
}
