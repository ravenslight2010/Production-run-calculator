import { describe, expect, it } from "vitest";
import { createWallClockBookkeeping, getAutoTrackTiming, tickWallClock } from "./wallClockEngine";

describe("tickWallClock", () => {
  const dueInput = () => {
    const timing = getAutoTrackTiming(60, 12, 6, 24, { spinSec: 24, hopperSec: 12 });
    return {
      bookkeeping: {
        ...createWallClockBookkeeping(),
        caseNextDueMs: 1,
        trayProdNextDueMs: 1,
        trayConsNextDueMs: 1,
        batchProdNextDueMs: 1,
        batchConsNextDueMs: 1,
        hopperNextDueMs: 1,
        lastExpectedCases: 0,
      },
      nowMs: 13_000,
      timing,
      runStatus: "running" as const,
      drainActive: false,
      packagingDrainActive: false,
      packagingAutoTrackActive: true,
      caseSuppressed: false,
      doughSuppressed: false,
      calc: { ppm: 60, perTray: 6, perBatch: 24, pressDone: false, casesInFreezer: 0, traysNeeded: 2, batchesNeeded: 2 },
      v: { pizzasPerCase: 12, casesPerSkid: 48, casesNeeded: 100, traysOnLine: 1, batchesReady: 1 },
      form: { skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 1, batchesReady: 1 },
      expectedCasesRaw: 1,
      expectedCases: 1,
    };
  };

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

  it("advances due bookkeeping but emits no server-owned wall-clock claims", () => {
    const input = dueInput();
    const result = tickWallClock({
      ...input,
      serverOwnedChannels: {
        case: true,
        "tray-consume": true,
        "tray-produce": true,
        "batch-consume": true,
        "batch-produce": true,
        hopper: true,
      },
    });
    expect(result.events).toEqual([]);
    expect(result.next.caseNextDueMs).toBeGreaterThan(input.nowMs);
    expect(result.next.trayConsNextDueMs).toBeGreaterThan(input.nowMs);
    expect(result.next.batchConsNextDueMs).toBeGreaterThan(input.nowMs);
    expect(result.next.hopperNextDueMs).toBeGreaterThan(input.nowMs);
  });

  it("restores local claims automatically when no server ownership is supplied", () => {
    const result = tickWallClock(dueInput());
    expect(result.events.some((event) => event.channel === "case")).toBe(true);
    expect(result.events.some((event) => event.channel === "hopper")).toBe(true);
    expect(result.events.some((event) => event.channel.startsWith("batch-"))).toBe(true);
  });

  it("does not consume a one-shot seed while the server owns that channel", () => {
    const input = dueInput();
    const first = tickWallClock({
      ...input,
      bookkeeping: { ...input.bookkeeping, traySeeded: false },
      v: { ...input.v, traysOnLine: 0 },
      form: { ...input.form, traysOnLine: 0 },
      serverOwnedChannels: { "tray-consume": true },
    });
    expect(first.events.some((event) => event.channel === "tray-consume")).toBe(false);
    expect(first.next.traySeeded).toBe(false);

    const fallback = tickWallClock({
      ...input,
      bookkeeping: { ...first.next, trayConsNextDueMs: input.nowMs },
      v: { ...input.v, traysOnLine: 0 },
      form: { ...input.form, traysOnLine: 0 },
    });
    expect(fallback.events.find((event) => event.channel === "tray-consume")?.mutations[0].to).toBeGreaterThan(0);
    expect(fallback.next.traySeeded).toBe(true);
  });
});