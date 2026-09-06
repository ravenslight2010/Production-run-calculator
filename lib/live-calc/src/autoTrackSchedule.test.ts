import { describe, expect, it } from "vitest";
import {
  computeAutoTrackElapsedMs,
  computeAutoTrackSchedule,
  type AutoTrackScheduleChannel,
  type AutoTrackScheduleInput,
} from "./autoTrackSchedule";
import type { Calc, CalcFormValues } from "./index";

function makeFormValues(overrides: Partial<CalcFormValues> = {}): CalcFormValues {
  return {
    approxLineSpeed: 0,
    speedAdjustment: 1,
    freezerTime: 5,
    crustsPerCycle: 0,
    cycleSpeed: 0,
    pizzasPerCase: 12,
    casesPerSkid: 8,
    casesPerLayer: 0,
    doughballsPerTray: 30,
    crustsPerStack: 30,
    doughBatchYield: 100,
    crustsPerCase: 12,
    casesNeeded: 100,
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
    traysOnLine: 0,
    batchesReady: 0,
    targetDoughballWeight: 0,
    doughRecipe: [],
    sauceBarrelLbs: 50,
    sauceOzPerPizza: 4,
    frontlineRecipe: [],
    app1OzPerPizza: 4, app1BatchLbs: 50, app1Type: "Cheese", app1CheeseRecipe: [],
    app2OzPerPizza: 4, app2BatchLbs: 50, app2Type: "Cheese", app2CheeseRecipe: [],
    app3OzPerPizza: 4, app3BatchLbs: 50, app3Type: "Cheese", app3CheeseRecipe: [],
    app4OzPerPizza: 4, app4BatchLbs: 50, app4Type: "Cheese", app4CheeseRecipe: [],
    pep1OzPerPizza: 0, pep1Sticks: 0, pep1BatchLbs: 0, pep1Type: "",
    pep2OzPerPizza: 0, pep2Sticks: 0, pep2BatchLbs: 0, pep2Type: "",
    pep1Combined: true,
    pep1TypeB: "", pep1OzPerPizzaB: 0, pep1SticksB: 0, pep1BatchLbsB: 0,
    pep2TypeB: "", pep2OzPerPizzaB: 0, pep2SticksB: 0, pep2BatchLbsB: 0,
    ...overrides,
  };
}

/** Minimal Calc with the fields the scheduler reads. */
function makeCalc(overrides: Partial<Calc> = {}): Calc {
  return {
    ppm: 60,
    traysPerSkid: 0,
    traysPerBatch: 0,
    batchesPerSkid: 0,
    casesOnLine: 0,
    casesInFreezer: 0,
    casesLeftToRun: 0,
    casesLeftToOpen: 0,
    stacksNeededTotal: 0,
    casesForTiming: 0,
    batchesNeeded: 0,
    traysNeeded: 0,
    buffer: 0,
    doughShortCases: 0,
    doughDepletionSec: 0,
    casesOnLastSkid: 0,
    timePressHzSec: 0,
    timePerTraySec: 0,
    timePerBatchSec: 0,
    timePerSkidSec: 0,
    timePerCaseSec: 0,
    totalTimeSec: 0,
    adjustedTimeSec: 0,
    pressCasesLeft: 0,
    pressDone: false,
    extraCases: 0,
    doughMadeTimeSec: 0,
    rackTimes: [],
    sauceBatches: 0,
    sauceEffBarrel: 0,
    sauceDepletionSec: 0,
    app1Lbs: 0, app1Batches: 0,
    app2Lbs: 0, app2Batches: 0,
    app3Lbs: 0, app3Batches: 0,
    app4Lbs: 0, app4Batches: 0,
    paceDelta: 0,
    pep1Lbs: 0, pep1Batches: 0,
    pep2Lbs: 0, pep2Batches: 0,
    pep1LbsB: 0, pep1BatchesB: 0,
    pep2LbsB: 0, pep2BatchesB: 0,
    casesCompleted: 0,
    paceStatus: null,
    catchUpPpm: null,
    ...overrides,
  } as Calc;
}

function makeInput(overrides: Partial<AutoTrackScheduleInput> = {}): AutoTrackScheduleInput {
  return {
    runId: "run-1",
    metaUpdatedAt: 2,
    startedAt: 100_000,
    pausedAt: undefined,
    endedAt: undefined,
    stoppages: [],
    v: makeFormValues(),
    calc: makeCalc(),
    progress: {},
    coordination: {},
    nowMs: 100_000 + 10 * 60 * 1000, // 10 minutes into the run
    ...overrides,
  };
}

const entry = (schedule: ReturnType<typeof computeAutoTrackSchedule>, channel: AutoTrackScheduleChannel) =>
  schedule.entries.find((e) => e.channel === channel);

