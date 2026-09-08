import { describe, expect, it } from "vitest";
import { computeServerCalc } from "@workspace/live-calc";
import { buildNetSecondServerClaims, buildWallClockServerClaims } from "./autoTrackServerTicks";
import { applyAutoTrackClaim } from "./autoTrackCoordination";

const NOW = 1_800_000_000_000;
const RUN = "server-tick-run";
function payload(overrides: Record<string, unknown> = {}) {
  return {
    dayState: { currentIndex: 0, runs: [{ id: RUN, subTab: "crusts", startedAt: NOW - 90_000, metaUpdatedAt: 1 }] },
    runValuesUpdatedAt: { [RUN]: 1 },
    runValues: {
      [RUN]: {
        casesNeeded: 200, crustsPerCycle: 12, cycleSpeed: 600, speedAdjustment: 1,
        approxLineSpeed: 400, freezerTime: 3, pizzasPerCase: 12, casesPerSkid: 48,
        casesPerLayer: 12, doughballsPerTray: 36, crustsPerStack: 6, doughBatchYield: 150,
        crustsPerCase: 12, skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 2,
        batchesReady: 1, targetDoughballWeight: 8, doughRecipe: [], sauceBarrelLbs: 50,
        sauceOzPerPizza: 2, frontlineRecipeName: "Sauce", frontlineRecipe: [],
        sauceBarrelsMade: 0, sauceBarrelAnchorNetSec: 0, sauceBarrelCorrectionGeneration: 0,
        app1Type: "Cheese", app1OzPerPizza: 2, app1BatchLbs: 50, app1CheeseRecipe: [],
        app1BatchesMade: 0, app1BatchAnchorNetSec: 0, app1BatchCorrectionGeneration: 0,
        app2Type: "", app2OzPerPizza: 0, app2BatchLbs: 0, app2CheeseRecipe: [],
        app3Type: "", app3OzPerPizza: 0, app3BatchLbs: 0, app3CheeseRecipe: [],
        app4Type: "", app4OzPerPizza: 0, app4BatchLbs: 0, app4CheeseRecipe: [],
        pep1Type: "", pep2Type: "", pep1Combined: true,
        ...overrides,
      },
    },
  };
}

