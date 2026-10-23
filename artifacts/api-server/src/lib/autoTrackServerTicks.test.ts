import { describe, expect, it } from "vitest";
import { computeSauceRunRequirement, computeServerCalc } from "@workspace/live-calc";
import { buildNetSecondServerClaims, buildWallClockServerClaims } from "./autoTrackServerTicks";
import { applyAutoTrackClaim, parseAutoTrackClaim } from "./autoTrackCoordination";

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
        app1StockLbs: 0, app1StockAnchorNetSec: 0, app1StockCorrectionGeneration: 0,
        app1StockConsumedLbs: 0, applicatorStockInitialized: true,
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
  it("keeps Dough, Sauce, and Frontline canonical channels eligible during a Packaging-only manual hold", () => {
    const source = payload({
      freezerTime: 0.5, preTunnelMin: 0.5, postTunnelMin: 0.5,
      casesOnCurrentSkid: 1,
      sauceStockBarrels: 1, sauceStockInitialized: true,
      sauceStockAnchorNetSec: 0, sauceStockCorrectionGeneration: 0,
      app1StockLbs: 25,
    }) as any;
    source.packagingProgress = {
      [RUN]: { casesOnCurrentSkid: 1, correctionGeneration: 1, manualOverrideUntil: NOW + 120_000 },
    };
    const net = buildNetSecondServerClaims(source, NOW);
    const sauce = net.find(({ channel }) => channel === "sauce-stock")!;
    expect(sauce).toBeDefined();
    const sauceAccepted = applyAutoTrackClaim(source, sauce, NOW);
    expect(sauceAccepted.outcome).toBe("accepted");
    expect(sauceAccepted.values.sauceStockBarrels).toBeLessThan(1);
    const app = buildNetSecondServerClaims(sauceAccepted.data, NOW)
      .find(({ channel }) => channel === "app1-stock")!;
    expect(app).toBeDefined();
    const appAccepted = applyAutoTrackClaim(sauceAccepted.data, app, NOW);
    expect(appAccepted.outcome).toBe("accepted");
    expect(appAccepted.values.app1StockConsumedLbs).toBeGreaterThan(0);

    const baseline = buildWallClockServerClaims(source, NOW)!;
    source.autoTrackServerState = { wallClockBookkeeping: { [RUN]: baseline.bookkeeping } };
    const nextDue = Math.max(
      baseline.bookkeeping.caseNextDueMs,
      baseline.bookkeeping.trayConsNextDueMs,
      baseline.bookkeeping.batchConsNextDueMs,
    );
    const wall = buildWallClockServerClaims(source, nextDue)!;
    const dough = wall.claims.find(({ channel }) => channel === "tray-consume" || channel === "batch-consume")!;
    expect(dough).toBeDefined();
    const doughAccepted = applyAutoTrackClaim(source, dough, nextDue);
    expect(doughAccepted.outcome).toBe("accepted");
    expect(doughAccepted.values.traysOnLine !== source.runValues[RUN].traysOnLine
      || doughAccepted.values.batchesReady !== source.runValues[RUN].batchesReady).toBe(true);
    const caseClaim = wall.claims.find(({ channel }) => channel === "case")!;
    expect(caseClaim).toBeDefined();
    expect(applyAutoTrackClaim(source, caseClaim, nextDue).outcome).toBe("conflict");
    const acceptedValues = appAccepted.data.runValues as Record<string, Record<string, unknown>>;
    expect(acceptedValues[RUN].traysOnLine).toBe(source.runValues[RUN].traysOnLine);
  });

  it("rejects a failed prior-run claim and rearms a new run without inheriting its stock or claims", () => {
    const runA = payload();
    const first = buildNetSecondServerClaims(runA, NOW).find(({ channel }) => channel === "app1-batch")!;
    const trackedA = applyAutoTrackClaim(runA, first, NOW);
    expect(trackedA.outcome).toBe("accepted");
    const pendingA = buildNetSecondServerClaims(trackedA.data, NOW + 120_000)
      .find(({ channel }) => channel === "app1-stock")!;
    const failedA = {
      ...pendingA,
      mutations: pendingA.mutations.map((mutation) =>
        mutation.field === "app1StockLbs" ? { ...mutation, from: mutation.from + 1 } : mutation),
    };
    expect(applyAutoTrackClaim(trackedA.data, failedA, NOW + 120_000).outcome).not.toBe("accepted");

    const next = structuredClone(trackedA.data) as any;
    next.dayState.runs[0].endedAt = NOW + 130_000;
    next.dayState.runs.push({
      id: "run-b", subTab: "crusts", startedAt: NOW + 140_000, metaUpdatedAt: NOW + 140_000,
    });
    next.dayState.currentIndex = 1;
    next.runValues["run-b"] = {
      ...next.runValues[RUN],
      app1BatchesMade: 0, app1StockLbs: 0, app1StockConsumedLbs: 0,
      app1BatchAnchorNetSec: 0, app1BatchCorrectionGeneration: 0,
      app1StockAnchorNetSec: 0, app1StockCorrectionGeneration: 0,
    };
    next.runValuesUpdatedAt["run-b"] = NOW + 140_000;
    const paused = structuredClone(next);
    paused.dayState.runs[1].pausedAt = NOW + 210_000;
    expect(buildNetSecondServerClaims(paused, NOW + 220_000)).toEqual([]);
    const claims = buildNetSecondServerClaims(next, NOW + 220_000);
    expect(claims.every(({ runId }) => runId === "run-b")).toBe(true);
    const batchB = claims.find(({ channel }) => channel === "app1-batch")!;
    expect(batchB).toBeDefined();
    expect(applyAutoTrackClaim(next, pendingA, NOW + 220_000).outcome).not.toBe("accepted");
    const resumed = applyAutoTrackClaim(next, batchB, NOW + 220_000);
    expect(resumed.outcome).toBe("accepted");
    expect(resumed.values.app1StockLbs).toBe(50);
    expect((resumed.data.runValues as Record<string, unknown>)[RUN])
      .toEqual((trackedA.data.runValues as Record<string, unknown>)[RUN]);
    expect(applyAutoTrackClaim(resumed.data, pendingA, NOW + 220_000).outcome).not.toBe("accepted");
  });

  it("rebases both Frontline channels after a correction without inheriting their old due times", () => {
    const source = payload({ app1BatchLbs: 25 });
    const first = buildNetSecondServerClaims(source, NOW).find(({ channel }) => channel === "app1-batch")!;
    const accepted = applyAutoTrackClaim(source, first, NOW);
    expect(accepted.outcome).toBe("accepted");
    const corrected = structuredClone(accepted.data) as any;
    Object.assign(corrected.runValues[RUN], {
      app1StockLbs: 12.5,
      app1BatchAnchorNetSec: 210, app1BatchCorrectionGeneration: 1,
      app1StockAnchorNetSec: 210, app1StockCorrectionGeneration: 1,
    });
    corrected.runValuesUpdatedAt[RUN] = NOW + 120_000;
    expect(buildNetSecondServerClaims(corrected, NOW + 120_000)
      .some(({ channel }) => channel.startsWith("app1"))).toBe(false);
    const next = buildNetSecondServerClaims(corrected, NOW + 150_000)
      .find(({ channel }) => channel === "app1-batch")!;
    expect(next.dueAt).toBeGreaterThan(210);
    expect(applyAutoTrackClaim(corrected, first, NOW + 150_000).outcome).not.toBe("accepted");
    const resumed = applyAutoTrackClaim(corrected, next, NOW + 150_000);
    expect(resumed.outcome).toBe("accepted");
    expect(resumed.values.app1StockLbs).toBe(37.5);
    expect(resumed.values.app1StockConsumedLbs).toBe(0);
    expect(resumed.values.sauceBarrelsMade).toBe(0);
  });

  it("carries old cumulative consumption once without presenting it as current stock", () => {
    const source = payload({
      app1BatchesMade: 2, app1BatchLbs: 25, app1StockLbs: 12.5,
      app1StockConsumedLbs: undefined,
    });
    const claims = buildNetSecondServerClaims(source, NOW);
    const batch = claims.find((claim) => claim.channel === "app1-batch")!;
    const loaded = applyAutoTrackClaim(source, batch, NOW);
    expect(loaded.outcome).toBe("accepted");
    expect(loaded.values).toMatchObject({
      app1StockConsumedLbs: 50, app1StockLbs: 37.5, app1BatchesMade: 3,
    });
    const stock = claims.find((claim) => claim.channel === "app1-stock")!;
    const legacyStock = { ...stock, mutations: stock.mutations.filter(({ field }) => field !== "app1StockConsumedLbs") };
    expect(parseAutoTrackClaim(legacyStock, NOW)).not.toBeNull();
    const consumed = applyAutoTrackClaim(source, legacyStock, NOW);
    expect(consumed.outcome).toBe("accepted");
    expect(consumed.values.app1StockConsumedLbs).toBeGreaterThan(50);
    expect(consumed.values.app1BatchesMade).toBe(2);
    const legacyBatch = { ...batch, mutations: batch.mutations.filter(({ field }) => field !== "app1StockLbs") };
    expect(parseAutoTrackClaim(legacyBatch, NOW)).not.toBeNull();
    expect(applyAutoTrackClaim(source, legacyBatch, NOW).outcome).toBe("conflict");
  });

  it("does not deplete an applicator when the case conversion is missing", () => {
    const claims = buildNetSecondServerClaims(payload({ pizzasPerCase: 0, app1StockLbs: 25 }), NOW);
    expect(claims.some(({ channel }) => channel.startsWith("app"))).toBe(false);
  });

  it("accounts through more than two lifetime batches in all four slots, including the fractional final load", () => {
    const overrides: Record<string, unknown> = {
      casesNeeded: 175, approxLineSpeed: 60,
      sauceOzPerPizza: 0, frontlineRecipeName: "",
    };
    const weights = [25, 20, 30, 40];
    for (let i = 1; i <= 4; i++) {
      const prefix = `app${i}`;
      Object.assign(overrides, {
        [`${prefix}Type`]: "Cheese",
        [`${prefix}OzPerPizza`]: weights[i - 1] * 0.08,
        [`${prefix}BatchLbs`]: weights[i - 1],
        [`${prefix}CheeseRecipe`]: [],
        [`${prefix}BatchesMade`]: 20,
        [`${prefix}BatchAnchorNetSec`]: 0,
        [`${prefix}BatchCorrectionGeneration`]: 0,
        [`${prefix}StockLbs`]: 2 * weights[i - 1],
        [`${prefix}StockConsumedLbs`]: 0,
        [`${prefix}StockAnchorNetSec`]: 0,
        [`${prefix}StockCorrectionGeneration`]: 0,
      });
    }
    let source: any = payload(overrides);
    // Begin exactly at run start; advance canonical claims, not UI countdowns.
    source.dayState.runs[0].startedAt = NOW;
    const production = [0, 0, 0, 0];
    for (let elapsed = 0; elapsed <= 2300; elapsed += 10) {
      const now = NOW + elapsed * 1000;
      for (const claim of buildNetSecondServerClaims(source, now)) {
        if (!/^app[1-4]-(stock|batch)$/.test(claim.channel)) continue;
        const result = applyAutoTrackClaim(source, claim, now);
        expect(result.outcome).toBe("accepted");
        source = result.data;
        const slot = Number(claim.channel[3]) - 1;
        if (claim.channel.endsWith("-batch")) {
          const change = claim.mutations.find(({ field }) => field === `app${slot + 1}StockLbs`)!;
          production[slot] += change.to - change.from;
        }
        const values = source.runValues[RUN];
        const stock = values[`app${slot + 1}StockLbs`];
        expect(stock).toBeGreaterThanOrEqual(0);
        expect(stock).toBeLessThanOrEqual(weights[slot] * 2 + 0.0001);
        expect(values[`app${slot + 1}StockConsumedLbs`] + stock)
          .toBeLessThanOrEqual(weights[slot] * 10.5 + 20 + 0.0001);
      }
    }
    for (let i = 1; i <= 4; i++) {
      // Preserve the existing 20 lb run buffer, without rounding the final load.
      expect(production[i - 1]).toBeCloseTo(weights[i - 1] * 8.5 + 20);
      expect(source.runValues[RUN][`app${i}BatchesMade`])
        .toBe(20 + Math.ceil(8.5 + 20 / weights[i - 1]));
    }
    expect(source.runValues[RUN].traysOnLine).toBe(2);
    expect(source.runValues[RUN].sauceBarrelsMade).toBe(0);
  });

  it("surfaces calculation failures so the server tick runner can record and retry them", () => {
    const failure = new Error("canonical calculation failed");
    const invalidPayload = new Proxy({}, {
      get() {
        throw failure;
      },
    });

    expect(() => buildNetSecondServerClaims(invalidPayload, NOW)).toThrow(failure);
  });

  it("honors the canonical per-run manual mode switch", () => {
    const source = payload();
    (source.dayState!.runs![0] as Record<string, unknown>).autoTrackDisabled = true;
    expect(buildNetSecondServerClaims(source, NOW)).toEqual([]);
    expect(buildWallClockServerClaims(source, NOW)).toBeNull();
  });

  it("builds one advancing net-second claim per eligible due channel", () => {
    const claims = buildNetSecondServerClaims(payload(), NOW);
    expect(claims.map((claim) => claim.channel)).toEqual(["sauce-barrel", "sauce-stock", "app1-batch"]);
    expect(claims.find((claim) => claim.channel === "sauce-barrel")?.mutations[0]?.to)
      .toBe(claims.find((claim) => claim.channel === "sauce-barrel")?.mutations[0]?.from! + 1);
    expect(claims.find((claim) => claim.channel === "sauce-stock")?.mutations[0]).toMatchObject({
      field: "sauceStockBarrels",
      from: 0,
      to: 2,
    });
    expect(claims.find((claim) => claim.channel === "app1-batch")?.mutations[0]?.to)
      .toBe(claims.find((claim) => claim.channel === "app1-batch")?.mutations[0]?.from! + 1);
  });

  it("initializes legacy Sauce stock once, then claims tenths without inventory effects", () => {
    const source = payload({
      sauceStockBarrels: 0,
      sauceStockAnchorNetSec: 0,
      sauceStockCorrectionGeneration: 0,
      sauceStockInitialized: false,
    });
    const initialClaim = buildNetSecondServerClaims(source, NOW)
      .find((claim) => claim.channel === "sauce-stock")!;
    expect(initialClaim.mutations).toEqual([
      { field: "sauceStockBarrels", from: 0, to: 2 },
      { field: "sauceStockAnchorNetSec", from: 0, to: initialClaim.dueAt },
      { field: "sauceStockCorrectionGeneration", from: 0, to: 0 },
    ]);
    const initialized = applyAutoTrackClaim(source as never, initialClaim, NOW);
    expect(initialized.outcome).toBe("accepted");
    expect(initialized.values).toMatchObject({
      sauceStockBarrels: 2,
      sauceStockInitialized: true,
      sauceStockAnchorNetSec: initialClaim.dueAt,
      sauceBarrelsMade: 0,
    });
    expect(initialized.inventoryConsumption).toBeUndefined();
    expect(applyAutoTrackClaim(initialized.data, initialClaim, NOW).outcome).toBe("duplicate");

    const secondsUntilNext = initialClaim.nextDueAt - initialClaim.dueAt;
    const nextClaim = buildNetSecondServerClaims(
      initialized.data,
      NOW + secondsUntilNext * 1000,
    ).find((claim) => claim.channel === "sauce-stock")!;
    expect(nextClaim.mutations[0]).toEqual({
      field: "sauceStockBarrels",
      from: 2,
      to: 1.9,
    });
    expect(nextClaim.mutations[1]).toMatchObject({
      field: "sauceStockAnchorNetSec",
      to: nextClaim.dueAt,
    });
    const depleted = applyAutoTrackClaim(
      initialized.data,
      nextClaim,
      NOW + secondsUntilNext * 1000,
    );
    expect(depleted.outcome).toBe("accepted");
    expect(depleted.values.sauceStockBarrels).toBe(1.9);
    expect(depleted.values.sauceBarrelsMade).toBe(0);
    expect(depleted.inventoryConsumption).toBeUndefined();
  });

  it("initializes legacy Sauce stock even when the current sauce rate is zero", () => {
    const source = payload({ sauceOzPerPizza: 0, sauceStockInitialized: false });
    const claim = buildNetSecondServerClaims(source, NOW)
      .find((entry) => entry.channel === "sauce-stock")!;
    expect(claim).toBeDefined();
    expect(claim.nextDueAt - claim.dueAt).toBe(1);
    expect(applyAutoTrackClaim(source as never, claim, NOW).outcome).toBe("accepted");
  });

  it("keeps a pass identity when rebuilding a claim after a committed event", () => {
    const source = payload();
    const tickNow = NOW + 180_000;
    const namespace = "tick-retry-identity";
    const first = buildNetSecondServerClaims(source, tickNow, namespace)
      .find((claim) => claim.channel === "app1-batch")!;
    const committed = applyAutoTrackClaim(source as never, first, tickNow);
    expect(committed.outcome).toBe("accepted");

    // A completed supply event rebases its anchor. It cannot be replayed at
    // the same instant, even while a tick pass retains its idempotency key.
    expect(buildNetSecondServerClaims(committed.data, tickNow, namespace)
      .find((claim) => claim.channel === "app1-batch")).toBeUndefined();
    const rebuilt = buildNetSecondServerClaims(committed.data, tickNow + 60_000, namespace)
      .find((claim) => claim.channel === "app1-batch");
    expect(rebuilt).toBeDefined();
    expect(rebuilt?.sequence).toBe(first.sequence + 1);
    expect(rebuilt?.eventId).toBe(first.eventId);
  });

  it("uses the cumulative Sauce requirement as the lifetime cap, not the staged cap", () => {
    const source = payload();
    const calc = computeServerCalc(source as never, [], NOW)!.calc;
    const requirement = computeSauceRunRequirement({
      casesNeeded: 200,
      pizzasPerCase: 12,
      ozPerPizza: 2,
      barrelLbs: calc.sauceEffBarrel,
    });
    expect(requirement.totalUnits).toBeGreaterThan(3);

    const atLifetimeCap = payload({
      sauceBarrelsMade: Math.ceil(requirement.totalUnits),
    });
    expect(buildNetSecondServerClaims(atLifetimeCap, NOW)
      .some((claim) => claim.channel === "sauce-barrel")).toBe(false);

    const belowLifetimeCap = payload({
      sauceBarrelsMade: Math.ceil(requirement.totalUnits) - 1,
    });
    expect(buildNetSecondServerClaims(belowLifetimeCap, NOW)
      .filter((claim) => claim.channel === "sauce-barrel")).toHaveLength(1);
  });

  it("does not invent automatic Frontline batch quantities for unknown weights", () => {
    const source = payload({
      app1BatchLbs: 0,
      app1CheeseRecipe: [],
      app1BatchesMade: 0,
    });
    expect(buildNetSecondServerClaims(source, NOW)
      .some((claim) => claim.channel === "app1-batch")).toBe(false);
    expect(buildNetSecondServerClaims(payload({ app1BatchLbs: 75 }), NOW)
      .some((claim) => claim.channel === "app1-batch")).toBe(false);
  });

  it("restarts net-second sequencing after a pause/resume lifecycle generation", () => {
    const source = payload();
    (source.dayState.runs[0] as Record<string, unknown>).metaUpdatedAt = 2;
    (source as Record<string, unknown>).autoTrackCoordination = {
      runs: {
        [RUN]: {
          "app1-batch": {
            generation: `${RUN}:1`,
            sequence: 2,
            acceptedEventId: "server:app1-batch:2",
          },
        },
      },
    };

    const claim = buildNetSecondServerClaims(source, NOW)
      .find((candidate) => candidate.channel === "app1-batch");
    expect(claim?.generation).toBe(`${RUN}:2`);
    expect(claim?.sequence).toBe(1);
    expect(applyAutoTrackClaim(source as never, claim!, NOW).outcome).toBe("accepted");
  });

  it("does not build net-second claims for invalid rates or paused runs", () => {
    expect(buildNetSecondServerClaims(payload({
      sauceOzPerPizza: 0,
      app1OzPerPizza: 0,
      sauceStockBarrels: 0,
      sauceStockInitialized: true,
    }), NOW)).toEqual([]);
    const paused = payload();
    (paused.dayState.runs[0] as Record<string, unknown>).pausedAt = NOW - 1;
    expect(buildNetSecondServerClaims(paused, NOW)).toEqual([]);
  });

  it("continues only the case channel while a paused powered tunnel drains", () => {
    const source = payload({
      freezerTime: 3,
      preTunnelMin: 0.5,
      postTunnelMin: 0.5,
      skidsCompleted: 1,
      casesOnCurrentSkid: 0,
      traysOnLine: 7,
      batchesReady: 2,
    });
    const run = source.dayState.runs[0] as Record<string, unknown>;
    run.pausedAt = NOW - 20_000;
    run.metaUpdatedAt = 2;
    run.stoppages = [{
      type: "pause",
      startedAt: run.pausedAt,
      stopTunnel: false,
    }];
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: {
        [RUN]: {
          lifecycleGeneration: `${RUN}:1`,
          caseNextDueMs: NOW - 1,
          trayConsNextDueMs: NOW - 1,
          trayProdNextDueMs: NOW - 1,
          batchConsNextDueMs: NOW - 1,
          batchProdNextDueMs: NOW - 1,
          hopperNextDueMs: NOW - 1,
          lastExpectedCases: 0,
        },
      },
    };
    (source as Record<string, unknown>).autoTrackCoordination = {
      runs: {
        [RUN]: {
          case: {
            generation: `${RUN}:1`,
            sequence: 4,
            nextDueAt: NOW - 1,
            acceptedEventId: "browser:case:4",
          },
        },
      },
    };

    // The lifecycle handoff baselines the pause clock and starts a full cadence.
    const baseline = buildWallClockServerClaims(source, NOW)!;
    expect(baseline.claims).toEqual([]);
    expect(baseline.bookkeeping.caseNextDueMs).toBeGreaterThan(NOW);
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: baseline.bookkeeping },
    };

    const dueAt = baseline.bookkeeping.caseNextDueMs;
    const due = buildWallClockServerClaims(source, dueAt)!;
    expect(due.claims.map((claim) => claim.channel)).toEqual(["case"]);
    expect(due.claims[0]).toMatchObject({
      generation: `${RUN}:2`,
      sequence: 1,
    });
    expect(due.claims[0]?.mutations).toEqual([
      { field: "skidsCompleted", from: 1, to: 1 },
      { field: "casesOnCurrentSkid", from: 0, to: 1 },
    ]);
    expect(due.bookkeeping.trayConsNextDueMs).toBe(baseline.bookkeeping.trayConsNextDueMs);
    expect(due.bookkeeping.batchConsNextDueMs).toBe(baseline.bookkeeping.batchConsNextDueMs);
    expect(buildNetSecondServerClaims(source, dueAt)).toEqual([]);

    const accepted = applyAutoTrackClaim(source as never, due.claims[0]!, dueAt);
    expect(accepted.outcome).toBe("accepted");
    expect((accepted.data.runValues as any)[RUN]).toMatchObject({
      skidsCompleted: 1,
      casesOnCurrentSkid: 1,
    });
    expect((accepted.data.packagingProgress as any)[RUN]).toMatchObject({
      skidsCompleted: 1,
      casesOnCurrentSkid: 1,
    });
    const restarted = {
      ...accepted.data,
      autoTrackServerState: {
        wallClockBookkeeping: { [RUN]: due.bookkeeping },
      },
    };
    expect(buildWallClockServerClaims(restarted, dueAt)!.claims).toEqual([]);
  });

  it("does not replay a paused-drain case across restart or manual suppression", () => {
    const source = payload({
      freezerTime: 3,
      preTunnelMin: 0.5,
      postTunnelMin: 0.5,
      casesOnCurrentSkid: 5,
    });
    const run = source.dayState.runs[0] as Record<string, unknown>;
    run.pausedAt = NOW - 20_000;
    run.metaUpdatedAt = 2;
    run.stoppages = [{ type: "pause", startedAt: run.pausedAt, stopTunnel: false }];
    const baseline = buildWallClockServerClaims(source, NOW)!;
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: baseline.bookkeeping },
    };
    (source as Record<string, unknown>).packagingProgress = {
      [RUN]: {
        correctionGeneration: 9,
        manualOverrideUntil: baseline.bookkeeping.caseNextDueMs + 60_000,
      },
    };

    const dueAt = baseline.bookkeeping.caseNextDueMs;
    const due = buildWallClockServerClaims(source, dueAt)!;
    expect(due.claims).toHaveLength(1);
    expect(applyAutoTrackClaim(source as never, due.claims[0]!, dueAt).outcome)
      .toBe("conflict");

    // Persisted bookkeeping advances despite the rejected claim. A restart at
    // the same wall time therefore cannot regenerate or double-apply that case.
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: due.bookkeeping },
    };
    expect(buildWallClockServerClaims(source, dueAt)!.claims).toEqual([]);
  });

  it("keeps a safely stopped tunnel out of wall-clock claims after its drain clears", () => {
    const source = payload({ freezerTime: 3, preTunnelMin: 0.5, postTunnelMin: 0.5 });
    const run = source.dayState.runs[0] as Record<string, unknown>;
    run.pausedAt = NOW - 3 * 60_000;
    run.metaUpdatedAt = 2;
    run.stoppages = [{ type: "pause", startedAt: run.pausedAt, stopTunnel: true }];
    expect(buildWallClockServerClaims(source, NOW)).toBeNull();
    expect(buildNetSecondServerClaims(source, NOW)).toEqual([]);
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

  it("does not let an overdue legacy case arm advance ahead of freezer eligibility", () => {
    const source = payload({ freezerTime: 3 });
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: { lifecycleGeneration: `${RUN}:1`, caseNextDueMs: NOW - 1 } },
    };
    const plan = buildWallClockServerClaims(source, NOW)!;
    expect(plan.claims.filter((claim) => claim.channel === "case")).toEqual([]);
    expect(plan.bookkeeping.lastExpectedCases).toBe(0);
    expect(plan.bookkeeping.caseNextDueMs).toBeGreaterThan(NOW);
  });

  it("emits a freezer-authorized legacy case beat and advances its arm", () => {
    const source = payload({ freezerTime: 3 });
    const dueAt = NOW + 150_000;
    (source as Record<string, unknown>).autoTrackServerState = {
      wallClockBookkeeping: { [RUN]: { lifecycleGeneration: `${RUN}:1`, caseNextDueMs: dueAt - 1 } },
    };
    const plan = buildWallClockServerClaims(source, dueAt)!;
    const caseClaim = plan.claims.find((claim) => claim.channel === "case")!;
    expect(caseClaim.mutations).toHaveLength(2);
    expect(caseClaim.mutations[1]).toEqual({
      field: "casesOnCurrentSkid",
      from: 0,
      to: 33,
    });
    expect(plan.bookkeeping.caseNextDueMs).toBeGreaterThan(dueAt);
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
    const source = payload({ freezerTime: 0 });
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
