/**
 * Pure logic for medicine call-back reminders: urgency classification and
 * ordering. Framework- and data-layer-agnostic, same split as
 * lib/stock/alerts.ts.
 *
 * No automated messaging in this version — the pharmacist phones the
 * client themselves, so all this has to get right is *which* reminders
 * deserve attention today.
 */

export const REMINDER_STATUSES = ["a_faire", "fait", "annule"] as const;
export type ReminderStatusValue = (typeof REMINDER_STATUSES)[number];

export const REMINDER_STATUS_LABELS: Record<ReminderStatusValue, string> = {
  a_faire: "À faire",
  fait: "Fait",
  annule: "Annulé",
};

/** Urgency of an outstanding reminder, relative to today. */
export type ReminderUrgency = "overdue" | "today" | "upcoming" | "done";

export type ReminderForUrgency = {
  dateRappel: Date;
  statut: ReminderStatusValue;
};

/**
 * Compares whole calendar days, ignoring the time of day: a reminder set
 * for 09:00 today is still "today" at 18:00, not overdue. UTC getters
 * throughout so the result doesn't shift with the server's timezone —
 * same reasoning as daysUntil() in lib/stock/alerts.ts.
 */
function startOfDayUtc(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getReminderUrgency(
  reminder: ReminderForUrgency,
  now: Date = new Date(),
): ReminderUrgency {
  // A handled or cancelled reminder is never urgent, however old it is.
  if (reminder.statut !== "a_faire") return "done";

  const due = startOfDayUtc(reminder.dateRappel);
  const today = startOfDayUtc(now);

  if (due < today) return "overdue";
  if (due === today) return "today";
  return "upcoming";
}

/** Reminders needing a call now — what the sidebar badge counts. */
export function countDueReminders(
  reminders: ReminderForUrgency[],
  now: Date = new Date(),
): number {
  return reminders.filter((reminder) => {
    const urgency = getReminderUrgency(reminder, now);
    return urgency === "overdue" || urgency === "today";
  }).length;
}

/**
 * Sorted for a work queue: the most overdue first, then today, then
 * upcoming, with everything already handled pushed to the end.
 */
export function sortReminders<T extends ReminderForUrgency>(reminders: T[], now: Date = new Date()): T[] {
  const rank: Record<ReminderUrgency, number> = { overdue: 0, today: 1, upcoming: 2, done: 3 };

  return [...reminders].sort((a, b) => {
    const byUrgency = rank[getReminderUrgency(a, now)] - rank[getReminderUrgency(b, now)];
    if (byUrgency !== 0) return byUrgency;
    return a.dateRappel.getTime() - b.dateRappel.getTime();
  });
}
