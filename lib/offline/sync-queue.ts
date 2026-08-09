import { getDb, type SyncOperationType, type SyncQueueItem } from "@/lib/offline/db";

/** Once an item has failed this many times, it's given up on and stops counting as "pending". */
export const MAX_SYNC_ATTEMPTS = 5;

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

export async function listPendingSyncItems(): Promise<SyncQueueItem[]> {
  const items = await getDb().syncQueue.where("status").anyOf(["pending", "failed"]).toArray();
  return items
    .filter((item) => item.attempts < MAX_SYNC_ATTEMPTS)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function countPendingSyncItems(): Promise<number> {
  const items = await getDb().syncQueue.where("status").anyOf(["pending", "syncing", "failed"]).toArray();
  return items.filter((item) => item.attempts < MAX_SYNC_ATTEMPTS).length;
}

export async function markSyncing(id: string): Promise<void> {
  await getDb().syncQueue.update(id, { status: "syncing" });
}

export async function markSynced(id: string): Promise<void> {
  await getDb().syncQueue.update(id, { status: "synced" });
}

export async function markFailed(id: string, error: string, attempts: number): Promise<void> {
  await getDb().syncQueue.update(id, { status: "failed", lastError: error, attempts });
}
