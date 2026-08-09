import { describe, expect, it } from "vitest";
import {
  computeVariation,
  formatVariation,
  getPeriodRanges,
  isPeriod,
  PERIOD_DAYS,
  type Period,
} from "@/lib/dashboard/periods";

const NOW = new Date("2026-08-09T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("getPeriodRanges", () => {
  it.each(["semaine", "mois", "trimestre"] as Period[])(
    "gives %s a previous window of exactly the same length",
    (period) => {
      const { current, previous } = getPeriodRanges(period, NOW);

      const currentLength = current.to.getTime() - current.from.getTime();
      const previousLength = previous.to.getTime() - previous.from.getTime();

      expect(currentLength).toBe(previousLength);
      expect(currentLength).toBe(PERIOD_DAYS[period] * MS_PER_DAY);
    },
  );

  it("makes the two windows contiguous, so no day falls in both or neither", () => {
    const { current, previous } = getPeriodRanges("mois", NOW);

    expect(previous.to.getTime()).toBe(current.from.getTime());
  });

  it("ends the current window at 'now'", () => {
    expect(getPeriodRanges("semaine", NOW).current.to).toEqual(NOW);
  });

  it("uses rolling windows, not calendar months — a mid-month run still looks back a full 30 days", () => {
    const midMonth = new Date("2026-08-03T09:00:00Z");
    const { current } = getPeriodRanges("mois", midMonth);

    // A calendar-aligned "this month" would start on 2026-08-01 and cover
    // barely two days, making every early-month figure look collapsed.
    expect(current.from).toEqual(new Date("2026-07-04T09:00:00Z"));
  });
});

describe("computeVariation", () => {
  it("reports a rise as a positive percentage", () => {
    expect(computeVariation(150, 100)).toEqual({ percent: 50, direction: "up" });
  });

  it("reports a fall as a negative percentage", () => {
    expect(computeVariation(80, 100)).toEqual({ percent: -20, direction: "down" });
  });

  it("reports no movement as flat", () => {
    expect(computeVariation(100, 100)).toEqual({ percent: 0, direction: "flat" });
  });

  it("rounds to one decimal", () => {
    expect(computeVariation(1234, 1000).percent).toBe(23.4);
  });

  it("refuses to invent a percentage when the previous period was zero", () => {
    // Dividing by zero here would surface as Infinity, and defaulting to
    // "+100 %" would be a fabricated baseline.
    expect(computeVariation(500, 0)).toEqual({ percent: null, direction: "up" });
  });

  it("treats zero-to-zero as flat rather than undefined", () => {
    expect(computeVariation(0, 0)).toEqual({ percent: 0, direction: "flat" });
  });

  it("reports a drop to zero as -100 %", () => {
    expect(computeVariation(0, 250)).toEqual({ percent: -100, direction: "down" });
  });

  it("keeps the direction meaningful when the baseline is negative", () => {
    // A refund-heavy previous window can total below zero; moving up from
    // it must still read as an improvement.
    expect(computeVariation(-50, -100)).toEqual({ percent: 50, direction: "up" });
  });
});

describe("formatVariation", () => {
  it.each([
    [{ percent: 12.5, direction: "up" as const }, "+12,5 %"],
    [{ percent: -8, direction: "down" as const }, "−8 %"],
    [{ percent: 0, direction: "flat" as const }, "0 %"],
  ])("formats %o as %s", (variation, expected) => {
    expect(formatVariation(variation)).toBe(expected);
  });

  it("returns null when there is no baseline, so the UI can say something else", () => {
    expect(formatVariation({ percent: null, direction: "up" })).toBeNull();
  });
});

describe("isPeriod", () => {
  it("accepts the three supported windows", () => {
    expect(["semaine", "mois", "trimestre"].every(isPeriod)).toBe(true);
  });

  it("rejects anything else, so a tampered ?periode= falls back to the default", () => {
    expect(isPeriod("annee")).toBe(false);
    expect(isPeriod("")).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
    expect(isPeriod(30)).toBe(false);
  });
});
