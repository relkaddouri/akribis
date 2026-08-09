/**
 * The background sync engine: drains the offline write queue against
 * the Prisma-backed lib/server/* functions whenever the browser is
 * online, resolves last-write-wins conflicts on product edits, and
 * exposes a subscribable online/offline/syncing status for the UI
 * indicator (via useSyncExternalStore in use-sync-status.ts).
 */

import { getDb, type ProductRecord, type SyncQueueItem } from "@/lib/offline/db";
import {
  countPendingSyncItems,
  listPendingSyncItems,
  markFailed,
  markSynced,
  markSyncing,
  MAX_SYNC_ATTEMPTS,
} from "@/lib/offline/sync-queue";
import { logConflict } from "@/lib/offline/conflict-log";
import * as remoteProducts from "@/lib/server/products";
import * as remoteSales from "@/lib/server/sales";
import * as remoteOrders from "@/lib/server/orders";
import type { ProductFormInput } from "@/lib/validations/products";
import type { CreateSaleInput } from "@/lib/validations/sales";
import type { ReceiveOrderInput } from "@/lib/validations/orders";

const POLL_INTERVAL_MS = 15_000;

export type SyncStatus = "offline" | "online" | "syncing";
export type SyncState = { status: SyncStatus; pendingCount: number };

let state: SyncState = { status: "online", pendingCount: 0 };
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
 * The request never actually reached (or came back from) the server — a
 * DB/network outage, not a rejection. `navigator.onLine` only reflects
 * whether the device has a network interface up, so it stays "online"
 * even when the database itself is unreachable; this is what actually
 * detects that case. Must retry forever rather than being abandoned like
 * a business rejection, or a real write would be silently dropped.
 */
function isConnectivityError(message: string): boolean {
  return /can't reach database server|failed to fetch|network ?error|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(
    message,
  );
}

async function refreshPendingCount() {
  setState({ pendingCount: await countPendingSyncItems() });
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
        await remoteSales.createSale(payload.input, { id: payload.id });
        await markSynced(item.id);
        return;
      }
      case "receiveOrder": {
        const payload = item.payload as { orderId: string; input: ReceiveOrderInput };
        await remoteOrders.receiveOrder(payload.orderId, payload.input);
        await markSynced(item.id);
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur de synchronisation inconnue.";

    if (isBusinessRejection(message)) {
      // e.g. another till already sold the last unit before this queued
      // sale reached the server — retrying changes nothing, so this is
      // a resolved conflict, not a transient failure.
      const entityType = item.type === "createSale" ? "sale" : item.type === "receiveOrder" ? "order" : "product";
      await logConflict({
        entityType,
        entityId: item.entityId,
        queueItemId: item.id,
        clientTimestamp: item.clientTimestamp,
        resolution: "sync_rejected",
        detail: message,
      });
      await markFailed(item.id, message, MAX_SYNC_ATTEMPTS);
      return;
    }

    if (isConnectivityError(message)) {
      // The database/server was unreachable, not a rejection — attempts
      // must not advance, or this write would eventually be abandoned
      // (and, once maxed out, drop off the pending count) even though
      // it was never actually delivered.
      connectivityFailureThisPass = true;
      await markFailed(item.id, message, item.attempts);
      return;
    }

    await markFailed(item.id, message, item.attempts + 1);
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
  } catch {
    // Best-effort cache refresh — a failure here shouldn't break queue draining.
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

export function startSyncEngine(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  setState({ status: isOnline() ? "online" : "offline" });
  void refreshPendingCount();
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
