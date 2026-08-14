import { getDb, type SyncOperationType, type SyncQueueItem } from "@/lib/offline/db";

/**
 * Attempts after which an item is *reported* as needing a human.
 *
 * It is not a limit. The item stays in the queue and keeps being retried,
 * just further and further apart. Nothing here is ever discarded for
 * having failed too often: treating a threshold as an expiry date is what
 * silently destroyed sales on Safari, where a plain network failure was
 * misread as an unknown error and the counter ran out.
 */
export const MAX_SYNC_ATTEMPTS = 5;

const BASE_BACKOFF_MS = 5_000;
/** Capped so a long outage still retries every few minutes, not every few hours. */
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Exponential spacing between retries of an error the engine could not
 * interpret. Pure, so the schedule is testable without a clock.
 */
export function backoffDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

/** Statuses that mean "still owed to the server". */
const UNSETTLED: SyncQueueItem["status"][] = ["pending", "syncing", "failed"];

export async function enqueue(entry: {
  type: SyncOperationType;
  entityId: string;
  payload: unknown;
  clientTimestamp: Date;
}): Promise<SyncQueueItem> {
  const item: SyncQueueItem = {
    id: crypto.randomUUID(),
    type: entry.type,
    entityId: entry.entityId,
    payload: entry.payload,
    clientTimestamp: entry.clientTimestamp,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: new Date(),
  };
  await getDb().syncQueue.add(item);
  return item;
}

/**
 * Items due for another try RIGHT NOW. No cap on attempts — an item only
 * waits out its backoff, it is never struck off.
 *
 * This is a scheduling question, not a display one: an item serving out a
 * backoff is absent from this list and still owed to the server. Showing
 * it to the user is `listOutstandingSyncItems`. Using this one for the UI
 * is what made the sync panel announce "6 écritures bloquées" above
 * "Aucun élément en attente".
 */
export async function listPendingSyncItems(now: Date = new Date()): Promise<SyncQueueItem[]> {
  const items = await getDb().syncQueue.where("status").anyOf(["pending", "failed"]).toArray();
  return items
    .filter((item) => !item.nextAttemptAt || item.nextAttemptAt.getTime() <= now.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export type OutstandingSyncItem = SyncQueueItem & {
  /** Failed often enough to deserve a human look; still being retried. */
  isStalled: boolean;
};

/**
 * Everything still owed to the server, due now or waiting out a backoff —
 * what the sync panel lists. Kept in step with `countPendingSyncItems` by
 * construction: same query, same statuses, so the number in the header can
 * never disagree with the list beneath it.
 */
export async function listOutstandingSyncItems(): Promise<OutstandingSyncItem[]> {
  const items = await getDb().syncQueue.where("status").anyOf(UNSETTLED).toArray();
  return items
    .map((item) => ({ ...item, isStalled: item.attempts >= MAX_SYNC_ATTEMPTS }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Everything still owed to the server, whether or not it is due right now. */
export async function countPendingSyncItems(): Promise<number> {
  const items = await getDb().syncQueue.where("status").anyOf(UNSETTLED).toArray();
  return items.length;
}

/**
 * Items that have failed enough times to deserve attention. They are still
 * being retried; this is what makes a stuck write visible instead of
 * letting it rot unnoticed at the bottom of the queue.
 */
export async function countStalledSyncItems(): Promise<number> {
  const items = await getDb().syncQueue.where("status").anyOf(UNSETTLED).toArray();
  return items.filter((item) => item.attempts >= MAX_SYNC_ATTEMPTS).length;
}

export async function markSyncing(id: string): Promise<void> {
  await getDb().syncQueue.update(id, { status: "syncing" });
}

export async function markSynced(id: string): Promise<void> {
  await getDb().syncQueue.update(id, { status: "synced" });
}

export async function markFailed(
  id: string,
  error: string,
  attempts: number,
  nextAttemptAt?: Date,
): Promise<void> {
  await getDb().syncQueue.update(id, { status: "failed", lastError: error, attempts, nextAttemptAt });
}

/**
 * The server refused on the merits. Terminal on purpose: retrying an
 * out-of-stock sale forever would never succeed and would keep the pending
 * badge lit. The refusal is recorded in the conflict log instead.
 */
export async function markRejected(id: string, error: string): Promise<void> {
  await getDb().syncQueue.update(id, { status: "rejected", lastError: error });
}

/**
 * Discards writes that can never go through — a sale referring to a
 * product the server no longer has, say.
 *
 * Deliberately restricted to stalled items. Everything else in the queue
 * is either due or waiting out a backoff and stands a real chance of
 * succeeding; offering to delete those would hand back the data loss this
 * queue exists to prevent. Even here the caller must confirm, and the
 * discarded items are returned so the decision can be recorded.
 */
export async function discardStalledSyncItems(): Promise<OutstandingSyncItem[]> {
  const stalled = (await listOutstandingSyncItems()).filter((item) => item.isStalled);
  if (stalled.length === 0) return [];
  await getDb().syncQueue.bulkDelete(stalled.map((item) => item.id));
  return stalled;
}
