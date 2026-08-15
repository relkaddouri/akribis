/**
 * Offline-first layer for stock counts, backed by Dexie. The inventory
 * screens call this — never lib/server/inventory.ts directly.
 *
 * A count happens in a stockroom, which is exactly where the signal drops,
 * so every step works with no network: opening a session, counting shelf
 * by shelf, reading the variance report, applying the corrections. Each
 * step writes locally first and queues the server call behind it.
 *
 * The expected quantities come from the products already cached in Dexie,
 * not from a fresh server read — that cache is the only product data an
 * offline device has, and it is what the till has been selling from.
 */

import { getDb, type LocalInventoryCount, type LocalInventorySession } from "@/lib/offline/db";
import { getOfflinePharmacyId } from "@/lib/offline/session";
import { enqueue } from "@/lib/offline/sync-queue";
import { processQueue } from "@/lib/offline/sync-engine";
import { buildVarianceReport, adjustmentsFrom, type CountLine, type VarianceReport } from "@/lib/inventory/variance";

export type { LocalInventoryCount, LocalInventorySession } from "@/lib/offline/db";

/**
 * Opens a session over every cached product.
 *
 * The id is generated here, not by the server, so a retry after a lost
 * reply carries the id of the session the first attempt already created.
 */
export async function startInventorySession(): Promise<LocalInventorySession> {
  const pharmacyId = getOfflinePharmacyId();
  const db = getDb();
  const id = crypto.randomUUID();
  const startedAt = new Date();

  const products = await db.products.where("pharmacyId").equals(pharmacyId).toArray();

  const session: LocalInventorySession = {
    id,
    pharmacyId,
    statut: "en_cours",
    dateDebut: startedAt,
    dateFin: null,
    syncStatus: "pending",
  };

  const counts: LocalInventoryCount[] = products.map((product) => ({
    id: crypto.randomUUID(),
    sessionId: id,
    productId: product.id,
    productName: product.name,
    // Frozen here, both of them. Re-reading either at report time would
    // make the discrepancy vanish as the shelves keep moving.
    quantiteTheorique: product.quantityInStock,
    unitPrice: product.price,
    quantiteComptee: null,
    dateComptage: null,
  }));

  await db.transaction("rw", db.inventorySessions, db.inventoryCounts, async () => {
    await db.inventorySessions.put(session);
    await db.inventoryCounts.bulkPut(counts);
  });

  await enqueue({
    type: "startInventory",
    entityId: id,
    payload: {
      id,
      input: {
        startedAt: startedAt.toISOString(),
        lines: counts.map((count) => ({
          productId: count.productId,
          quantiteTheorique: count.quantiteTheorique,
        })),
      },
    },
    clientTimestamp: startedAt,
  });
  void processQueue();

  return session;
}

export async function listLocalSessions(): Promise<LocalInventorySession[]> {
  const pharmacyId = getOfflinePharmacyId();
  const sessions = await getDb().inventorySessions.where("pharmacyId").equals(pharmacyId).toArray();
  return sessions.sort((a, b) => b.dateDebut.getTime() - a.dateDebut.getTime());
}

export async function getLocalSession(id: string): Promise<LocalInventorySession | null> {
  return (await getDb().inventorySessions.get(id)) ?? null;
}

export async function listSessionCounts(sessionId: string): Promise<LocalInventoryCount[]> {
  const counts = await getDb().inventoryCounts.where("sessionId").equals(sessionId).toArray();
  return counts.sort((a, b) => a.productName.localeCompare(b.productName, "fr"));
}

/**
 * Records one shelf's count. Written locally and queued immediately,
 * product by product: an inventory can take an hour, and a tablet that
 * dies halfway must not take the morning's counting with it.
 */
export async function recordCount(
  sessionId: string,
  productId: string,
  quantiteComptee: number,
): Promise<void> {
  const db = getDb();
  const countedAt = new Date();

  const line = await db.inventoryCounts
    .where("[sessionId+productId]")
    .equals([sessionId, productId])
    .first();
  if (!line) {
    throw new Error("Produit absent de cette session d'inventaire.");
  }

  await db.inventoryCounts.update(line.id, { quantiteComptee, dateComptage: countedAt });

  await enqueue({
    type: "recordInventoryCount",
    entityId: line.id,
    payload: {
      input: {
        sessionId,
        productId,
        // Carried so the server can create the line if this product was
        // skipped when the session opened and has synced since.
        quantiteTheorique: line.quantiteTheorique,
        quantiteComptee,
        countedAt: countedAt.toISOString(),
      },
    },
    clientTimestamp: countedAt,
  });
  void processQueue();
}

/** The variance report, computed entirely from what the device already holds. */
export async function buildLocalVarianceReport(sessionId: string): Promise<VarianceReport> {
  const counts = await listSessionCounts(sessionId);
  const lines: CountLine[] = counts.map((count) => ({
    productId: count.productId,
    productName: count.productName,
    quantiteTheorique: count.quantiteTheorique,
    quantiteComptee: count.quantiteComptee,
    unitPrice: count.unitPrice,
  }));
  return buildVarianceReport(lines);
}

/**
 * Applies the corrections: local stock becomes the counted figure, the
 * session closes, and the whole thing is queued under the session's own id
 * so a replay is a no-op server-side.
 */
export async function applyAdjustments(sessionId: string): Promise<VarianceReport> {
  const db = getDb();
  const session = await db.inventorySessions.get(sessionId);
  if (!session) {
    throw new Error("Session d'inventaire introuvable.");
  }
  if (session.statut === "termine") {
    throw new Error("Cet inventaire est déjà terminé.");
  }

  const report = await buildLocalVarianceReport(sessionId);
  const adjustments = adjustmentsFrom(report);
  const appliedAt = new Date();

  await db.transaction("rw", db.products, db.inventorySessions, async () => {
    for (const adjustment of adjustments) {
      // Set to the counted figure, never the expected one shifted by the
      // gap — same rule the server applies at sync time.
      await db.products.update(adjustment.productId, {
        quantityInStock: adjustment.quantiteComptee,
      });
    }
    await db.inventorySessions.update(sessionId, { statut: "termine", dateFin: appliedAt });
  });

  await enqueue({
    type: "applyInventory",
    entityId: sessionId,
    payload: {
      input: { sessionId, adjustments, appliedAt: appliedAt.toISOString() },
    },
    clientTimestamp: appliedAt,
  });
  void processQueue();

  return report;
}
