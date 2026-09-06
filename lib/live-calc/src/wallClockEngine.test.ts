import { describe, expect, it } from "vitest";
import {
  computeWallClockDueRefs,
  createWallClockBookkeeping,
  rearmWallClockTimers,
  tickWallClock,
  type WallClockBookkeeping,
  type WallClockTickInput,
} from "./wallClockEngine";

// ppm=100, pizzasPerCase=12 → caseMs 7.2s; perTray=60 → trayMs 36s (prod 18s);
// perBatch=600 → lineBatch 360s, batchCons 90s.
function makeTiming(overrides: Partial<ReturnType<typeof makeTimingCore>> = {}) {
  return { ...makeTimingCore(), ...overrides };
}
function makeTimingCore() {
  return {
    caseMs: 7200,
    trayMs: 36000,
    trayProductionMs: 18000,
    batchConsumptionMs: 90000,
    batchProductionMs: 360000,
    hopperMs: 0,
  };
}

function makeInput(overrides: Partial<WallClockTickInput> = {}): WallClockTickInput {
  return {
    bookkeeping: createWallClockBookkeeping(),
    nowMs: 5_000,
    timing: makeTiming(),
    runStatus: "running",
    drainActive: false,
    packagingDrainActive: false,
    packagingAutoTrackActive: true,
    caseSuppressed: false,
    doughSuppressed: false,
    calc: {
      ppm: 100, perTray: 60, perBatch: 600, pressDone: false,
      casesInFreezer: 0, traysNeeded: 2, batchesNeeded: 1,
    },
    v: { pizzasPerCase: 12, casesPerSkid: 8, casesNeeded: 100, traysOnLine: 5, batchesReady: 2 },
    form: { skidsCompleted: 1, casesOnCurrentSkid: 2, traysOnLine: 5, batchesReady: 2 },
    expectedCasesRaw: 100,
    expectedCases: 100,
    ...overrides,
  } as WallClockTickInput;
}

describe("tickWallClock — cases", () => {
  it("baselines the first tick without writing when progress already exists", () => {
    const { next, events } = tickWallClock(makeInput());
    expect(events.map((e) => e.channel)).toEqual(["tray-consume", "batch-consume"]);
    expect(next.lastExpectedCases).toBe(100);
    expect(next.caseNextDueMs).toBe(5_000 + 7_200);
    expect(next.drainFreezer).toBe(0);
  });

  it("seeds the case counter from zero on the first tick", () => {
    const { events } = tickWallClock(makeInput({
      form: { skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 5, batchesReady: 2 },
      v: { pizzasPerCase: 12, casesPerSkid: 8, casesNeeded: 100, traysOnLine: 5, batchesReady: 2 },
    }));
    const caseEvent = events.find((e) => e.channel === "case");
    expect(caseEvent).toBeDefined();
    expect(caseEvent!.mutations).toEqual([
      { field: "skidsCompleted", from: 0, to: 12 },
      { field: "casesOnCurrentSkid", from: 0, to: 4 },
    ]);
  });

  it("writes the incremental case delta on the next tick", () => {
    const first = tickWallClock(makeInput());
    const { events } = tickWallClock(makeInput({
      bookkeeping: first.next,
      nowMs: 20_000,
      expectedCasesRaw: 125,
      expectedCases: 100,
    }));
    const caseEvent = events.find((e) => e.channel === "case");
    expect(caseEvent!.mutations).toEqual([
      { field: "skidsCompleted", from: 1, to: 4 },
      { field: "casesOnCurrentSkid", from: 2, to: 3 },
    ]);
  });

  it("skips one tick on a stale delta, then writes ~1 case", () => {
    const bookkeeping = createWallClockBookkeeping();
    bookkeeping.lastExpectedCases = 468;
    const first = tickWallClock(makeInput({
      bookkeeping,
      nowMs: 0,
      form: { skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 },
      expectedCasesRaw: 522,
      expectedCases: 100,
    }));
    expect(first.events.find((e) => e.channel === "case")).toBeUndefined();
    expect(first.next.formResetSkipped).toBe(true);
    expect(first.next.lastExpectedCases).toBe(522);

    const second = tickWallClock(makeInput({
      bookkeeping: first.next,
      nowMs: 7_201,
      form: { skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 },
      expectedCasesRaw: 523,
      expectedCases: 100,
    }));
    const caseEvent = second.events.find((e) => e.channel === "case");
    expect(caseEvent!.mutations).toEqual([
      { field: "skidsCompleted", from: 0, to: 0 },
      { field: "casesOnCurrentSkid", from: 0, to: 1 },
    ]);
  });

  it("clamps the case total to casesNeeded", () => {
    const bookkeeping = createWallClockBookkeeping();
    bookkeeping.lastExpectedCases = 100;
    bookkeeping.caseNextDueMs = 5_000 + 7_200;
    const { events } = tickWallClock(makeInput({
      bookkeeping,
      nowMs: 20_000,
      expectedCasesRaw: 1_210,
      expectedCases: 1_000,
    }));
    const caseEvent = events.find((e) => e.channel === "case");
    expect(caseEvent!.mutations).toEqual([
      { field: "skidsCompleted", from: 1, to: 12 },
      { field: "casesOnCurrentSkid", from: 2, to: 4 },
    ]);
  });
});

