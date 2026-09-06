import { describe, expect, it } from "vitest";
import {
  buildAppSlotClaimMutations,
  buildCaseClaimMutations,
  buildSauceClaimMutations,
  clampWebPeriodMs,
  computeAppSlotInfo,
  computeAutoTrackSuggestion,
  computeBatchTick,
  computeCaseTickWrite,
  computeNetSecondDue,
  computeTrayTick,
  getAutoTrackTiming,
  suggestedDoughStaging,
} from "./autoTrackEngine";

describe("clampWebPeriodMs", () => {
  it("falls back to 1h for invalid/zero/negative inputs (web semantics)", () => {
    expect(clampWebPeriodMs(NaN)).toBe(60 * 60 * 1000);
    expect(clampWebPeriodMs(Infinity)).toBe(60 * 60 * 1000);
    expect(clampWebPeriodMs(0)).toBe(60 * 60 * 1000);
    expect(clampWebPeriodMs(-500)).toBe(60 * 60 * 1000);
  });

  it("floors at the 1s app-clock resolution", () => {
    expect(clampWebPeriodMs(500)).toBe(1000);
    expect(clampWebPeriodMs(999.9)).toBe(1000);
  });

  it("caps at 1h so a garbage rate never freezes a counter", () => {
    expect(clampWebPeriodMs(7200000)).toBe(60 * 60 * 1000);
  });

  it("passes valid mid-range periods through unchanged", () => {
    expect(clampWebPeriodMs(60000)).toBe(60000);
    expect(clampWebPeriodMs(2500)).toBe(2500);
  });
});

describe("suggestedDoughStaging", () => {
  it("returns null when there is no deficit", () => {
    expect(suggestedDoughStaging(0, 0)).toEqual({ trays: null, batches: null });
  });

  it("caps trays at 40 and rounds", () => {
    expect(suggestedDoughStaging(1, 0).trays).toBe(1);
    expect(suggestedDoughStaging(20, 0).trays).toBe(20);
    expect(suggestedDoughStaging(50, 0).trays).toBe(40);
    expect(suggestedDoughStaging(37, 0).trays).toBe(37);
  });

  it("caps batches at 3 and never below 1", () => {
    expect(suggestedDoughStaging(0, 1).batches).toBe(1);
    expect(suggestedDoughStaging(0, 2).batches).toBe(2);
    expect(suggestedDoughStaging(0, 5).batches).toBe(3);
  });
});

describe("getAutoTrackTiming", () => {
  it("computes case cadence from pizzas per case at ppm", () => {
    const timing = getAutoTrackTiming(60, 1, 0, 0);
    expect(timing.caseMs).toBe(1000);
    expect(getAutoTrackTiming(60, 30, 0, 0).caseMs).toBe(30000);
  });

  it("returns zero timings when ppm is missing", () => {
    const timing = getAutoTrackTiming(0, 10, 5, 2);
    expect(timing).toEqual({
      caseMs: 0,
      trayMs: 0,
      trayProductionMs: 0,
      batchConsumptionMs: 0,
      batchProductionMs: 0,
      hopperMs: 0,
    });
  });

  it("clamps pathological tray cadence to 1h", () => {
    expect(getAutoTrackTiming(1, 10, 1000, 0).trayMs).toBe(60 * 60 * 1000);
  });

  it("derives tray production as half the consumption period", () => {
    const timing = getAutoTrackTiming(60, 1, 30, 0);
    expect(timing.trayProductionMs).toBe(timing.trayMs / 2);
    expect(timing.trayMs).toBe(30000);
  });

  it("uses hopper + line demand for consumption and spin for production", () => {
    const timing = getAutoTrackTiming(60, 1, 1, 60, { spinSec: 45, hopperSec: 30 });
    expect(timing.hopperMs).toBe(30000);
    // demand = 60 * 1 batch/min = 60s; drain = max(30s hopper, 60s line) ; /4 = 15s
    expect(timing.batchConsumptionMs).toBe(15000);
    expect(timing.batchProductionMs).toBe(45000);
  });

  it("falls back to line batch time for production without a spin measurement", () => {
    const timing = getAutoTrackTiming(60, 1, 1, 60);
    expect(timing.batchProductionMs).toBe(60000);
    expect(timing.hopperMs).toBe(0);
  });
});

