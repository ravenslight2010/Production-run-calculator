import { describe, expect, it } from "vitest";
import {
  computeAutoTrackSchedule,
  computeAutoTrackSuggestion,
  computeCaseTickWrite,
  computeEffectiveLineSpeed,
  computeServerCalc,
  buildOperationalProjection,
  deriveOperationalRunView,
  OperationalRunViewError,
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

  it("fails closed on buffer-only Sauce and Frontline quantities without pizzas per case", () => {
    const result = computeServerCalc({
      dayState: { runs: [{ id: "invalid", brand: "A", flavor: "B" }], currentIndex: 0 },
      runValues: {
        invalid: {
          casesNeeded: 240,
          pizzasPerCase: 0,
          casesPerLayer: 10,
          crustsPerCycle: 1,
          cycleSpeed: 100,
          speedAdjustment: 1,
          sauceOzPerPizza: 3,
          sauceBarrelLbs: 55,
          app1Type: "Cheese",
          app1OzPerPizza: 2.9,
          app1CheeseRecipe: [{ ingredient: "A", lbs: 55.6 }],
          pep1Type: "Pepperoni",
          pep1OzPerPizza: 1,
          pep1Sticks: 10,
        },
      },
    }, ["Pepperoni"], 1000);
    expect(result?.calc).toMatchObject({
      sauceBatches: 0,
      sauceDepletionSec: 0,
      app1Lbs: 0,
      app1Batches: 0,
      pep1Lbs: 0,
      pep1Batches: 0,
    });
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

  it("requires matching private server ownership before a wall schedule is canonical", () => {
    const input = {
      runId: "run-1",
      startedAt: 1000,
      nowMs: 5000,
      v: {
        freezerTime: 30, pizzasPerCase: 12,
        app1Type: "", app1CheeseRecipe: [], app1BatchLbs: 0, app1OzPerPizza: 0,
        app2Type: "", app2CheeseRecipe: [], app2BatchLbs: 0, app2OzPerPizza: 0,
        app3Type: "", app3CheeseRecipe: [], app3BatchLbs: 0, app3OzPerPizza: 0,
        app4Type: "", app4CheeseRecipe: [], app4BatchLbs: 0, app4OzPerPizza: 0,
      } as never,
      calc: {
        pressDone: false, sauceDepletionSec: 0,
        app1Batches: 0, app2Batches: 0, app3Batches: 0, app4Batches: 0,
        ppm: 60, perTray: 60, perBatch: 600,
      } as never,
      coordination: { case: { generation: "run-1:1000", nextDueAt: 4000, sequence: 3 } },
    };
    const localFallback = computeAutoTrackSchedule(input);
    expect(localFallback.entries.find((entry) => entry.channel === "case")).toMatchObject({
      canonical: false,
    });

    const schedule = computeAutoTrackSchedule({
      ...input,
      serverWallOwnership: { case: 3 },
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

  it("treats stale-generation coordination as noncanonical fallback", () => {
    const schedule = computeAutoTrackSchedule({
      runId: "run-1", startedAt: 1000, metaUpdatedAt: 2000, nowMs: 5000,
      v: {
        pizzasPerCase: 12, freezerTime: 30,
        app1Type: "", app1CheeseRecipe: [], app1BatchLbs: 0, app1OzPerPizza: 0,
        app2Type: "", app2CheeseRecipe: [], app2BatchLbs: 0, app2OzPerPizza: 0,
        app3Type: "", app3CheeseRecipe: [], app3BatchLbs: 0, app3OzPerPizza: 0,
        app4Type: "", app4CheeseRecipe: [], app4BatchLbs: 0, app4OzPerPizza: 0,
      } as never,
      calc: {
        pressDone: false, sauceDepletionSec: 0, ppm: 60, perTray: 0, perBatch: 0,
        app1Batches: 0, app2Batches: 0, app3Batches: 0, app4Batches: 0,
      } as never,
      coordination: { case: { generation: "run-1:1000", nextDueAt: 4000, sequence: 3 } },
    });
    expect(schedule.entries.find((entry) => entry.channel === "case")).toMatchObject({
      canonical: false,
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

  it("derives active, paused, and ended-draining operational phase views", () => {
    const snapshot = (run: Record<string, unknown>) => ({
      syncVersion: 1 as const, completeness: "complete" as const,
      dayState: { date: "2026-09-06", resetAt: 10, currentIndex: 0, runs: [run] },
      runValues: { "run-1": { pizzasPerCase: 10, casesPerSkid: 20, casesNeeded: 100, crustsPerCycle: 4, cycleSpeed: 10, speedAdjustment: 1, freezerTime: 10 } },
      packagingProgress: { "run-1": { skidsCompleted: 2, casesOnCurrentSkid: 3 } },
    });
    const args = (run: Record<string, unknown>, nowMs: number) => ({
      snapshot: snapshot(run) as never, date: "2026-09-06", runId: "run-1", nowMs,
      snapshotMetadata: { snapshotId: "s1", capturedAt: 1_000, resetAt: 10 },
    });
    expect(deriveOperationalRunView(args({ id: "run-1", startedAt: 1_000 }, 6_000)).observed.status).toBe("running");
    expect(deriveOperationalRunView(args({
      id: "run-1", startedAt: 1_000, pausedAt: 2_000,
      stoppages: [{ type: "pause", startedAt: 2_000, stopTunnel: true }],
    }, 3_000)).elapsed.phase.stage1.state).toBe("draining");
    expect(deriveOperationalRunView(args({ id: "run-1", startedAt: 1_000, endedAt: 2_000 }, 3_000))
      .elapsed.phase.stage1.state).toBe("draining");
    expect(deriveOperationalRunView(args({ id: "run-1", startedAt: 1_000, endedAt: 2_000 }, 602_000))
      .elapsed.phase.stage3.state).toBe("empty");
  });

  it("marks stale snapshots and rejects reset mismatch, override-safe duplicate runs", () => {
    const base = {
      syncVersion: 1 as const, completeness: "complete" as const,
      dayState: { date: "2026-09-06", resetAt: 10, currentIndex: 0, substitutions: [{ action: "replace" }], runs: [{ id: "run-1", startedAt: 1_000 }] },
      runValues: { "run-1": { pizzasPerCase: 10, casesPerSkid: 20, casesNeeded: 100, crustsPerCycle: 4, cycleSpeed: 10, speedAdjustment: 1, freezerTime: 10, tempCycleSpeed: 12 } },
    };
    const request = { snapshot: base as never, date: "2026-09-06", runId: "run-1", nowMs: 100_000, snapshotMetadata: { snapshotId: "s1", capturedAt: 1_000, resetAt: 10 } };
    const view = deriveOperationalRunView(request);
    expect(view.freshness.status).toBe("stale");
    expect(view.formulaProvenance).toMatchObject({
      policy: "operational-run-view",
      policyVersion: 1,
      calculatorVersion: 1,
      linePhasesVersion: 1,
    });
    expect(view.observed.temporaryOverrides.cycleSpeed).toBe(true);
    expect(view.observed.substitutionsApplied).toBe(1);
    expect(() => deriveOperationalRunView({ ...request, snapshotMetadata: { ...request.snapshotMetadata, resetAt: 11 } }))
      .toThrow(OperationalRunViewError);
    expect(() => deriveOperationalRunView({
      ...request,
      snapshot: { ...base, dayState: { ...base.dayState, runs: [{ id: "run-1" }, { id: "run-1" }] } } as never,
    })).toThrow(OperationalRunViewError);
  });

  it("builds a deterministic server projection with pause and end anchors", () => {
    const base = {
      dayState: {
        currentIndex: 0,
        runs: [{
          id: "run-projection",
          metaUpdatedAt: 11,
          startedAt: 1_000,
          stoppages: [{ type: "stop", startedAt: 3_000, endedAt: 4_000 }],
        }],
      },
      runValues: {
        "run-projection": {
          pizzasPerCase: 10, casesPerSkid: 20, casesNeeded: 100,
          crustsPerCycle: 4, cycleSpeed: 10, speedAdjustment: 1,
          freezerTime: 10, traysOnLine: 4, batchesReady: 2,
          sauceBarrelsMade: 1, app1BatchesMade: 2,
        },
      },
    } as never;
    const serverCalc = computeServerCalc(base, [], 10_000)!;
    const schedule = computeAutoTrackSchedule({
      runId: "run-projection",
      startedAt: 1_000,
      metaUpdatedAt: 11,
      nowMs: 10_000,
      v: base.runValues["run-projection"] as never,
      calc: serverCalc.calc,
    });
    const args = {
      payload: base,
      serverCalc,
      schedule,
      nowMs: 10_000,
      calculationRevision: 8,
    };
    const first = buildOperationalProjection(args);
    const second = buildOperationalProjection(args);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      version: 1,
      runId: "run-projection",
      lifecycleGeneration: "run-projection:11",
      serverTimeMs: 10_000,
      capturedAtServerMs: 10_000,
      calculationRevision: 8,
      effectiveElapsedSec: 8,
      counters: { traysOnLine: 4, batchesReady: 2, sauceBarrelsMade: 1, app1BatchesMade: 2 },
    });

    const paused = {
      ...base,
      dayState: {
        ...base.dayState,
        runs: [{ ...base.dayState.runs[0], pausedAt: 7_000 }],
      },
    } as never;
    const pausedCalc = computeServerCalc(paused, [], 10_000)!;
    const pausedSchedule = computeAutoTrackSchedule({
      runId: "run-projection",
      startedAt: 1_000,
      pausedAt: 7_000,
      metaUpdatedAt: 11,
      nowMs: 10_000,
      v: paused.runValues["run-projection"] as never,
      calc: pausedCalc.calc,
    });
    expect(buildOperationalProjection({
      payload: paused,
      serverCalc: pausedCalc,
      schedule: pausedSchedule,
      nowMs: 10_000,
    }).effectiveElapsedSec).toBe(5);
  });
});