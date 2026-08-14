/**
 * The background sync engine: drains the offline write queue against
 * the Prisma-backed lib/server/* functions whenever the browser is
 * online, resolves last-write-wins conflicts on product edits, and
 * exposes a subscribable online/offline/syncing status for the UI
 * indicator (via useSyncExternalStore in use-sync-status.ts).
 */

import { getDb, type ProductRecord, type SyncQueueItem } from "@/lib/offline/db";
import {
  backoffDelayMs,
  countPendingSyncItems,
  countStalledSyncItems,
  listPendingSyncItems,
  markFailed,
  markRejected,
  markSynced,
  markSyncing,
  MAX_SYNC_ATTEMPTS,
} from "@/lib/offline/sync-queue";
import { listConflicts } from "@/lib/offline/conflict-log";
import { logConflict } from "@/lib/offline/conflict-log";
import * as remoteProducts from "@/lib/server/products";
import * as remoteSales from "@/lib/server/sales";
import * as remoteOrders from "@/lib/server/orders";
import type { ProductFormInput } from "@/lib/validations/products";
import type { CreateSaleInput } from "@/lib/validations/sales";
import type { ReceiveOrderInput } from "@/lib/validations/orders";

const POLL_INTERVAL_MS = 15_000;

export type SyncStatus = "offline" | "online" | "syncing";
export type SyncState = {
  status: SyncStatus;
  pendingCount: number;
  /** Of those, how many have failed enough times to need a human look. */
  stalledCount: number;
};

let state: SyncState = { status: "online", pendingCount: 0, stalledCount: 0 };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): SyncState {
  return state;
}

/**
 * What the header's badge says for each state. Here rather than inline in
 * the component so the mapping is testable: the badge renders this string
 * and nothing else, so a test of this function is a test of the badge.
 */
export function syncStatusLabel(status: SyncStatus): string {
  if (status === "offline") return "Hors ligne";
  if (status === "syncing") return "Synchronisation...";
  return "En ligne";
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function toLocalProduct(product: ProductRecord) {
  return { ...product, syncStatus: "synced" as const };
}

/** Errors the server rejected for business reasons — retrying won't help. */
function isBusinessRejection(message: string): boolean {
  return /stock insuffisant|introuvable/i.test(message);
}

/**
 * Wordings engines use for a request that never completed. Chrome says
 * "Failed to fetch", Firefox "NetworkError when attempting to fetch
 * resource", WebKit any of several — "Load failed" being the one that used
 * to slip through and cost a sale. Prisma's own unreachable-database
 * message is here too, since a Server Action re-throws it verbatim.
 */
const CONNECTIVITY_MESSAGES =
  /can't reach database server|failed to fetch|fetch failed|network ?error|network request failed|load failed|network connection was lost|connection appears to be offline|ECONNREFUSED|ETIMEDOUT/i;

/**
 * The request never actually reached (or came back from) the server — a
 * DB/network outage, not a rejection. `navigator.onLine` only reflects
 * whether the device has a network interface up, so it stays "online"
 * even when the database itself is unreachable; this is what actually
 * detects that case. Must retry forever rather than being abandoned like
 * a business rejection, or a real write would be silently dropped.
 *
 * The type is checked before the wording. Every engine rejects a fetch
 * that never completed with a TypeError, so that test holds in browsers
 * whose phrasing nobody has thought of yet — a list of strings is only a
 * fallback for errors that arrive re-wrapped, and matching one is what
 * this function got wrong on Safari.
 */
function isConnectivityError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return CONNECTIVITY_MESSAGES.test(message);
}

async function refreshPendingCount() {
  setState({
    pendingCount: await countPendingSyncItems(),
    stalledCount: await countStalledSyncItems(),
  });
}

/** Set while draining the queue whenever a connectivity error is hit, so processQueue can report "offline" honestly. */
let connectivityFailureThisPass = false;