describe("tickWallClock — dough trays/batches", () => {
  it("carries a fractional tray remainder across ticks", () => {
    const bookkeeping = createWallClockBookkeeping();
    // lastMs is one partial period behind the due boundary (e.g. after a line
    // speed rebase), so each completed interval consumes < 1 tray.
    bookkeeping.trayConsNextDueMs = 72_000;
    bookkeeping.trayLastMs = 54_000;
    bookkeeping.trayProdNextDueMs = 99_999_999; // keep production out of this test
    bookkeeping.traySeeded = true;
    bookkeeping.caseNextDueMs = 99_999_999; // keep the case block out of this test
    bookkeeping.batchConsNextDueMs = 99_999_999;
    bookkeeping.batchProdNextDueMs = 99_999_999;

    const t1 = tickWallClock(makeInput({ bookkeeping, nowMs: 72_000 }));
    expect(t1.events).toEqual([]);
    expect(t1.next.traysRemainder).toBeCloseTo(0.5);

    const t2 = tickWallClock(makeInput({ bookkeeping: t1.next, nowMs: 108_000 }));
    const t2Event = t2.events.find((e) => e.channel === "tray-consume");
    expect(t2Event!.mutations).toEqual([{ field: "traysOnLine", from: 5, to: 4 }]);
    expect(t2.next.traysRemainder).toBeCloseTo(0.5);

    const t3 = tickWallClock(makeInput({
      bookkeeping: t2.next,
      nowMs: 144_000,
      v: { pizzasPerCase: 12, casesPerSkid: 8, casesNeeded: 100, traysOnLine: 4, batchesReady: 2 },
      form: { skidsCompleted: 1, casesOnCurrentSkid: 2, traysOnLine: 4, batchesReady: 2 },
    }));
    const trayEvent = t3.events.find((e) => e.channel === "tray-consume");
    expect(trayEvent).toBeDefined();
    expect(trayEvent!.mutations).toEqual([{ field: "traysOnLine", from: 4, to: 3 }]);
    expect(t3.next.traysRemainder).toBeCloseTo(0.5);
  });

  it("seeds an untouched 0 tray counter from the suggest formula once", () => {
    const bookkeeping = createWallClockBookkeeping();
    bookkeeping.trayConsNextDueMs = 36_000;
    bookkeeping.trayProdNextDueMs = 99_999_999;
    bookkeeping.caseNextDueMs = 99_999_999;
    bookkeeping.batchConsNextDueMs = 99_999_999;
    bookkeeping.batchProdNextDueMs = 99_999_999;
    const t1 = tickWallClock(makeInput({
      bookkeeping,
      nowMs: 36_000,
      v: { pizzasPerCase: 12, casesPerSkid: 8, casesNeeded: 100, traysOnLine: 0, batchesReady: 2 },
      form: { skidsCompleted: 1, casesOnCurrentSkid: 2, traysOnLine: 0, batchesReady: 2 },
    }));
    const seed = t1.events.find((e) => e.channel === "tray-consume");
    expect(seed!.mutations).toEqual([{ field: "traysOnLine", from: 0, to: 2 }]);
    expect(t1.next.traySeeded).toBe(true);

    const t2 = tickWallClock(makeInput({
      bookkeeping: t1.next,
      nowMs: 72_000,
      v: { pizzasPerCase: 12, casesPerSkid: 8, casesNeeded: 100, traysOnLine: 2, batchesReady: 2 },
      form: { skidsCompleted: 1, casesOnCurrentSkid: 2, traysOnLine: 2, batchesReady: 2 },
    }));
    const consume = t2.events.find((e) => e.channel === "tray-consume");
    expect(consume!.mutations).toEqual([{ field: "traysOnLine", from: 2, to: 1 }]);
  });

  it("seeds an untouched 0 batch counter from the remaining deficit", () => {
    const bookkeeping = createWallClockBookkeeping();
    bookkeeping.batchConsNextDueMs = 90_000;
    bookkeeping.caseNextDueMs = 99_999_999;
    bookkeeping.trayConsNextDueMs = 99_999_999;
    bookkeeping.trayProdNextDueMs = 99_999_999;
    bookkeeping.traySeeded = true; // trays already seeded earlier, no coverage this tick
    const { events } = tickWallClock(makeInput({
      bookkeeping,
      nowMs: 90_000,
      calc: { ppm: 100, perTray: 60, perBatch: 600, pressDone: false, casesInFreezer: 0, traysNeeded: 0, batchesNeeded: 1 },
      v: { pizzasPerCase: 12, casesPerSkid: 8, casesNeeded: 100, traysOnLine: 0, batchesReady: 0 },
      form: { skidsCompleted: 1, casesOnCurrentSkid: 2, traysOnLine: 0, batchesReady: 0 },
    }));
    const seed = events.find((e) => e.channel === "batch-consume");
    expect(seed!.mutations).toEqual([{ field: "batchesReady", from: 0, to: 1 }]);
  });

  it("stops dough writes once the press is done but keeps cadence advancing", () => {
    const bookkeeping = createWallClockBookkeeping();
    bookkeeping.trayConsNextDueMs = 36_000;
    bookkeeping.trayProdNextDueMs = 99_999_999;
    bookkeeping.traySeeded = true;
    bookkeeping.batchConsNextDueMs = 36_000;
    bookkeeping.batchProdNextDueMs = 36_000;
    // Case uses its own first-tick baseline (pressDone does NOT stop cases).
    const t1 = tickWallClock(makeInput({
      bookkeeping,
      nowMs: 36_000,
      calc: { ppm: 100, perTray: 60, perBatch: 600, pressDone: true, casesInFreezer: 0, traysNeeded: 2, batchesNeeded: 1 },
    }));
    expect(t1.events.find((e) => e.channel === "tray-consume")).toBeUndefined();
    expect(t1.events.find((e) => e.channel === "batch-consume")).toBeUndefined();
    expect(t1.next.trayConsNextDueMs).toBe(72_000);
    expect(t1.next.batchConsNextDueMs).toBe(126_000);
  });

  it("suppresses writes inside the manual-edit window but advances refs", () => {
    const bookkeeping = createWallClockBookkeeping();
    bookkeeping.trayConsNextDueMs = 36_000;
    bookkeeping.lastExpectedCases = -1;
    const { next, events } = tickWallClock(makeInput({
      bookkeeping,
      nowMs: 40_000,
      caseSuppressed: true,
      doughSuppressed: true,
    }));
    expect(events).toEqual([]);
    expect(next.caseNextDueMs).toBe(47_200);
    expect(next.trayConsNextDueMs).toBe(76_000);
    expect(next.lastExpectedCases).toBe(100);
  });
});

