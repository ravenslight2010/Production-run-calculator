import { describe, expect, it } from "vitest";
import { createWallClockBookkeeping, getAutoTrackTiming, tickWallClock } from "./wallClockEngine";

describe("tickWallClock", () => {
  it("arms a fresh case timer without claiming before its cadence elapses", () => {
    const timing = getAutoTrackTiming(60, 12, 6, 24);
    const result = tickWallClock({
      bookkeeping: createWallClockBookkeeping(), nowMs: 1_000, timing, runStatus: "running",
      drainActive: false, packagingDrainActive: false, packagingAutoTrackActive: true,
      caseSuppressed: false, doughSuppressed: false,
      calc: { ppm: 60, perTray: 6, perBatch: 24, pressDone: false, casesInFreezer: 0, traysNeeded: 0, batchesNeeded: 0 },
      v: { pizzasPerCase: 12, casesPerSkid: 48, casesNeeded: 100, traysOnLine: 1, batchesReady: 1 },
      form: { skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 1, batchesReady: 1 },
      expectedCasesRaw: 0, expectedCases: 0,
    });
    expect(result.next.caseNextDueMs).toBe(13_000);
    expect(result.events.find((event) => event.channel === "case")).toBeUndefined();
  });

  it("uses the shared case decision to increment a due case", () => {
    const timing = getAutoTrackTiming(60, 12, 6, 24);
    const result = tickWallClock({
      bookkeeping: { ...createWallClockBookkeeping(), caseNextDueMs: 1, lastExpectedCases: 0 },
      nowMs: 13_000, timing, runStatus: "running", drainActive: false, packagingDrainActive: false,
      packagingAutoTrackActive: true, caseSuppressed: false, doughSuppressed: false,
      calc: { ppm: 60, perTray: 6, perBatch: 24, pressDone: false, casesInFreezer: 0, traysNeeded: 0, batchesNeeded: 0 },
      v: { pizzasPerCase: 12, casesPerSkid: 48, casesNeeded: 100, traysOnLine: 1, batchesReady: 1 },
      form: { skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 1, batchesReady: 1 },
      expectedCasesRaw: 1, expectedCases: 1,
    });
    expect(result.events.find((event) => event.channel === "case")?.mutations).toEqual([
      { field: "skidsCompleted", from: 0, to: 0 },
      { field: "casesOnCurrentSkid", from: 0, to: 1 },
    ]);
  });
});