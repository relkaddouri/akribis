import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe, type SyncState } from "@/lib/offline/sync-engine";

const SERVER_SNAPSHOT: SyncState = { status: "online", pendingCount: 0, stalledCount: 0 };

export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
