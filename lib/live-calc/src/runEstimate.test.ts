import { describe, expect, it } from "vitest";
import { estimateRun, type RunEstimateValues } from "./runEstimate";

const values: RunEstimateValues = {
  casesNeeded: 100, pizzasPerCase: 12, approxLineSpeed: 40,
  crustsPerCycle: 2, cycleSpeed: 30, speedAdjustment: 0.8,
  freezerTime: 15, skidsCompleted: 1, casesPerSkid: 40, casesOnCurrentSkid: 10,
};
const start = new Date("2026-10-26T06:00:00").getTime();
describe("explainable packaging-clear estimates", () => {
  it("uses effective dough speed, not the unrelated approximate rate", () => {
    expect(estimateRun(values)).toMatchObject({ ppm: 48, durationSec: 2400, basis: "planned" });
    expect(estimateRun(values, { subTab: "crusts" })).toMatchObject({ ppm: 40, durationSec: 2700 });
  });
  it("honors positive temporary overrides without changing saved values", () => {
    const override = { ...values, tempCycleSpeed: 60, tempFreezerTime: 10 };
    expect(estimateRun(override)).toMatchObject({ ppm: 96, freezerMin: 10, durationSec: 1350 });
    expect(override.freezerTime).toBe(15);
    expect(estimateRun({ ...values, tempCycleSpeed: 0 }).ppm).toBe(48);
  });
  it.each([undefined, 0, -1, NaN, Infinity, -Infinity])("rejects invalid positive inputs: %s", (invalid) => {
    for (const field of ["casesNeeded", "pizzasPerCase", "crustsPerCycle", "cycleSpeed"] as const) {
      const result = estimateRun({ ...values, [field]: invalid });
      expect(result.durationSec).toBeUndefined();
      expect(result.missing.length).toBeGreaterThan(0);
    }
    expect(estimateRun({ ...values, approxLineSpeed: invalid }, { subTab: "crusts" }).durationSec).toBeUndefined();
  });
  it("does not return a freezer-only duration or nonfinite total", () => {
    expect(estimateRun({ freezerTime: 15 }).durationSec).toBeUndefined();
    expect(estimateRun(undefined).durationSec).toBeUndefined();
    expect(estimateRun({ ...values, casesNeeded: Number.MAX_VALUE }).durationSec).toBeUndefined();
    expect(estimateRun({ ...values, freezerTime: 0 }).durationSec).toBe(1500);
    for (const freezerTime of [undefined, "", "unknown", -1, Infinity, NaN]) {
      expect(estimateRun({ ...values, freezerTime }).durationSec).toBeUndefined();
    }
  });
  it("uses recorded progress plus unfilled transit, not a full restart or occupancy capacity", () => {
    // 50 cases × 12 / 48 = 12.5 min; 10 min transit still unfilled.
    expect(estimateRun(values, { startedAt: start }, start + 5 * 60_000)).toMatchObject({
      remainingSec: 1350, completedCases: 50, leadInSec: 600, basis: "live",
    });
    // Once full, remaining packaging = 12.5 minutes, not an extra full freezer.
    expect(estimateRun(values, { startedAt: start }, start + 20 * 60_000).remainingSec).toBe(750);
  });
  it("freezes transit while paused and never counts a stale pause as current time", () => {
    expect(estimateRun(values, { startedAt: start, pausedAt: start + 5 * 60_000 }, start + 6 * 3600_000)).toMatchObject({
      remainingSec: 1350, basis: "paused",
    });
    // The existing resume handler shifts startedAt forward by paused duration.
    expect(estimateRun(values, { startedAt: start + 55 * 60_000 }, start + 60 * 60_000).remainingSec).toBe(1350);
  });
  it("accepts zero remaining and validates progress", () => {
    expect(estimateRun({ ...values, casesOnCurrentSkid: 60 }, { startedAt: start }, start).remainingSec).toBe(0);
    expect(estimateRun({ ...values, casesPerSkid: 0 }, { startedAt: start }, start).remainingSec).toBeUndefined();
    expect(estimateRun({ ...values, casesOnCurrentSkid: NaN }, { startedAt: start }, start).remainingSec).toBeUndefined();
    expect(estimateRun({ ...values, speedAdjustment: NaN }).durationSec).toBeUndefined();
  });
});
