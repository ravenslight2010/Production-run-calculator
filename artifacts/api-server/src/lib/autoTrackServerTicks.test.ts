// Pure unit tests for the server tick claim builder. Kept DB-free on purpose
// (no module that binds @workspace/db at import), like protectRunValues.test.ts.
import { describe, it, expect } from "vitest";
import { buildNetSecondServerClaims, isServerTickChannel } from "./autoTrackServerTicks";
import { applyAutoTrackClaim, parseAutoTrackClaim } from "./autoTrackCoordination";

const RUN = "run-7a";
const NOW = 1_800_000_000_000;

const ID_RE = /^[A-Za-z0-9:_-]{1,160}$/;

function fullValues(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    casesNeeded: 240,
    crustsPerCycle: 12,
    cycleSpeed: 600,
    speedAdjustment: 1.0,
    approxLineSpeed: 450,
    freezerTime: 3.5,
    pizzasPerCase: 12,
    casesPerSkid: 48,
    casesPerLayer: 12,
    doughballsPerTray: 36,
    crustsPerStack: 6,
    doughBatchYield: 150,
    crustsPerCase: 12,
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
    traysOnLine: 0,
    batchesReady: 0,
    mixerLowSec: 330,
    mixerHighSec: 180,
    hopperSec: 70,
    carryOverDone: false,
    sauceOzPerPizza: 2,
    sauceBarrelLbs: 50,
    sauceBarrelsMade: 0,
    sauceBarrelAnchorNetSec: 0,
    sauceBarrelCorrectionGeneration: 0,
    app1OzPerPizza: 2.5,
    app1BatchLbs: 100,
    app1BatchesMade: 0,
    app1BatchAnchorNetSec: 0,
    app1BatchCorrectionGeneration: 0,
    app2OzPerPizza: 0,
    app2BatchLbs: 0,
    app2BatchesMade: 0,
    app2BatchAnchorNetSec: 0,
    app2BatchCorrectionGeneration: 0,
    app3OzPerPizza: 0,
    app3BatchLbs: 0,
    app3BatchesMade: 0,
    app3BatchAnchorNetSec: 0,
    app3BatchCorrectionGeneration: 0,
    app4OzPerPizza: 0,
    app4BatchLbs: 0,
    app4BatchesMade: 0,
    app4BatchAnchorNetSec: 0,
    app4BatchCorrectionGeneration: 0,
    pep1Sticks: 0,
    pep1OzPerPizza: 0,
    pep1BatchLbs: 0,
    pep2Sticks: 0,
    pep2OzPerPizza: 0,
    pep2BatchLbs: 0,
    pep1Combined: true,
    pep1TypeB: "",
    pep2TypeB: "",
    pep1SticksB: 0,
    pep1OzPerPizzaB: 0,
    pep1BatchLbsB: 0,
    pep2SticksB: 0,
    pep2OzPerPizzaB: 0,
    pep2BatchLbsB: 0,
    app1Type: "app",
    app2Type: "",
    app3Type: "",
    app4Type: "",
    pep1Type: "",
    pep2Type: "",
    dieType: "Round 12",
    allergen: "none",
    doughRecipeName: "",
    targetDoughballWeight: 8,
    doughRecipe: [],
    app1CheeseRecipeName: "",
    app1CheeseRecipe: [],
    app2CheeseRecipeName: "",
    app2CheeseRecipe: [],
    app3CheeseRecipeName: "",
    app3CheeseRecipe: [],
    app4CheeseRecipeName: "",
    app4CheeseRecipe: [],
    frontlineRecipeName: "Classic Sauce",
    frontlineRecipe: [],
    ...overrides,
  };
}