describe("tickWallClock — dough pause", () => {
  it("blocks dough ticks while paused without touching case", () => {
    const bookkeeping = createWallClockBookkeeping();
    bookkeeping.doughPausedAtMs = 10_000;
    bookkeeping.doughResumeAtMs = 0;
    const { next, events } = tickWallClock(makeInput({ bookkeeping, nowMs: 10_001 }));
    expect(events.find((e) => e.channel === "tray-consume")).toBeUndefined();
    expect(events.find((e) => e.channel === "batch-consume")).toBeUndefined();
    expect(next.trayConsNextDueMs).toBe(0); // never armed/advanced
    expect(next.caseNextDueMs).toBe(10_001 + 7_200); // case still ticks
  });

  it("re-arms every dough timer when a timed pause expires", () => {
    const bookkeeping = createWallClockBookkeeping();
    bookkeeping.doughPausedAtMs = 10_000;
    bookkeeping.doughResumeAtMs = 20_000;
    const { next, events } = tickWallClock(makeInput({ bookkeeping, nowMs: 20_001 }));
    expect(events).toEqual([]);
    expect(next.doughPausedAtMs).toBe(0);
    expect(next.trayConsNextDueMs).toBe(20_001 + 36_000);
    expect(next.trayProdNextDueMs).toBe(20_001 + 18_000);
    expect(next.trayLastMs).toBe(0);
  });
});

