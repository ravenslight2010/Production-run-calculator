import { describe, it, expect } from "vitest";
import {
  aggregateDaySummary,
  buildSummaryPromptBlock,
  buildFallbackSummary,
  type DaySummaryInput,
} from "./index";

function run(over: Partial<import("./index").DaySummaryRunInput> = {}) {
  return {
    brand: "Acme",
    flavor: "Cheese",
    casesPlanned: 100,
    casesProduced: 100,
    finished: true,
    downtimeMinutes: 0,
    stoppageCount: 0,
    ...over,
  };
}

describe("aggregateDaySummary", () => {
  it("handles an empty day", () => {
    const stats = aggregateDaySummary({ scope: "day", date: "2026-06-24", runs: [] });
    expect(stats.hasData).toBe(false);
    expect(stats.runsPlanned).toBe(0);
    expect(stats.attainmentPct).toBe(0);
    expect(stats.topDowntime).toBeNull();
  });

  it("totals cases and computes attainment", () => {
    const stats = aggregateDaySummary({
      scope: "day",
      date: "2026-06-24",
      runs: [run({ casesPlanned: 100, casesProduced: 80 }), run({ casesPlanned: 100, casesProduced: 100 })],
    });
    expect(stats.casesPlanned).toBe(200);
    expect(stats.casesProduced).toBe(180);
    expect(stats.attainmentPct).toBe(90);
    expect(stats.runsFinished).toBe(2);
    expect(stats.runsPlanned).toBe(2);
  });

  it("avoids divide-by-zero when nothing is planned", () => {
    const stats = aggregateDaySummary({
      scope: "day",
      date: "x",
      runs: [run({ casesPlanned: 0, casesProduced: 0 })],
    });
    expect(stats.attainmentPct).toBe(0);
  });

  it("ranks worst downtime and collects unfinished runs", () => {
    const stats = aggregateDaySummary({
      scope: "day",
      date: "x",
      runs: [
        run({ brand: "A", flavor: "X", downtimeMinutes: 5, stoppageCount: 1 }),
        run({ brand: "B", flavor: "Y", downtimeMinutes: 20, stoppageCount: 2, finished: false }),
        run({ brand: "C", flavor: "Z", downtimeMinutes: 10, stoppageCount: 1 }),
      ],
    });
    expect(stats.totalDowntimeMinutes).toBe(35);
    expect(stats.totalStoppages).toBe(4);
    expect(stats.topDowntime).toEqual({ label: "B Y", minutes: 20 });
    expect(stats.unfinishedRuns).toEqual(["B Y"]);
    expect(stats.runsFinished).toBe(2);
  });

  it("ignores negative / non-finite values defensively", () => {
    const stats = aggregateDaySummary({
      scope: "week",
      date: "x",
      runs: [run({ casesPlanned: -5, casesProduced: Number.NaN, downtimeMinutes: -3, stoppageCount: -1 })],
      incidentCount: -2,
      wasteFlaggedCount: 3.7,
    });
    expect(stats.casesPlanned).toBe(0);
    expect(stats.casesProduced).toBe(0);
    expect(stats.totalDowntimeMinutes).toBe(0);
    expect(stats.totalStoppages).toBe(0);
    expect(stats.incidentCount).toBe(0);
    expect(stats.wasteFlaggedCount).toBe(4);
    expect(stats.scope).toBe("week");
  });
});

describe("buildSummaryPromptBlock", () => {
  it("states plainly when there is no data", () => {
    const stats = aggregateDaySummary({ scope: "day", date: "2026-06-24", runs: [] });
    expect(buildSummaryPromptBlock(stats)).toContain("none recorded");
  });

  it("includes case, downtime and unfinished facts", () => {
    const input: DaySummaryInput = {
      scope: "day",
      date: "2026-06-24",
      runs: [run({ casesPlanned: 100, casesProduced: 90, downtimeMinutes: 12, stoppageCount: 2, finished: false, brand: "A", flavor: "B" })],
      incidentCount: 1,
    };
    const block = buildSummaryPromptBlock(aggregateDaySummary(input));
    expect(block).toContain("90 produced of 100 planned");
    expect(block).toContain("12 min");
    expect(block).toContain("UNFINISHED: A B");
    expect(block).toContain("INCIDENTS REPORTED: 1");
  });
});

describe("buildFallbackSummary", () => {
  it("is never blank, even with no data", () => {
    const stats = aggregateDaySummary({ scope: "week", date: "x", runs: [] });
    expect(buildFallbackSummary(stats)).toMatch(/No production runs/);
  });

  it("produces a readable recap with downtime and misses", () => {
    const input: DaySummaryInput = {
      scope: "day",
      date: "2026-06-24",
      runs: [
        run({ brand: "A", flavor: "X", casesPlanned: 100, casesProduced: 100 }),
        run({ brand: "B", flavor: "Y", casesPlanned: 100, casesProduced: 40, finished: false, downtimeMinutes: 15, stoppageCount: 1 }),
      ],
      incidentCount: 1,
    };
    const text = buildFallbackSummary(aggregateDaySummary(input));
    expect(text).toContain("70% attainment");
    expect(text).toContain("downtime");
    expect(text).toContain("Did not finish: B Y");
    expect(text).toContain("1 issue reported");
  });
});