describe("computeAutoTrackElapsedMs", () => {
  it("excludes closed non-pause stoppages", () => {
    const ms = computeAutoTrackElapsedMs({
      startedAt: 0,
      nowMs: 10_000,
      stoppages: [{ id: "s1", type: "downtime", startedAt: 2_000, endedAt: 4_000 }],
    });
    expect(ms).toBe(8_000);
  });

  it("does NOT subtract closed pause stoppages (startedAt is rebased on resume)", () => {
    const ms = computeAutoTrackElapsedMs({
      startedAt: 10_000,
      nowMs: 30_000,
      // A closed pause from the pre-rebase era is parked in the stoppages list,
      // but startedAt was already moved forward by applyResumeToRun — double
      // subtraction would undercount the net clock.
      stoppages: [{ id: "s1", type: "pause", startedAt: 5_000, endedAt: 15_000 }],
    });
    expect(ms).toBe(20_000);
  });

  it("freezes at pausedAt while the run is paused", () => {
    const ms = computeAutoTrackElapsedMs({
      startedAt: 0,
      pausedAt: 20_000,
      nowMs: 60_000,
    });
    expect(ms).toBe(20_000);
  });
});

describe("computeAutoTrackSchedule — sauce barrel", () => {
  it("computes dueAt = anchor + cadence and nextDue = dueAt + cadence", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      calc: makeCalc({ ppm: 60, sauceDepletionSec: 200 }), // barrel every 200 net-sec
      progress: { sauceBarrelsMade: 3, sauceBarrelAnchorNetSec: 600, sauceBarrelCorrectionGeneration: 0 },
    }));
    const sauce = entry(schedule, "sauce-barrel");
    expect(sauce).toBeDefined();
    expect(sauce!.dueAt).toBe(800);
    expect(sauce!.nextDueAt).toBe(1000);
  });

  it("reports dueNow once net elapsed passes the due time (not wall time)", () => {
    // 10 min net elapsed = 600 net-sec; anchor 600 + cadence 200 → due at 800.
    const schedule = computeAutoTrackSchedule(makeInput({
      calc: makeCalc({ ppm: 60, sauceDepletionSec: 200 }),
      progress: { sauceBarrelsMade: 3, sauceBarrelAnchorNetSec: 600, sauceBarrelCorrectionGeneration: 0 },
    }));
    expect(entry(schedule, "sauce-barrel")!.dueNow).toBe(false);

    const due = computeAutoTrackSchedule(makeInput({
      calc: makeCalc({ ppm: 60, sauceDepletionSec: 200 }),
      progress: { sauceBarrelsMade: 3, sauceBarrelAnchorNetSec: 400, sauceBarrelCorrectionGeneration: 0 },
      nowMs: 100_000 + 11 * 60 * 1000, // 11 min → 660 net-sec > 600 due
    }));
    expect(entry(due, "sauce-barrel")!.dueNow).toBe(true);
  });

  it("omits sauce when pressDone (run satisfied)", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      calc: makeCalc({ ppm: 60, sauceDepletionSec: 200, pressDone: true }),
    }));
    expect(entry(schedule, "sauce-barrel")).toBeUndefined();
  });

  it("omits sauce while the run is paused or ended", () => {
    const paused = computeAutoTrackSchedule(makeInput({
      pausedAt: 105_000,
      calc: makeCalc({ ppm: 60, sauceDepletionSec: 200 }),
    }));
    expect(entry(paused, "sauce-barrel")).toBeUndefined();

    const ended = computeAutoTrackSchedule(makeInput({
      endedAt: 105_000,
      calc: makeCalc({ ppm: 60, sauceDepletionSec: 200 }),
    }));
    expect(entry(ended, "sauce-barrel")).toBeUndefined();
  });
});

describe("computeAutoTrackSchedule — applicator batches", () => {
  it("computes per-slot cadence from effective batch lbs and caps at required", () => {
    // batchLbs 50 @ 4 oz/pizza, 60 ppm → (50*16/4/60)*60 = 200 sec cadence.
    const schedule = computeAutoTrackSchedule(makeInput({
      calc: makeCalc({ ppm: 60, app1Batches: 5 }),
      progress: { app1BatchesMade: 2, app1BatchAnchorNetSec: 400, app1BatchCorrectionGeneration: 0 },
    }));
    const app1 = entry(schedule, "app1-batch");
    expect(app1).toBeDefined();
    expect(app1!.dueAt).toBe(600);
    expect(app1!.nextDueAt).toBe(800);
    expect(app1!.dueNow).toBe(true); // 600 net-sec elapsed >= 600 due
  });

  it("gates off mix-type rows", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      v: makeFormValues({ app1Type: "Cheese Mix" }),
      calc: makeCalc({ ppm: 60, app1Batches: 5 }),
    }));
    expect(entry(schedule, "app1-batch")).toBeUndefined();
  });

  it("gates off a slot that already reached its required batches", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      calc: makeCalc({ ppm: 60, app1Batches: 2 }),
      progress: { app1BatchesMade: 2, app1BatchAnchorNetSec: 0, app1BatchCorrectionGeneration: 0 },
    }));
    expect(entry(schedule, "app1-batch")).toBeUndefined();
  });
});

