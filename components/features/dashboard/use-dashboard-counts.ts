"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUnreadPublicationCount } from "@/lib/server/publications";
import { getDueReminderCount } from "@/lib/server/reminders";
import {
  getCountsServerSnapshot,
  getCountsSnapshot,
  rememberCounts,
  subscribeToCounts,
  type DashboardCounts,
} from "@/lib/offline/last-known-counts";

/** How often to re-check while the tab stays open. */
const REFRESH_INTERVAL_MS = 60_000;

export type DashboardCountsState = DashboardCounts & {
  /** True while the displayed figures are remembered ones, not confirmed. */
  isStale: boolean;
};

/**
 * The sidebar's two badges, fetched from the client instead of the layout's
 * Server Component.
 *
 * The rendered value always comes from the remembered snapshot, which the
 * query updates on success. A failed fetch therefore changes nothing on
 * screen: with no network the sidebar keeps showing the last figure it
 * saw, flagged as stale, rather than dropping to zero — a "0 rappels"
 * badge invented by a network error is worse than an old number, because
 * it reads as "nothing to do today".
 */
export function useDashboardCounts(): DashboardCountsState {
  const remembered = useSyncExternalStore(
    subscribe,
    getCountsSnapshot,
    getCountsServerSnapshot,
  );

  const query = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: async () => {
      const [unreadNews, dueReminders] = await Promise.all([
        getUnreadPublicationCount(),
        getDueReminderCount(),
      ]);
      rememberCounts({ unreadNews, dueReminders });
      return { unreadNews, dueReminders };
    },
    refetchInterval: REFRESH_INTERVAL_MS,
    // One attempt: offline, retrying three times just delays the moment
    // the UI settles on the remembered value it was always going to show.
    retry: false,
  });

  return {
    ...remembered,
    isStale: query.isError || (remembered.updatedAt === null && !query.isSuccess),
  };
}

// Module-level so the reference stays stable across renders, as
// useSyncExternalStore requires.
function subscribe(listener: () => void) {
  return subscribeToCounts(listener);
}