describe("tickWallClock — hopper display cycle", () => {
  it("arms once, then emits a display-only cycle event each hopper period", () => {
    const bookkeeping = createWallClockBookkeeping();
    const timing = makeTiming({ hopperMs: 30_000 });
    const t1 = tickWallClock(makeInput({ bookkeeping, nowMs: 1_000, timing }));
    expect(t1.events.find((e) => e.channel === "hopper")).toBeUndefined();
    expect(t1.next.hopperNextDueMs).toBe(31_000);

    const t2 = tickWallClock(makeInput({ bookkeeping: t1.next, nowMs: 31_000, timing }));
    const hopper = t2.events.find((e) => e.channel === "hopper");
    expect(hopper).toBeDefined();
    expect(hopper!.mutations).toEqual([]);
    expect(t2.next.hopperNextDueMs).toBe(61_000);
  });
});

describe("rearmWallClockTimers", () => {
  it("arms every timer from a full configured period", () => {
    const next = rearmWallClockTimers(createWallClockBookkeeping(), 12_000, makeTiming({ hopperMs: 30_000 }));
    expect(next.caseNextDueMs).toBe(12_000 + 7_200);
    expect(next.trayConsNextDueMs).toBe(12_000 + 36_000);
    expect(next.trayProdNextDueMs).toBe(12_000 + 18_000);
    expect(next.batchConsNextDueMs).toBe(12_000 + 90_000);
    expect(next.hopperNextDueMs).toBe(12_000 + 30_000);
    expect(next.trayLastMs).toBe(0);
    expect(next.doughPausedAtMs).toBe(0);
  });
});

describe("computeWallClockDueRefs — replay", () => {
  const timing = {
    caseMs: 6_000,
    trayMs: 36_000,
    trayProductionMs: 18_000,
    batchConsumptionMs: 90_000,
    batchProductionMs: 360_000,
    hopperMs: 30_000,
  };

  it("replays due refs from run start for a fresh running run", () => {
    const due = computeWallClockDueRefs({ startedAt: 0, nowMs: 36_000, stoppages: [], timing })!;
    expect(due.caseDueMs).toBe(42_000); // immediate tick + 6 full periods
    expect(due.trayConsDueMs).toBe(72_000);
    expect(due.trayProdDueMs).toBe(54_000);
    expect(due.batchConsDueMs).toBe(90_000);
    expect(due.batchProdDueMs).toBe(360_000);
    expect(due.hopperDueMs).toBe(60_000);
  });

  it("re-phases dough timers on resume (pause splits the replay)", () => {
    const due = computeWallClockDueRefs({
      startedAt: 0,
      nowMs: 36_000,
      stoppages: [{ type: "pause", startedAt: 10_000, endedAt: 20_000 }],
      timing,
    })!;
    expect(due.caseDueMs).toBe(38_000); // seg2: 20000 + (floor(16000/6000)+1)*6000
    expect(due.trayConsDueMs).toBe(56_000); // seg2: 20000 + (0+1)*36000
  });

  it("keeps non-pause downtime inside one running segment", () => {
    const due = computeWallClockDueRefs({
      startedAt: 0,
      nowMs: 36_000,
      stoppages: [{ type: "breakdown", startedAt: 5_000, endedAt: 9_000 }],
      timing,
    })!;
    expect(due.caseDueMs).toBe(42_000);
  });

  it("returns null without a valid startedAt", () => {
    expect(computeWallClockDueRefs({ startedAt: undefined, nowMs: 1_000, stoppages: [], timing })).toBeNull();
  });
});
