/**
 * Last known value of the sidebar's two counters (unread publications,
 * reminders due), kept in localStorage.
 *
 * These used to be fetched in the dashboard layout's Server Component,
 * which meant two Postgres round trips on *every* navigation and a shell
 * that could not render at all without them. They are now client data
 * with a remembered fallback: with no network the sidebar shows the last
 * figure it saw instead of blocking, and says so.
 *
 * localStorage rather than Dexie on purpose — reads are synchronous, so
 * the first paint already carries the remembered number. An async read
 * would flash a zero badge on every load.
 */

const STORAGE_KEY = "akribis:last-known-counts";

export type DashboardCounts = {
  unreadNews: number;
  dueReminders: number;
  /** When these figures were last confirmed against the server. */
  updatedAt: string | null;
};

export const EMPTY_COUNTS: DashboardCounts = {
  unreadNews: 0,
  dueReminders: 0,
  updatedAt: null,
};

/** In-memory mirror, so `useSyncExternalStore` can hand back a stable object. */
let snapshot: DashboardCounts | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): DashboardCounts {
  if (!raw) return EMPTY_COUNTS;
  try {
    const parsed = JSON.parse(raw) as Partial<DashboardCounts>;
    return {
      unreadNews: Number(parsed.unreadNews) || 0,
      dueReminders: Number(parsed.dueReminders) || 0,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    // Corrupted entry (hand-edited, half-written): treat as "nothing known"
    // rather than throwing inside a render.
    return EMPTY_COUNTS;
  }
}

export function getCountsSnapshot(): DashboardCounts {
  if (snapshot) return snapshot;
  if (typeof window === "undefined") return EMPTY_COUNTS;
  snapshot = parse(window.localStorage.getItem(STORAGE_KEY));
  return snapshot;
}

/** The server has no localStorage; SSR renders zeros and hydration corrects them. */
export function getCountsServerSnapshot(): DashboardCounts {
  return EMPTY_COUNTS;
}

export function subscribeToCounts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function rememberCounts(counts: { unreadNews: number; dueReminders: number }): void {
  const next: DashboardCounts = { ...counts, updatedAt: new Date().toISOString() };
  snapshot = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing or a full quota: the in-memory snapshot still
      // serves this session, it just won't survive a reload.
    }
  }
  listeners.forEach((listener) => listener());
}

/** Test seam — also used when signing out, so counts don't leak between accounts. */
export function clearRememberedCounts(): void {
  snapshot = null;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do — see rememberCounts.
    }
  }
  listeners.forEach((listener) => listener());
}