describe("computeAutoTrackSuggestion", () => {
  const base = {
    runStatus: "running" as const,
    drainActive: false,
    packagingDrainActive: false,
    packagingDrainElapsedSec: 0,
    ppm: 120,
    casesPerSkid: 12,
    pizzasPerCase: 10,
    casesNeeded: 100,
    freezerTime: 5,
    elapsedBatchSec: 0,
  };

  it("returns null outside running/paused/drain or without valid rates", () => {
    expect(computeAutoTrackSuggestion({ ...base, runStatus: "pending" })).toBeNull();
    expect(computeAutoTrackSuggestion({ ...base, runStatus: "ended" })).toBeNull();
    expect(computeAutoTrackSuggestion({ ...base, ppm: 0 })).toBeNull();
    expect(computeAutoTrackSuggestion({ ...base, casesPerSkid: 0 })).toBeNull();
    expect(computeAutoTrackSuggestion({ ...base, pizzasPerCase: 0 })).toBeNull();
  });

  it("subtracts the freezer tunnel offset from run elapsed", () => {
    const suggestion = computeAutoTrackSuggestion({ ...base, elapsedBatchSec: 600 });
    // 10 min - 5 min tunnel = 5 min @ 120 ppm / 10 ppc = 60 cases
    expect(suggestion?.expectedCasesRaw).toBe(60);
    expect(suggestion?.expectedCases).toBe(60);
    expect(suggestion?.skids).toBe(5);
    expect(suggestion?.casesOnSkid).toBe(0);
    expect(suggestion?.trays).toBeNull();
    expect(suggestion?.batches).toBeNull();
  });

  it("clamps displayed cases to casesNeeded but keeps raw unclamped", () => {
    const suggestion = computeAutoTrackSuggestion({ ...base, elapsedBatchSec: 4000 });
    expect(suggestion?.expectedCasesRaw).toBeGreaterThan(100);
    expect(suggestion?.expectedCases).toBe(100);
    expect(suggestion?.skids).toBe(8);
  });

  it("does not clamp when casesNeeded is zero", () => {
    const suggestion = computeAutoTrackSuggestion({ ...base, casesNeeded: 0, elapsedBatchSec: 600 });
    expect(suggestion?.expectedCases).toBe(60);
  });

  it("uses the packaging drain clock when draining", () => {
    const suggestion = computeAutoTrackSuggestion({
      ...base,
      packagingDrainActive: true,
      packagingDrainElapsedSec: 300,
    });
    // 5 min drain @ 120 ppm / 10 ppc = 60 cases
    expect(suggestion?.expectedCasesRaw).toBe(60);
  });
});

describe("computeAppSlotInfo", () => {
  const base = { type: "Mozzarella", recipe: undefined, batchLbs: 5, ozPerPizza: 4, required: 4, ppm: 120 };

  it("prefers recipe lbs over the manual batch lbs field", () => {
    const info = computeAppSlotInfo({ ...base, recipe: [{ lbs: 2 }, { lbs: 0 }] });
    expect(info.effectiveBatchLbs).toBe(2);
    // (2 lb * 16 / 4 oz / 120 ppm) * 60 = 4 s per batch
    expect(info.cadence).toBe(4);
    expect(info.validForClaim).toBe(true);
  });

  it("falls back to batch lbs when the recipe is empty", () => {
    const info = computeAppSlotInfo(base);
    expect(info.effectiveBatchLbs).toBe(5);
    expect(info.cadence).toBeCloseTo(10);
  });

  it("rejects mix types and empty types for claims but still computes cadence", () => {
    const mix = computeAppSlotInfo({ ...base, type: "Mix Special" });
    expect(mix.validForClaim).toBe(false);
    expect(mix.cadence).toBe(10);

    const empty = computeAppSlotInfo({ ...base, type: "" });
    expect(empty.validForClaim).toBe(false);
    expect(empty.cadence).toBe(10);
  });

  it("disables the slot on non-positive oz/required/ppm", () => {
    expect(computeAppSlotInfo({ ...base, ozPerPizza: 0 }).cadence).toBe(0);
    expect(computeAppSlotInfo({ ...base, required: 0 }).validForClaim).toBe(false);
    expect(computeAppSlotInfo({ ...base, ppm: 0 }).validForClaim).toBe(false);
    expect(computeAppSlotInfo({ ...base, batchLbs: 0, recipe: undefined }).cadence).toBe(0);
  });
});

