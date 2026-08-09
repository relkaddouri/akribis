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
import { getOfflinePharmacyId } from "@/lib/offline/session";
import { enqueue } from "@/lib/offline/sync-queue";
import { processQueue } from "@/lib/offline/sync-engine";
import { productFormSchema, type ProductFormInput } from "@/lib/validations/products";

export type { ProductRecord } from "@/lib/offline/db";

export type ListProductsParams = {
  /** Matches against name, barcode and DCI (case-insensitive). */
  search?: string;
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

  const all = await getDb().products.where("pharmacyId").equals(pharmacyId).toArray();
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

export async function createProduct(input: ProductFormInput): Promise<ProductRecord> {
  const data = productFormSchema.parse(input);
  const pharmacyId = getOfflinePharmacyId();
  const id = crypto.randomUUID();
  const now = new Date();

  const local = {
    id,
    pharmacyId,
    ...fieldsFromInput(data),
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
