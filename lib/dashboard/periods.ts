/**
 * Period maths for the dashboard's "vs période précédente" comparisons.
 * Pure and data-layer-agnostic, same split as lib/stock/alerts.ts, so the
 * window arithmetic and the percentage edge cases can be tested without a
 * database.
 */

export const PERIODS = ["semaine", "mois", "trimestre"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_DAYS: Record<Period, number> = {
  semaine: 7,
  mois: 30,
  trimestre: 90,
};

/**
 * Labels say "N derniers jours" rather than "ce mois" on purpose — see
 * `getPeriodRanges` for why the windows are rolling.
 */
export const PERIOD_LABELS: Record<Period, string> = {
  semaine: "7 derniers jours",
  mois: "30 derniers jours",
  trimestre: "90 derniers jours",
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

export type DateRange = { from: Date; to: Date };

/**
 * Current window and the equally-long window immediately before it.
 *
 * Deliberately rolling (last 30 days vs the 30 before) rather than
 * calendar-aligned (this month vs last month): a calendar comparison pits
 * a partial current month against a complete previous one, so on the 3rd
 * of the month every figure would read as a collapse. Equal-length
 * windows are what makes the percentage meaningful.
 *
 * Ranges are half-open — `from` inclusive, `to` exclusive — so the two
 * windows tile without double-counting a sale on the boundary.
 */
export function getPeriodRanges(
  period: Period,
  now: Date = new Date(),
): { current: DateRange; previous: DateRange } {
  const days = PERIOD_DAYS[period];
  const msPerDay = 24 * 60 * 60 * 1000;
  const currentFrom = new Date(now.getTime() - days * msPerDay);
  const previousFrom = new Date(now.getTime() - 2 * days * msPerDay);

  return {
    current: { from: currentFrom, to: now },
    previous: { from: previousFrom, to: currentFrom },
  };
}

export type Variation = {
  /**
   * Percentage change, or null when there's no meaningful baseline —
   * i.e. the previous period was zero while the current one isn't.
   * Rendering that as "+∞ %" or "+100 %" would both be lies.
   */
  percent: number | null;
  direction: "up" | "down" | "flat";
};

/** Rounded to one decimal — more precision than that is noise on a KPI tile. */
export function computeVariation(current: number, previous: number): Variation {
  if (previous === 0) {
    if (current === 0) return { percent: 0, direction: "flat" };
    return { percent: null, direction: current > 0 ? "up" : "down" };
  }

  // Math.abs on the denominator keeps the sign meaningful if a previous
  // total is ever negative (a refund-heavy window): a rise still reads up.
  const percent = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  return {
    percent,
    direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat",
  };
}

/** "+12,5 %" / "−8 %" / "0 %" — French formatting, or null when there's no baseline. */
export function formatVariation(variation: Variation): string | null {
  if (variation.percent === null) return null;
  const sign = variation.percent > 0 ? "+" : variation.percent < 0 ? "−" : "";
  const value = Math.abs(variation.percent).toLocaleString("fr-FR");
  return `${sign}${value} %`;
}
