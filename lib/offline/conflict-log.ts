import { getDb, type ConflictLogItem, type ConflictResolution } from "@/lib/offline/db";

export async function logConflict(entry: {
  entityType: ConflictLogItem["entityType"];
  entityId: string;
  queueItemId: string;
  clientTimestamp: Date;
  resolution: ConflictResolution;
  detail: string;
}): Promise<void> {
  const item: ConflictLogItem = {
    id: crypto.randomUUID(),
    ...entry,
    resolvedAt: new Date(),
  };
  await getDb().conflictLog.add(item);
}

export async function listConflicts(): Promise<ConflictLogItem[]> {
  const items = await getDb().conflictLog.toArray();
  return items.sort((a, b) => b.resolvedAt.getTime() - a.resolvedAt.getTime());
}