describe("computeAutoTrackSchedule — wall-clock channels", () => {
  it("echoes the canonical coordination nextDueAt for case when present", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      coordination: {
        case: { generation: "run-1:2", sequence: 4, nextDueAt: 100_000 + 63_000 },
      },
    }));
    const caseEntry = entry(schedule, "case");
    expect(caseEntry).toBeDefined();
    expect(caseEntry!.dueAt).toBe(100_000 + 63_000);
    expect(caseEntry!.canonical).toBe(true);
    expect(caseEntry!.sequence).toBe(4);
  });

  it("derives a compute-only replay for wall-clock channels without a coordination record (Task 2)", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      startedAt: 100_000,
      nowMs: 100_000 + 10 * 60 * 1000, // 10 minutes into the run
      calc: makeCalc({ ppm: 60, perTray: 60, perBatch: 600 }),
      machine: { spinSec: 0, hopperSec: 30 },
    }));
    const caseEntry = entry(schedule, "case");
    expect(caseEntry).toBeDefined();
    expect(caseEntry!.canonical).toBe(false);
    // caseMs = 12s; immediate start tick + 50 full periods → due at +51*12s.
    expect(caseEntry!.dueAt).toBe(100_000 + (Math.floor(600_000 / 12_000) + 1) * 12_000);
    expect(caseEntry!.dueNow).toBe(false);
    expect(entry(schedule, "tray-consume")).toBeDefined();
    expect(entry(schedule, "tray-produce")).toBeDefined();
    expect(entry(schedule, "batch-consume")).toBeDefined();
    expect(entry(schedule, "batch-produce")).toBeDefined();
    expect(entry(schedule, "hopper")).toBeDefined();
  });

  it("keeps the canonical coordination echo authoritative over the replay", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      startedAt: 100_000,
      nowMs: 100_000 + 10 * 60 * 1000,
      calc: makeCalc({ ppm: 60, perTray: 60, perBatch: 600 }),
      coordination: {
        case: { generation: "run-1:2", sequence: 4, nextDueAt: 123_456 },
      },
    }));
    expect(entry(schedule, "case")).toMatchObject({ canonical: true, dueAt: 123_456, sequence: 4 });
    // The channel without canonical state still gets the engine replay.
    expect(entry(schedule, "tray-consume")).toBeDefined();
  });

  it("gates the replay off for paused runs (client keeps arming locally)", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      startedAt: 100_000,
      pausedAt: 200_000,
      nowMs: 300_000,
      calc: makeCalc({ ppm: 60, perTray: 60, perBatch: 600 }),
    }));
    expect(entry(schedule, "case")).toBeUndefined();
    expect(entry(schedule, "tray-consume")).toBeUndefined();
    expect(entry(schedule, "hopper")).toBeUndefined();
  });

  it("reports dueNow for a canonical case entry whose nextDueAt has passed", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      coordination: {
        case: { generation: "run-1:2", sequence: 4, nextDueAt: 100_000 + 1 },
      },
    }));
    expect(entry(schedule, "case")!.dueNow).toBe(true);
  });

  it("still echoes the case drain window after End (freezerTime minutes)", () => {
    const endedAt = 100_000 + 10 * 60 * 1000;
    const schedule = computeAutoTrackSchedule(makeInput({
      endedAt,
      coordination: {
        case: { generation: "run-1:2", sequence: 5, nextDueAt: endedAt + 30_000 },
      },
    }));
    expect(entry(schedule, "case")).toBeDefined();
    // Past the drain window the entry disappears.
    const afterDrain = computeAutoTrackSchedule(makeInput({
      endedAt,
      nowMs: endedAt + 5 * 60 * 1000 + 1, // freezerTime = 5 min
      coordination: {
        case: { generation: "run-1:2", sequence: 5, nextDueAt: endedAt + 30_000 },
      },
    }));
    expect(entry(afterDrain, "case")).toBeUndefined();
  });
});

describe("computeAutoTrackSchedule — run identity", () => {
  it("builds the client-compatible generation string", () => {
    const schedule = computeAutoTrackSchedule(makeInput({ runId: "run-9", metaUpdatedAt: 123 }));
    expect(schedule.generation).toBe("run-9:123");
  });

  it("falls back to startedAt when metaUpdatedAt is absent", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      runId: "run-9",
      metaUpdatedAt: undefined,
      startedAt: 55,
    }));
    expect(schedule.generation).toBe("run-9:55");
  });

  it("omits everything for a not-yet-started run", () => {
    const schedule = computeAutoTrackSchedule(makeInput({
      startedAt: undefined,
      calc: makeCalc({ ppm: 60, sauceDepletionSec: 200 }),
    }));
    expect(schedule.entries).toEqual([]);
  });
});
