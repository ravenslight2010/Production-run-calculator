import { describe, expect, it } from "vitest";
import {
  computeAutoTrackSchedule,
  computeAutoTrackSuggestion,
  computeCaseTickWrite,
  computeEffectiveLineSpeed,
  computeServerCalc,
  getAutoTrackTiming,
} from "./index";

describe("shared live calculation boundary", () => {
  it("preserves explicit zero as a disabled dough speed", () => {
    expect(computeEffectiveLineSpeed({
      mode: "dough",
      crustsPerCycle: 4,
      cycleSpeed: 20,
      speedAdjustment: 0,
    })).toBe(0);
    expect(computeEffectiveLineSpeed({
      mode: "dough",
      crustsPerCycle: 4,
      cycleSpeed: 20,
    })).toBe(80);
  });

  it("preserves the one-second client cadence floor", () => {
    expect(getAutoTrackTiming(1000, 1, 1, 100).caseMs).toBe(1000);
  });

  it("clamps displayed cases to run need while retaining raw delta progress", () => {
    expect(computeAutoTrackSuggestion({
      runStatus: "running",
      drainActive: false,
      packagingDrainActive: false,
      packagingDrainElapsedSec: 0,
      ppm: 60,
      casesPerSkid: 10,
      pizzasPerCase: 1,
      casesNeeded: 12,
      freezerTime: 0,
      elapsedBatchSec: 60,
    })).toMatchObject({ expectedCases: 12, expectedCasesRaw: 60, skids: 1, casesOnSkid: 2 });
  });

  it("uses canonical coordination due times in the server schedule", () => {
    const schedule = computeAutoTrackSchedule({
      runId: "run-1",
      startedAt: 1000,
      nowMs: 5000,
      v: {
        freezerTime: 30,
        app1Type: "", app1CheeseRecipe: [], app1BatchLbs: 0, app1OzPerPizza: 0,
        app2Type: "", app2CheeseRecipe: [], app2BatchLbs: 0, app2OzPerPizza: 0,
        app3Type: "", app3CheeseRecipe: [], app3BatchLbs: 0, app3OzPerPizza: 0,
        app4Type: "", app4CheeseRecipe: [], app4BatchLbs: 0, app4OzPerPizza: 0,
      } as never,
      calc: {
        pressDone: false, sauceDepletionSec: 0,
        app1Batches: 0, app2Batches: 0, app3Batches: 0, app4Batches: 0,
        ppm: 60,
      } as never,
      coordination: { case: { nextDueAt: 4000, sequence: 3 } },
    });
    expect(schedule.entries).toContainEqual({
      channel: "case",
      dueAt: 4000,
      nextDueAt: 4000,
      dueNow: true,
      canonical: true,
      sequence: 3,
    });
  });

  it("keeps the stale-delta form reset guard in the shared tick engine", () => {
    expect(computeCaseTickWrite({
      prevExpected: 500,
      expectedRaw: 501,
      expectedCases: 501,
      prevFreezer: 0,
      nextFreezer: 0,
      curTotal: 0,
      casesPerSkid: 50,
      casesNeeded: 600,
      drainActive: false,
      packagingDrainActive: false,
      caseClaimRetry: false,
      formResetSkipped: false,
    }).action).toBe("reset-skip");
  });

  it("applies persisted temporary overrides to server calculations", () => {
    const result = computeServerCalc({
      dayState: { runs: [{ id: "run-override", startedAt: 1000 }], currentIndex: 0 },
      runValues: {
        "run-override": {
          pizzasPerCase: 10,
          casesPerSkid: 20,
          casesNeeded: 100,
          crustsPerCycle: 4,
          cycleSpeed: 10,
          speedAdjustment: 1,
          tempCrustsPerCycle: 5,
          tempCycleSpeed: 12,
          tempFreezerTime: 30,
        },
      },
    }, [], 2000);
    expect(result?.calc.ppm).toBe(60);
  });
});