describe("computeNetSecondDue", () => {
  it("keeps an armed due when present", () => {
    expect(computeNetSecondDue({ currentDue: 500, anchor: 100, cadence: 400 })).toBe(500);
  });

  it("rebases from anchor + cadence when not armed (zero or negative)", () => {
    expect(computeNetSecondDue({ currentDue: 0, anchor: 100, cadence: 400 })).toBe(500);
    expect(computeNetSecondDue({ currentDue: -3, anchor: 100, cadence: 400 })).toBe(500);
  });
});

describe("claim mutation builders", () => {
  it("builds the exact case mutation pair", () => {
    expect(buildCaseClaimMutations({
      skidsFrom: 1, skidsTo: 2, casesFrom: 3, casesTo: 4,
    })).toEqual([
      { field: "skidsCompleted", from: 1, to: 2 },
      { field: "casesOnCurrentSkid", from: 3, to: 4 },
    ]);
  });

  it("builds the exact sauce mutation triple", () => {
    expect(buildSauceClaimMutations({
      countFrom: 2, countTo: 3, anchorFrom: 100, anchorTo: 500, correctionGeneration: 7,
    })).toEqual([
      { field: "sauceBarrelsMade", from: 2, to: 3 },
      { field: "sauceBarrelAnchorNetSec", from: 100, to: 500 },
      { field: "sauceBarrelCorrectionGeneration", from: 7, to: 7 },
    ]);
  });

  it("builds the exact per-slot applicator mutation triple", () => {
    expect(buildAppSlotClaimMutations({
      slot: "app3", madeFrom: 1, madeTo: 2, anchorFrom: 50, anchorTo: 90, correctionGeneration: 0,
    })).toEqual([
      { field: "app3BatchesMade", from: 1, to: 2 },
      { field: "app3BatchAnchorNetSec", from: 50, to: 90 },
      { field: "app3BatchCorrectionGeneration", from: 0, to: 0 },
    ]);
  });
});

describe("computeCaseTickWrite", () => {
  const base = {
    prevExpected: 50,
    expectedRaw: 52,
    expectedCases: 52,
    prevFreezer: 0,
    nextFreezer: 0,
    curTotal: 50,
    casesPerSkid: 12,
    casesNeeded: 100,
    drainActive: false,
    packagingDrainActive: false,
    caseClaimRetry: false,
    formResetSkipped: false,
  };

  it("writes the incremental delta from the unclamped expected baseline", () => {
    const d = computeCaseTickWrite(base);
    expect(d.action).toBe("write");
    if (d.action === "write") expect(d.newTotal).toBe(52);
    expect(d.formResetSkippedNew).toBe(false);
  });

  it("clamps writes at casesNeeded but keeps raw as the delta source", () => {
    const d = computeCaseTickWrite({ ...base, expectedRaw: 120, curTotal: 90 });
    expect(d.action).toBe("write");
    if (d.action === "write") expect(d.newTotal).toBe(100);
  });

  it("never pulls the total down below the operator's floor", () => {
    const d = computeCaseTickWrite({ ...base, curTotal: 200 });
    expect(d.action).toBe("none");
  });

  it("skips one tick on a stale delta after a form reset to zero", () => {
    const d = computeCaseTickWrite({ ...base, curTotal: 0, prevExpected: 50, expectedRaw: 52, formResetSkipped: false });
    expect(d.action).toBe("reset-skip");
    expect(d.formResetSkippedNew).toBe(true);
  });

  it("writes ~1 case on the tick after the reset skip when flagged", () => {
    // expectedRaw advanced past the skip; flagged formResetSkipped lets it write.
    const d = computeCaseTickWrite({ ...base, curTotal: 0, prevExpected: 50, expectedRaw: 51, formResetSkipped: true });
    expect(d.action).toBe("write");
    if (d.action === "write") expect(d.newTotal).toBe(1);
    expect(d.formResetSkippedNew).toBe(false);
  });

  it("clears the reset flag when a delta tick finds no reset condition", () => {
    const d = computeCaseTickWrite({ ...base, curTotal: 60, formResetSkipped: true });
    expect(d.action).toBe("write");
    if (d.action === "write") expect(d.newTotal).toBe(62);
    expect(d.formResetSkippedNew).toBe(false);
  });

  it("clears the reset flag on a zero-delta tick", () => {
    const d = computeCaseTickWrite({ ...base, expectedRaw: 50 });
    expect(d.action).toBe("none");
    expect(d.formResetSkippedNew).toBe(false);
  });

  it("seeds the absolute count on the first tick when no progress exists", () => {
    const d = computeCaseTickWrite({ ...base, prevExpected: -1, curTotal: 0, expectedCases: 5, expectedRaw: 0 });
    expect(d.action).toBe("seed");
    if (d.action === "seed") expect(d.newTotal).toBe(5);
    expect(d.caseClaimRetryReset).toBe(true);
  });

  it("seeds clamped to casesNeeded", () => {
    const d = computeCaseTickWrite({ ...base, prevExpected: -1, curTotal: 0, expectedCases: 300, casesNeeded: 100 });
    expect(d.action).toBe("seed");
    if (d.action === "seed") expect(d.newTotal).toBe(100);
  });

  it("does not seed when progress already exists on the first tick", () => {
    const d = computeCaseTickWrite({ ...base, prevExpected: -1, curTotal: 50, expectedCases: 5 });
    expect(d.action).toBe("none");
  });

  it("measures the ended-run drain by Freeze tunnel WIP drop", () => {
    const d = computeCaseTickWrite({
      ...base,
      drainActive: true,
      prevFreezer: 100,
      nextFreezer: 90,
      curTotal: 40,
      prevExpected: 100,
      expectedRaw: 100,
    });
    expect(d.action).toBe("write");
    if (d.action === "write") expect(d.newTotal).toBe(50);
  });

  it("uses the pause-relative stage clock during a packaging drain", () => {
    const d = computeCaseTickWrite({
      ...base,
      packagingDrainActive: true,
      prevExpected: 100,
      expectedRaw: 112,
      curTotal: 40,
    });
    expect(d.action).toBe("write");
    if (d.action === "write") expect(d.newTotal).toBe(52);
  });

  it("writes nothing when the tunnel did not drop", () => {
    const d = computeCaseTickWrite({ ...base, drainActive: true, prevFreezer: 90, nextFreezer: 90, curTotal: 40 });
    expect(d.action).toBe("none");
    expect(d.formResetSkippedNew).toBe(false);
  });
});