function makePayload(options: {
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  values?: Record<string, unknown>;
  coordination?: Record<string, unknown>;
  stamp?: number;
} = {}): unknown {
  return {
    dayState: {
      runs: [{
        id: RUN,
        brand: "Acme",
        flavor: "Pep",
        subTab: "crusts",
        startedAt: options.startedAt ?? NOW - 600_000,
        metaUpdatedAt: 1,
        ...(options.pausedAt ? { pausedAt: options.pausedAt } : {}),
        ...(options.endedAt ? { endedAt: options.endedAt } : {}),
      }],
    },
    runValues: { [RUN]: options.values ?? fullValues() },
    runValuesUpdatedAt: { [RUN]: options.stamp ?? 1000 },
    ...(options.coordination
      ? { autoTrackCoordination: { version: 1, runs: { [RUN]: options.coordination } } }
      : {}),
  };
}

describe("buildNetSecondServerClaims", () => {
  it("builds due sauce-barrel and app1-batch claims for a live run", () => {
    const claims = buildNetSecondServerClaims(makePayload(), NOW);
    expect(claims.map((c) => c.channel)).toEqual(["sauce-barrel", "app1-batch"]);
    const sauce = claims.find((c) => c.channel === "sauce-barrel")!;
    expect(sauce.sequence).toBe(1);
    expect(sauce.generation).toBe(`${RUN}:1`);
    expect(sauce.baseUpdatedAt).toBe(1000);
    expect(sauce.correctionGeneration).toBe(0);
    expect(sauce.dueAt).toBeCloseTo(53.333, 3);
    expect(sauce.nextDueAt).toBeCloseTo(106.667, 3);
    expect(sauce.eventId).toMatch(ID_RE);
    expect(sauce.eventId.startsWith(`srv:1:sauce-barrel:`)).toBe(true);
    expect(sauce.mutations).toEqual([
      { field: "sauceBarrelsMade", from: 0, to: 1 },
      { field: "sauceBarrelAnchorNetSec", from: 0, to: sauce.dueAt },
      { field: "sauceBarrelCorrectionGeneration", from: 0, to: 0 },
    ]);
    const app1 = claims.find((c) => c.channel === "app1-batch")!;
    expect(app1.sequence).toBe(1);
    expect(app1.mutations).toEqual([
      { field: "app1BatchesMade", from: 0, to: 1 },
      { field: "app1BatchAnchorNetSec", from: 0, to: app1.dueAt },
      { field: "app1BatchCorrectionGeneration", from: 0, to: 0 },
    ]);
  });

  it("returns nothing when the net-second due has not arrived yet", () => {
    const claims = buildNetSecondServerClaims(makePayload({ startedAt: NOW - 30_000 }), NOW);
    expect(claims).toEqual([]);
  });

  it("returns nothing for paused or ended runs", () => {
    expect(buildNetSecondServerClaims(makePayload({ pausedAt: NOW - 10_000 }), NOW)).toEqual([]);
    expect(buildNetSecondServerClaims(makePayload({ endedAt: NOW - 10_000 }), NOW)).toEqual([]);
  });

  it("returns nothing after press-done", () => {
    const claims = buildNetSecondServerClaims(makePayload({ values: fullValues({ skidsCompleted: 10 }) }), NOW);
    expect(claims).toEqual([]);
  });

  it("skips channels with no computable schedule (skeletal values)", () => {
    const claims = buildNetSecondServerClaims({
      dayState: { runs: [{ id: RUN, brand: "Acme", flavor: "Pep" }] },
      runValues: { [RUN]: { casesNeeded: 240 } },
      runValuesUpdatedAt: { [RUN]: 1 },
    }, NOW);
    expect(claims).toEqual([]);
  });

  it("advances the sequence from the coordination record", () => {
    const coordination = {
      "sauce-barrel": { generation: `${RUN}:1`, sequence: 2, nextDueAt: 106.667, updatedAt: 0 },
    };
    const claims = buildNetSecondServerClaims(makePayload({ coordination }), NOW);
    expect(claims.find((c) => c.channel === "sauce-barrel")!.sequence).toBe(3);
  });

  it("round-trips through the same parse+apply pipeline as a client claim", () => {
    const payload = makePayload();
    const claims = buildNetSecondServerClaims(payload, NOW);
    let stored: unknown = payload;
    for (const raw of claims) {
      const parsed = parseAutoTrackClaim(raw, NOW);
      expect(parsed).not.toBeNull();
      const applied = applyAutoTrackClaim(stored, parsed!, NOW);
      expect(applied.outcome).toBe("accepted");
      // Each claim applies against the previous channel's accepted row, the
      // same way the DB runner serializes claims per date.
      stored = applied.data;
    }
    const data = stored as {
      runValues: Record<string, Record<string, unknown>>;
      autoTrackCoordination: {
        runs: Record<string, Partial<Record<string, { sequence?: number }>>>;
      };
    };
    expect(data.runValues[RUN].sauceBarrelsMade).toBe(1);
    expect(data.runValues[RUN].app1BatchesMade).toBe(1);
    expect(data.autoTrackCoordination.runs[RUN]!["sauce-barrel"]!.sequence).toBe(1);
    expect(data.autoTrackCoordination.runs[RUN]!["app1-batch"]!.sequence).toBe(1);
  });

  it("never double-increments a channel within one pass", () => {
    const payload = makePayload();
    const [sauce, app1] = buildNetSecondServerClaims(payload, NOW);
    const parsed = parseAutoTrackClaim(sauce!, NOW)!;
    const first = applyAutoTrackClaim(payload as never, parsed, NOW);
    expect(first.outcome).toBe("accepted");
    // The same identity re-applied to the persisted row is a duplicate
    // (transport retry) — never a second increment.
    const retry = applyAutoTrackClaim(first.data, parseAutoTrackClaim(sauce!, NOW)!, NOW);
    expect(retry.outcome).toBe("duplicate");
    // A concurrent pass that read the SAME pre-claim snapshot rebuilds
    // sequence 1 with a FRESH event identity; once the first claim is
    // persisted (first.data), that rerun is rejected by the sequence register
    // instead of double-incrementing.
    const rerunSauce = buildNetSecondServerClaims(payload, NOW).find((c) => c.channel === "sauce-barrel")!;
    expect(rerunSauce.sequence).toBe(1);
    expect(rerunSauce.eventId).not.toBe(sauce!.eventId);
    const again = applyAutoTrackClaim(first.data, parseAutoTrackClaim(rerunSauce, NOW)!, NOW);
    expect(again.outcome).toBe("stale");
    expect((first.data as { runValues: Record<string, Record<string, unknown>> }).runValues[RUN].sauceBarrelsMade).toBe(1);
    expect(app1).toBeDefined();
  });

  it("mirrors the client safety gate: legacy sauce runs conflict until the correction register exists, app slots default to zero", () => {
    const legacyValues = { ...fullValues() };
    delete legacyValues.sauceBarrelCorrectionGeneration;
    delete legacyValues.sauceBarrelAnchorNetSec;
    delete legacyValues.app1BatchCorrectionGeneration;
    const payload = makePayload({ values: legacyValues });
    const claims = buildNetSecondServerClaims(payload, NOW);
    const sauce = claims.find((c) => c.channel === "sauce-barrel")!;
    const app1 = claims.find((c) => c.channel === "app1-batch")!;
    expect(sauce.correctionGeneration).toBe(0);
    expect(app1.correctionGeneration).toBe(0);
    const sauceApplied = applyAutoTrackClaim(payload as never, parseAutoTrackClaim(sauce, NOW)!, NOW);
    expect(sauceApplied.outcome).toBe("conflict");
    const app1Applied = applyAutoTrackClaim(payload as never, parseAutoTrackClaim(app1, NOW)!, NOW);
    expect(app1Applied.outcome).toBe("accepted");
    expect(app1Applied.values.app1BatchesMade).toBe(1);
  });

  it("exposes the server-tick channel allowlist", () => {
    expect(isServerTickChannel("sauce-barrel")).toBe(true);
    expect(isServerTickChannel("app4-batch")).toBe(true);
    expect(isServerTickChannel("case")).toBe(false);
    expect(isServerTickChannel("tray-consume")).toBe(false);
  });
});