describe("server auto-track claim builders", () => {
  it("honors the canonical per-run manual mode switch", () => {
    const source = payload();
    (source.dayState!.runs![0] as Record<string, unknown>).autoTrackDisabled = true;
    expect(buildNetSecondServerClaims(source, NOW)).toEqual([]);
    expect(buildWallClockServerClaims(source, NOW)).toBeNull();
  });

  it("builds one advancing net-second claim per eligible due channel", () => {
    const claims = buildNetSecondServerClaims(payload(), NOW);
    expect(claims.map((claim) => claim.channel)).toEqual(["sauce-barrel", "app1-batch"]);
    expect(claims.every((claim) => claim.mutations[0]!.to === claim.mutations[0]!.from + 1)).toBe(true);
  });

  it("does not build net-second claims for invalid rates or paused runs", () => {
    expect(buildNetSecondServerClaims(payload({ sauceOzPerPizza: 0, app1OzPerPizza: 0 }), NOW)).toEqual([]);
    const paused = payload();
    (paused.dayState.runs[0] as Record<string, unknown>).pausedAt = NOW - 1;
    expect(buildNetSecondServerClaims(paused, NOW)).toEqual([]);
  });

  it("rejects an abandoned old running row even when its date remains selectable", () => {
    const stale = payload();
    (stale.dayState.runs[0] as Record<string, unknown>).startedAt = NOW - 7 * 60 * 60 * 1000;
    (stale.dayState.runs[0] as Record<string, unknown>).metaUpdatedAt = NOW - 7 * 60 * 60 * 1000;
    expect(buildNetSecondServerClaims(stale, NOW)).toEqual([]);
    expect(buildWallClockServerClaims(stale, NOW)).toBeNull();
  });

  it("retains wall-clock bookkeeping on a no-claim bootstrap beat", () => {
    const fresh = payload({ skidsCompleted: 5 });
    (fresh.dayState.runs[0] as Record<string, unknown>).startedAt = NOW;
    const plan = buildWallClockServerClaims(fresh, NOW);
    expect(plan?.runId).toBe(RUN);
    expect(plan?.claims).toEqual([]);
    expect(plan?.bookkeeping.caseNextDueMs).toBeGreaterThan(NOW);
  });

  it("emits only one persisted wall-clock beat and advances its arm", () => {
    const source = payload();
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: { lifecycleGeneration: `${RUN}:1`, caseNextDueMs: NOW - 1 } },
    };
    const plan = buildWallClockServerClaims(source, NOW)!;
    const caseClaim = plan.claims.find((claim) => claim.channel === "case")!;
    expect(caseClaim.mutations).toHaveLength(2);
    expect(plan.bookkeeping.caseNextDueMs).toBeGreaterThan(NOW);
  });

  it("continues canonical case beats during the bounded post-End freezer drain", () => {
    const source = payload({ freezerTime: 3 });
    const run = source.dayState.runs[0] as Record<string, unknown>;
    run.endedAt = NOW - 60_000;
    run.metaUpdatedAt = 2;
    const currentFreezer = Math.floor(computeServerCalc(source as never, [], NOW)!.calc.casesInFreezer);
    const priorFreezer = currentFreezer + 4;
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: {
        [RUN]: {
          lifecycleGeneration: `${RUN}:1`,
          serverSequences: { case: 3 },
          caseNextDueMs: NOW - 1,
          lastExpectedCases: 10,
          drainFreezer: priorFreezer,
        },
      },
    };
    (source as Record<string, unknown>).autoTrackCoordination = {
      runs: {
        [RUN]: {
          case: {
            generation: `${RUN}:1`,
            sequence: 3,
            nextDueAt: NOW - 1,
            acceptedEventId: "server:case:3",
          },
        },
      },
    };

    const draining = buildWallClockServerClaims(source, NOW);
    expect(draining?.claims.map((claim) => claim.channel)).toEqual(["case"]);
    expect(draining?.claims[0]?.sequence).toBe(1);
    expect(draining?.claims[0]?.mutations).toEqual([
      { field: "skidsCompleted", from: 0, to: 0 },
      { field: "casesOnCurrentSkid", from: 0, to: 4 },
    ]);
    expect(draining?.bookkeeping.drainFreezer).toBe(currentFreezer);
    expect(applyAutoTrackClaim(source as never, draining!.claims[0]!, NOW).outcome).toBe("accepted");

    run.endedAt = NOW - 3 * 60_000;
    expect(buildWallClockServerClaims(source, NOW)).toBeNull();
  });

  it("takes over a browser-owned case register when End starts a new drain generation", () => {
    const source = payload({ freezerTime: 3 });
    const run = source.dayState.runs[0] as Record<string, unknown>;
    run.endedAt = NOW - 60_000;
    run.metaUpdatedAt = 2;
    const currentFreezer = Math.floor(computeServerCalc(source as never, [], NOW)!.calc.casesInFreezer);
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: {
        [RUN]: {
          lifecycleGeneration: `${RUN}:1`,
          caseNextDueMs: NOW - 1,
          drainFreezer: currentFreezer + 3,
        },
      },
    };
    (source as Record<string, unknown>).autoTrackCoordination = {
      runs: {
        [RUN]: {
          case: {
            generation: `${RUN}:1`,
            sequence: 7,
            nextDueAt: NOW - 1,
            acceptedEventId: "browser:case:7",
          },
        },
      },
    };

    const draining = buildWallClockServerClaims(source, NOW)!;
    expect(draining.claims[0]).toMatchObject({
      channel: "case",
      generation: `${RUN}:2`,
      sequence: 1,
    });
    expect(draining.claims[0]!.mutations[1]).toMatchObject({
      field: "casesOnCurrentSkid",
      from: 0,
      to: 3,
    });
    expect(applyAutoTrackClaim(source as never, draining.claims[0]!, NOW).outcome).toBe("accepted");
  });

  it("establishes an End baseline without prior server bookkeeping, then continues drain", () => {
    const source = payload({ freezerTime: 3 });
    const run = source.dayState.runs[0] as Record<string, unknown>;
    run.endedAt = NOW;
    run.metaUpdatedAt = 2;
    (source as Record<string, unknown>).autoTrackCoordination = {
      runs: {
        [RUN]: {
          case: {
            generation: `${RUN}:1`,
            sequence: 2,
            nextDueAt: NOW - 1,
            acceptedEventId: "browser:case:2",
          },
        },
      },
    };

    const baseline = buildWallClockServerClaims(source, NOW)!;
    expect(baseline.claims).toEqual([]);
    expect(baseline.bookkeeping.drainFreezer).toBeGreaterThanOrEqual(0);

    const nextAt = NOW + 120_000;
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: baseline.bookkeeping },
    };
    expect(computeServerCalc(source as never, [], nextAt)!.calc.casesInFreezer)
      .toBeLessThan(baseline.bookkeeping.drainFreezer);
    const draining = buildWallClockServerClaims(source, nextAt)!;
    expect(draining.claims).toHaveLength(1);
    expect(draining.claims[0]).toMatchObject({
      channel: "case",
      generation: `${RUN}:2`,
      sequence: 1,
    });
    expect(applyAutoTrackClaim(source as never, draining.claims[0]!, nextAt).outcome).toBe("accepted");
  });

  it("honors only matching-generation dough pause control while case continues", () => {
    const source = payload();
    (source as Record<string, unknown>).doughTimerControls = {
      [RUN]: { generation: `${RUN}:1`, pausedAt: NOW - 1000, resumeAt: 0, updatedAt: NOW - 1000 },
    };
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: {
        lifecycleGeneration: `${RUN}:1`, caseNextDueMs: NOW - 1,
        trayConsNextDueMs: NOW - 1, trayProdNextDueMs: NOW - 1,
        batchConsNextDueMs: NOW - 1, batchProdNextDueMs: NOW - 1,
        hopperNextDueMs: NOW - 1,
      } },
    };
    expect(buildWallClockServerClaims(source, NOW)!.claims.map((c) => c.channel)).toEqual(["case"]);
    ((source as any).doughTimerControls[RUN]).generation = "stale";
    expect(buildWallClockServerClaims(source, NOW)!.claims.some((c) => c.channel !== "case")).toBe(true);
  });

  it("continues sequencing unattended server-owned wall-clock beats after restart", () => {
    const source = payload({ freezerTime: 0 });
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: { lifecycleGeneration: `${RUN}:1`, caseNextDueMs: NOW - 1 } },
    };
    const first = buildWallClockServerClaims(source, NOW)!;
    let data = source as Record<string, unknown>;
    for (const claim of first.claims) {
      const applied = applyAutoTrackClaim(data, claim, NOW);
      expect(applied.outcome).toBe("accepted");
      data = applied.data;
    }
    data.autoTrackServerState = {
      version: 1,
      wallClockBookkeeping: { [RUN]: first.bookkeeping },
    };
    const secondAt = first.bookkeeping.caseNextDueMs;
    const second = buildWallClockServerClaims(data, secondAt)!;
    const caseClaim = second.claims.find((claim) => claim.channel === "case")!;
    expect(caseClaim.sequence).toBe(2);
    expect(applyAutoTrackClaim(data, caseClaim, secondAt).outcome).toBe("accepted");
  });

  it("takes over a due client register, then continues with private ownership", () => {
    const source = payload({ freezerTime: 0 });
    (source as any).autoTrackCoordination = { version: 1, runs: { [RUN]: {
      case: { generation: `${RUN}:1`, sequence: 1, nextDueAt: NOW - 1, acceptedEventId: "client:1", updatedAt: NOW - 10 },
    } } };
    (source as any).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: { lifecycleGeneration: `${RUN}:1`, caseNextDueMs: NOW - 1 } },
    };
    const takeover = buildWallClockServerClaims(source, NOW)!;
    const claim = takeover.claims.find((item) => item.channel === "case")!;
    expect(claim.sequence).toBe(2);
    const applied = applyAutoTrackClaim(source as any, claim, NOW);
    expect(applied.outcome).toBe("accepted");
    const data = {
      ...applied.data,
      autoTrackServerState: { wallClockBookkeeping: { [RUN]: takeover.bookkeeping } },
    };
    const continued = buildWallClockServerClaims(data, takeover.bookkeeping.caseNextDueMs)!;
    expect(continued.claims.find((item) => item.channel === "case")?.sequence).toBe(3);
  });

  it("rearms persisted timers when the lifecycle generation changes", () => {
    const source = payload({ freezerTime: 0 });
    (source.dayState.runs[0] as Record<string, unknown>).metaUpdatedAt = 2;
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: {
        [RUN]: {
          lifecycleGeneration: `${RUN}:1`,
          caseNextDueMs: NOW - 10_000,
          trayLastMs: NOW - 60_000,
          traysRemainder: 0.75,
        },
      },
    };
    const plan = buildWallClockServerClaims(source, NOW)!;
    expect(plan.claims).toEqual([]);
    expect(plan.bookkeeping.lifecycleGeneration).toBe(`${RUN}:2`);
    expect(plan.bookkeeping.caseNextDueMs).toBeGreaterThan(NOW);
    expect(plan.bookkeeping.trayLastMs).toBe(0);
  });

  it("does not steal a matching-generation client-owned channel", () => {
    const source = payload({ freezerTime: 0 });
    (source as Record<string, unknown>).autoTrackCoordination = {
      runs: {
        [RUN]: {
          case: {
            generation: `${RUN}:1`,
            sequence: 4,
            acceptedEventId: "client:case:4",
            nextDueAt: NOW - 1,
          },
        },
      },
    };
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: {
        [RUN]: {
          lifecycleGeneration: `${RUN}:1`,
          serverSequences: {},
          caseNextDueMs: NOW - 1,
          lastExpectedCases: 49,
        },
      },
    };
    const plan = buildWallClockServerClaims(source, NOW)!;
    expect(plan.claims.find((claim) => claim.channel === "case")).toBeUndefined();
  });
});