describe("computeTrayTick", () => {
  const base = {
    nowMs: 1000,
    prodDueMs: 0,
    consDueMs: 0,
    lastMs: 0,
    periodMs: 15000,
    suppressed: false,
    feedComplete: false,
    deficitOpen: true,
    seeded: false,
    current: 0,
    seed: 12,
    ppm: 120,
    perTray: 30,
    remainder: 0,
  };

  it("arms production half a period out of phase without writing on first encounter", () => {
    const t = computeTrayTick({ ...base, consDueMs: 200000 });
    expect(t.prodDueMsNew).toBe(1000 + 15000 / 2);
    expect(t.delta).toBe(0);
    expect(t.seed).toBeNull();
  });

  it("seeds an untouched zero counter on its first consumption tick", () => {
    const t = computeTrayTick({ ...base, consDueMs: 500 });
    expect(t.seed).toEqual({ from: 0, to: 12 });
    expect(t.seededNew).toBe(true);
    expect(t.delta).toBe(0);
    expect(t.consDueMsNew).toBe(1000 + 15000);
    expect(t.lastMsNew).toBe(1000);
  });

  it("marks seeded even when the counter already has stock (no seed write)", () => {
    const t = computeTrayTick({ ...base, seeded: false, current: 15, consDueMs: 500 });
    expect(t.seed).toBeNull();
    expect(t.seededNew).toBe(true);
  });

  it("consumes one full period's trays with remainder carry on first consumption", () => {
    const t = computeTrayTick({ ...base, seeded: true, current: 12, consDueMs: 500, lastMs: 0 });
    // durationMin = 15000/60000 = 0.25 min; traysExact = 0.25*120/30 = 1
    expect(t.delta).toBe(-1);
    expect(t.remainderNew).toBe(0);
  });

  it("carries the fractional remainder between ticks", () => {
    // exactly 1.5 trays consumed → floor 1 + carry 0.5
    const t = computeTrayTick({
      ...base, seeded: true, current: 12, consDueMs: 500, lastMs: 0,
      perTray: 20,
    });
    // durationMin = 0.25 min; traysExact = 0.25*120/20 = 1.5 → floor 1 + carry 0.5
    expect(t.delta).toBe(-1);
    expect(t.remainderNew).toBeCloseTo(0.5);
  });

  it("adds +1 on a production tick while the tray deficit or batches remain", () => {
    const t = computeTrayTick({ ...base, seeded: true, prodDueMs: 500, consDueMs: 200000 });
    expect(t.delta).toBe(1);
    expect(t.prodDueMsNew).toBe(1000 + 15000);
  });

  it("does not produce once the press is done", () => {
    const t = computeTrayTick({ ...base, seeded: true, prodDueMs: 500, feedComplete: true, consDueMs: 400000 });
    expect(t.delta).toBe(0);
  });

  it("advances refs but writes nothing while suppressed", () => {
    const t = computeTrayTick({ ...base, seeded: true, current: 12, consDueMs: 500, suppressed: true });
    expect(t.delta).toBe(0);
    expect(t.seed).toBeNull();
    expect(t.consDueMsNew).toBe(1000 + 15000);
    expect(t.lastMsNew).toBe(1000);
  });

  it("caps consumption to two periods of elapsed time", () => {
    // lastMs far in the past → durationMin capped at 2 * period
    const t = computeTrayTick({
      ...base, seeded: true, current: 12, consDueMs: 500, lastMs: 10,
      nowMs: 13000 + 15000 * 10,
    });
    const cappedMin = (15000 * 2) / 60000;
    expect(t.delta).toBe(-Math.floor((cappedMin * 120) / 30));
  });
});

