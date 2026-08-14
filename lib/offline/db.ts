import Dexie, { type Table } from "dexie";

/**
 * The local IndexedDB schema. This is the actual offline-first store:
 * writes land here first (instant, works with no connectivity), and the
 * sync engine (lib/offline/sync-engine.ts) drains the queue against the
 * Prisma-backed functions in lib/server/* whenever the browser is
 * online.
 */

export type SyncStatus = "synced" | "pending";

/** The shape callers (stock/POS components) see — no internal sync bookkeeping. */
export type ProductRecord = {
  id: string;
  pharmacyId: string;
  name: string;
  form: string;
  dosage: string | null;
  laboratory: string | null;
  barcode: string | null;
  dci: string | null;
  photoUrl: string | null;
  category: string | null;
  price: number;
  pph: number | null;
  tvaVente: number | null;
  tvaAchat: number | null;
  lowStockThreshold: number;
  quantityInStock: number;
  nearestExpiryDate: Date | null;
  remboursable: boolean;
  baseRemboursement: number | null;
  posologieEnfant: string | null;
  posologieAdulte: string | null;
  monographie: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LocalProduct = ProductRecord & {
  syncStatus: SyncStatus;
};

export type SyncOperationType = "createProduct" | "updateProduct" | "createSale" | "receiveOrder";
/**
 * `rejected` is terminal and deliberate: the server refused on the merits
 * (insufficient stock, missing product) and the refusal is recorded in the
 * conflict log. `failed` never is — an item keeps that status until it
 * eventually goes through, however many attempts that takes.
 */
export type SyncItemStatus = "pending" | "syncing" | "failed" | "synced" | "rejected";

export type SyncQueueItem = {
  id: string;
  type: SyncOperationType;
  /** The local product/sale/order id this operation is about. */
  entityId: string;
  /** Operation-specific args, passed straight through to the matching lib/server/* function. */
  payload: unknown;
  /** When the write was made locally — the basis for last-write-wins conflict resolution. */
  clientTimestamp: Date;
  status: SyncItemStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  /**
   * Earliest moment this item may be tried again — the backoff between
   * retries. Absent on items queued before backoff existed, which are
   * treated as due immediately.
   */
  nextAttemptAt?: Date;
};

/**
 * `price_drift` is not a conflict the engine resolved — nothing was
 * changed and nothing was lost. It records that a sale synced at a price
 * the catalogue has since moved away from, so an odd one can be looked
 * into afterwards. See the pricing rule in lib/server/sales.ts.
 */
/**
 * `abandoned` is the only one a human causes: a write that can never
 * succeed, discarded deliberately from Paramètres. Recorded so that
 * throwing data away always leaves a trace, even when it is the right
 * call.
 */
export type ConflictResolution =
  | "remote_wins"
  | "sync_rejected"
  | "price_drift"
  | "abandoned";

export type ConflictLogItem = {
  id: string;
  entityType: "product" | "sale" | "order";
  entityId: string;
  queueItemId: string;
  clientTimestamp: Date;
  resolution: ConflictResolution;
  detail: string;
  resolvedAt: Date;
};

class AkribisOfflineDB extends Dexie {
  products!: Table<LocalProduct, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  conflictLog!: Table<ConflictLogItem, string>;

  constructor() {
    super("akribis-offline");
    this.version(1).stores({
      products: "id, pharmacyId, barcode",
      syncQueue: "id, status, createdAt",
      conflictLog: "id, entityId, resolvedAt",
    });
  }
}

// Lazily instantiated so importing this module never touches
// `indexedDB` outside a browser (or fake-indexeddb-polyfilled test)
// context.
let instance: AkribisOfflineDB | null = null;

export function getDb(): AkribisOfflineDB {
  if (!instance) {
    instance = new AkribisOfflineDB();
  }
  return instance;
}