async function syncItem(item: SyncQueueItem): Promise<void> {
  await markSyncing(item.id);
  try {
    switch (item.type) {
      case "createProduct": {
        const payload = item.payload as { id: string; input: ProductFormInput };
        const created = await remoteProducts.createProduct(payload.input, { id: payload.id });
        await getDb().products.put(toLocalProduct(created));
        await markSynced(item.id);
        return;
      }
      case "updateProduct": {
        const payload = item.payload as {
          id: string;
          input: ProductFormInput;
          clientTimestamp: string;
        };
        const current = await remoteProducts.getProduct(payload.id);
        const localWriteTime = new Date(payload.clientTimestamp).getTime();
        if (current && current.updatedAt.getTime() > localWriteTime) {
          // Someone else's edit reached the server after ours was made
          // locally but before we could sync — last write wins, and
          // theirs is later, so the remote version is kept and ours is
          // dropped (logged, not silently lost).
          await logConflict({
            entityType: "product",
            entityId: payload.id,
            queueItemId: item.id,
            clientTimestamp: new Date(payload.clientTimestamp),
            resolution: "remote_wins",
            detail: `Modification locale de "${current.name}" ignorée : une version plus récente existait déjà sur le serveur au moment de la synchronisation.`,
          });
          await getDb().products.put(toLocalProduct(current));
          await markSynced(item.id);
          return;
        }
        const updated = await remoteProducts.updateProduct(payload.id, payload.input);
        await getDb().products.put(toLocalProduct(updated));
        await markSynced(item.id);
        return;
      }
      case "createSale": {
        const payload = item.payload as { id: string; input: CreateSaleInput };
        const receipt = await remoteSales.createSale(payload.input, { id: payload.id });

        // The sale stands at the price on the customer's ticket; a
        // catalogue that has moved since is only worth a note. Logged
        // after markSynced would risk losing it if that write failed, so
        // it goes first — a duplicate note is harmless, a missing one is
        // the thing worth avoiding.
        // Defensive `?? []`: the sale is already committed at this point,
        // and iterating undefined would throw, marking a write that
        // succeeded as failed and replaying it forever.
        for (const drift of receipt.priceDrifts ?? []) {
          await logConflict({
            entityType: "sale",
            entityId: item.entityId,
            queueItemId: item.id,
            clientTimestamp: item.clientTimestamp,
            resolution: "price_drift",
            detail: `"${drift.productName}" vendu à ${drift.chargedPrice.toFixed(2)} MAD, prix catalogue actuel ${drift.catalogPrice.toFixed(2)} MAD. Le montant facturé reste celui du ticket.`,
          });
        }

        await markSynced(item.id);
        return;
      }
      case "receiveOrder": {
        const payload = item.payload as {
          orderId: string;
          input: ReceiveOrderInput;
          /** Absent on items queued before delivery ids existed. */
          deliveryId?: string;
        };
        // Optional rather than required: an item already sitting in
        // IndexedDB when this version shipped has no id, and must still
        // sync — without idempotence, as before, rather than not at all.
        await remoteOrders.receiveOrder(
          payload.orderId,
          payload.input,
          payload.deliveryId ? { id: payload.deliveryId } : undefined,
        );
        await markSynced(item.id);
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur de synchronisation inconnue.";

    if (isBusinessRejection(message)) {
      // e.g. another till already sold the last unit before this queued
      // sale reached the server — retrying changes nothing, so this is
      // a resolved conflict, not a transient failure. The conflict log is
      // where it stays visible.
      const entityType = item.type === "createSale" ? "sale" : item.type === "receiveOrder" ? "order" : "product";
      await logConflict({
        entityType,
        entityId: item.entityId,
        queueItemId: item.id,
        clientTimestamp: item.clientTimestamp,
        resolution: "sync_rejected",
        detail: message,
      });
      await markRejected(item.id, message);
      return;
    }

    if (isConnectivityError(err)) {
      // The database/server was unreachable, not a rejection — attempts
      // must not advance, and no backoff either: the next poll (or the
      // `online` event) should try again promptly.
      connectivityFailureThisPass = true;
      await markFailed(item.id, message, item.attempts);
      return;
    }

    // An error the engine cannot interpret. It is retried anyway, spaced
    // further apart each time, and never discarded: whatever this is, a
    // write the pharmacist believes was recorded must not evaporate
    // because the code failed to recognise the failure.
    const attempts = item.attempts + 1;
    await markFailed(
      item.id,
      message,
      attempts,
      new Date(Date.now() + backoffDelayMs(attempts)),
    );
  }
}

/** Pulls the current server product list into the local cache, without clobbering unsynced local edits. */
export async function hydrateProductsFromServer(): Promise<void> {
  if (!isOnline()) return;
  try {
    const remote = await remoteProducts.listProducts();
    const db = getDb();
    const pending = await db.syncQueue.where("status").anyOf(["pending", "syncing", "failed"]).toArray();
    const pendingEntityIds = new Set(
      pending.filter((i) => i.type === "createProduct" || i.type === "updateProduct").map((i) => i.entityId),
    );
    await db.transaction("rw", db.products, async () => {
      for (const product of remote) {
        if (pendingEntityIds.has(product.id)) continue;
        await db.products.put(toLocalProduct(product));
      }
    });
  } catch (err) {
    // Best-effort cache refresh — a failure here must not break queue
    // draining. But it is not nothing either: with an empty queue this is
    // the only server call in the whole pass, so swallowing it whole left
    // the badge announcing "En ligne" while the database was unreachable.
    //
    // Only a connectivity failure counts. A bug in the refresh itself must
    // not be reported as a lost connection: the badge would then send
    // someone to check the router over a defect in this code.
    if (isConnectivityError(err)) {
      connectivityFailureThisPass = true;
    }
  }
}

let processing = false;

export async function processQueue(): Promise<void> {
  if (processing) return;
  if (!isOnline()) {
    // Still reflect a write queued while offline immediately, rather than
    // leaving the "en attente" badge stale until connectivity returns.
    await refreshPendingCount();
    return;
  }
  processing = true;
  connectivityFailureThisPass = false;
  setState({ status: "syncing" });
  try {
    const items = await listPendingSyncItems();
    for (const item of items) {
      await syncItem(item);
    }
    await hydrateProductsFromServer();
  } finally {
    processing = false;
    await refreshPendingCount();
    // navigator.onLine only reflects "has a network interface" — it stays
    // true through a Wi-Fi-but-no-real-internet or DB-outage scenario, so
    // a connectivity error observed this pass overrides it.
    setState({ status: connectivityFailureThisPass ? "offline" : isOnline() ? "online" : "offline" });
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

function handleOnline() {
  setState({ status: "online" });
  void processQueue();
}

function handleOffline() {
  setState({ status: "offline" });
}

/**
 * Repairs items left by the previous scheme, which used
 * `attempts = MAX_SYNC_ATTEMPTS` as a terminal state for two very
 * different things: a business rejection (correctly parked) and a write
 * that had simply failed too often (wrongly abandoned — bug ②).
 *
 * The conflict log tells them apart: a rejection was recorded there with
 * this item's id. Rejections are marked as such so they stay off the
 * pending badge; everything else is put back in the queue, because those
 * are exactly the writes this bug threw away.
 */
export async function migrateLegacyQueueItems(): Promise<void> {
  const db = getDb();
  const stuck = (await db.syncQueue.where("status").anyOf(["pending", "failed"]).toArray()).filter(
    (item) => item.attempts >= MAX_SYNC_ATTEMPTS && item.nextAttemptAt === undefined,
  );
  if (stuck.length === 0) return;

  const rejectedQueueIds = new Set(
    (await listConflicts())
      .filter((conflict) => conflict.resolution === "sync_rejected")
      .map((conflict) => conflict.queueItemId),
  );

  for (const item of stuck) {
    if (rejectedQueueIds.has(item.id)) {
      await markRejected(item.id, item.lastError ?? "Refusé par le serveur.");
    } else {
      await markFailed(item.id, item.lastError ?? "", item.attempts, new Date());
    }
  }
}

export function startSyncEngine(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  setState({ status: isOnline() ? "online" : "offline" });
  void migrateLegacyQueueItems().then(refreshPendingCount);
  pollTimer = setInterval(() => void processQueue(), POLL_INTERVAL_MS);
  if (isOnline()) void processQueue();
}

export function stopSyncEngine(): void {
  if (typeof window === "undefined" || !started) return;
  started = false;
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