describe("computeBatchTick", () => {
  const base = {
    nowMs: 1000,
    prodDueMs: 0,
    consDueMs: 0,
    lastMs: 0,
    periodMs: 15000,
    fullBatchMs: 60000,
    effDrainMs: 60000,
    suppressed: false,
    feedComplete: false,
    deficitOpen: true,
    seeded: false,
    current: 0,
    traysSeededAmount: 0,
    traysNeeded: 0,
    batchesNeeded: 3,
  };

  it("arms the first batch production one full batch-time out without writing", () => {
    const t = computeBatchTick(base);
    expect(t.prodDueMsNew).toBe(1000 + 60000);
    expect(t.delta).toBe(0);
  });

  it("produces +1 and fractionally consumes on the same due tick", () => {
    const t = computeBatchTick({ ...base, seeded: true, prodDueMs: 500, consDueMs: 500 });
    expect(t.delta).toBe(1 - (0.25 * 60000) / 60000); // +1 - 0.25 = 0.75
    expect(t.delta).toBeCloseTo(0.75);
  });

  it("seeds a zero counter minus tray coverage seeded this tick", () => {
    const t = computeBatchTick({ ...base, consDueMs: 500, traysSeededAmount: 12, traysNeeded: 36, batchesNeeded: 3 });
    // remaining = 3 * (36-12)/36 = 2
    expect(t.seed).toEqual({ from: 0, to: 2 });
  });

  it("clamps the batch seed at the 3-batch stepper max", () => {
    const t = computeBatchTick({ ...base, consDueMs: 500, batchesNeeded: 9 });
    expect(t.seed).toEqual({ from: 0, to: 3 });
  });

  it("seeds without tray coverage at the full batch deficit", () => {
    const t = computeBatchTick({ ...base, consDueMs: 500, batchesNeeded: 2 });
    expect(t.seed).toEqual({ from: 0, to: 2 });
  });

  it("does not seed when the counter already has stock (marks seeded)", () => {
    const t = computeBatchTick({ ...base, seeded: false, current: 2, consDueMs: 500 });
    expect(t.seed).toBeNull();
    expect(t.seededNew).toBe(true);
  });

  it("does not produce once the deficit is closed", () => {
    const t = computeBatchTick({ ...base, seeded: true, prodDueMs: 500, deficitOpen: false, consDueMs: 200000 });
    expect(t.delta).toBe(0);
  });

  it("writes nothing and marks no seed while suppressed but still advances refs", () => {
    const t = computeBatchTick({ ...base, consDueMs: 500, suppressed: true });
    expect(t.delta).toBe(0);
    expect(t.seed).toBeNull();
    expect(t.consDueMsNew).toBe(1000 + 15000);
  });
});
