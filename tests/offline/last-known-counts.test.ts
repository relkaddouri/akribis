import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRememberedCounts,
  EMPTY_COUNTS,
  getCountsServerSnapshot,
  getCountsSnapshot,
  rememberCounts,
  subscribeToCounts,
} from "@/lib/offline/last-known-counts";

/**
 * The sidebar badges used to be awaited in the layout's Server Component,
 * which meant no network, no shell. They now render from this remembered
 * snapshot, so what matters is that it survives a reload and never
 * invents a figure — "0 rappels" conjured by a failed fetch reads as
 * "nothing to do today", which is worse than yesterday's number.
 */
beforeEach(() => {
  window.localStorage.clear();
  clearRememberedCounts();
});

describe("remembering the counts", () => {
  it("starts empty, with no pretence of being current", () => {
    expect(getCountsSnapshot()).toEqual(EMPTY_COUNTS);
    expect(getCountsSnapshot().updatedAt).toBeNull();
  });

  it("keeps the last confirmed figures and stamps when they were confirmed", () => {
    rememberCounts({ unreadNews: 3, dueReminders: 7 });

    const snapshot = getCountsSnapshot();
    expect(snapshot.unreadNews).toBe(3);
    expect(snapshot.dueReminders).toBe(7);
    expect(snapshot.updatedAt).not.toBeNull();
  });

  it("survives a reload", () => {
    rememberCounts({ unreadNews: 2, dueReminders: 5 });

    // Drops the in-memory mirror, exactly as a page reload does; the value
    // has to come back from storage or the badges reset to zero on F5.
    clearInMemoryMirrorOnly();

    expect(getCountsSnapshot().unreadNews).toBe(2);
    expect(getCountsSnapshot().dueReminders).toBe(5);
  });

  it("renders zeros on the server, so hydration has nothing to disagree about", () => {
    rememberCounts({ unreadNews: 4, dueReminders: 1 });
    expect(getCountsServerSnapshot()).toEqual(EMPTY_COUNTS);
  });

  it("treats a corrupted entry as nothing known rather than throwing mid-render", () => {
    window.localStorage.setItem("akribis:last-known-counts", "{not json");
    clearInMemoryMirrorOnly();

    expect(getCountsSnapshot()).toEqual(EMPTY_COUNTS);
  });

  it("notifies subscribers so the sidebar re-renders on a fresh figure", () => {
    let notifications = 0;
    const unsubscribe = subscribeToCounts(() => {
      notifications += 1;
    });

    rememberCounts({ unreadNews: 1, dueReminders: 0 });
    expect(notifications).toBe(1);

    unsubscribe();
    rememberCounts({ unreadNews: 2, dueReminders: 0 });
    expect(notifications).toBe(1);
  });

  it("forgets everything on sign-out, so figures don't leak between accounts", () => {
    rememberCounts({ unreadNews: 9, dueReminders: 9 });

    clearRememberedCounts();

    expect(getCountsSnapshot()).toEqual(EMPTY_COUNTS);
    expect(window.localStorage.getItem("akribis:last-known-counts")).toBeNull();
  });
});

/**
 * Simulates a page reload: storage survives, the module's in-memory copy
 * does not. `clearRememberedCounts` would also wipe storage, so it can't
 * stand in for this.
 */
function clearInMemoryMirrorOnly() {
  const raw = window.localStorage.getItem("akribis:last-known-counts");
  clearRememberedCounts();
  if (raw !== null) window.localStorage.setItem("akribis:last-known-counts", raw);
}
