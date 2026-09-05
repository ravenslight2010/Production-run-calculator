import { describe, it, expect } from "vitest";
import { computeCalc, computeServerCalc, type CalcFormValues, type CalcStoppage } from "./index";

/** Build a minimal CalcFormValues with sensible non-zero defaults. */
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
    skidsCompleted: 2,
    casesOnCurrentSkid: 4,
    traysOnLine: 0,
    batchesReady: 0,
    targetDoughballWeight: 0,
    doughRecipe: [],
    sauceBarrelLbs: 0,
    sauceOzPerPizza: 0,
    frontlineRecipe: [],
    app1OzPerPizza: 0, app1BatchLbs: 0, app1Type: "", app1CheeseRecipe: [],
    app2OzPerPizza: 0, app2BatchLbs: 0, app2Type: "", app2CheeseRecipe: [],
    app3OzPerPizza: 0, app3BatchLbs: 0, app3Type: "", app3CheeseRecipe: [],
    app4OzPerPizza: 0, app4BatchLbs: 0, app4Type: "", app4CheeseRecipe: [],
    pep1OzPerPizza: 0, pep1Sticks: 0, pep1BatchLbs: 0, pep1Type: "",
    pep2OzPerPizza: 0, pep2Sticks: 0, pep2BatchLbs: 0, pep2Type: "",
    pep1Combined: true,
    pep1TypeB: "", pep1OzPerPizzaB: 0, pep1SticksB: 0, pep1BatchLbsB: 0,
    pep2TypeB: "", pep2OzPerPizzaB: 0, pep2SticksB: 0, pep2BatchLbsB: 0,
    ...overrides,
  };
}

describe("computeCalc", () => {
  it("returns correct basic counts with known values", () => {
    const v = makeFormValues({ casesPerSkid: 8, casesOnCurrentSkid: 4, skidsCompleted: 2, casesNeeded: 100 });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.casesCompleted).toBe(20);
    expect(result.casesLeftToRun).toBe(80);
    expect(result.perTray).toBe(30);
  });

  it("computes line speed for dough mode", () => {
    const v = makeFormValues({ approxLineSpeed: 0, speedAdjustment: 1 });
    const ve = makeFormValues({ crustsPerCycle: 10, cycleSpeed: 60 });
    const result = computeCalc({ v, ve, nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.ppm).toBe(600);
  });

  it("computes line speed for crusts mode", () => {
    const v = makeFormValues({ approxLineSpeed: 150, speedAdjustment: 1 });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "crusts", defaultPepTypes: [] });
    expect(result.ppm).toBe(150);
  });

  it("returns zero line speed when all inputs are zero", () => {
    const result = computeCalc({ v: makeFormValues(), ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.ppm).toBe(0);
    expect(result.totalTimeSec).toBe(0);
  });

  it("handles sauce barrel calculation with recipe override", () => {
    const v = makeFormValues({
      casesNeeded: 10, casesOnCurrentSkid: 0, skidsCompleted: 0,
      frontlineRecipe: [{ ingredient: "Sauce", lbs: 50 }],
      sauceOzPerPizza: 4,
    });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.sauceEffBarrel).toBe(50);
    expect(result.sauceBatches).toBeGreaterThan(0);
  });

  it("handles sauce barrel calculation without recipe", () => {
    const v = makeFormValues({
      casesNeeded: 10, casesOnCurrentSkid: 0, skidsCompleted: 0,
      sauceBarrelLbs: 50, sauceOzPerPizza: 4,
    });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.sauceEffBarrel).toBe(50);
    expect(result.sauceBatches).toBeGreaterThan(0);
  });

  it("reports no pace when run has not started", () => {
    const result = computeCalc({ v: makeFormValues(), ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.paceStatus).toBeNull();
    expect(result.paceDelta).toBe(0);
  });

  it("press is done when cases completed plus freezer >= cases needed", () => {
    const v = makeFormValues({
      casesNeeded: 20, casesPerSkid: 10, skidsCompleted: 2,
      casesOnCurrentSkid: 0,
    });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.casesCompleted).toBe(20);
    expect(result.pressDone).toBe(true);
  });

  it("pepperoni default types skip batch calculation", () => {
    const v = makeFormValues({
      pep1Type: "Pepperoni Stick", pep1OzPerPizza: 2, pep1BatchLbs: 25, pep1Sticks: 0,
    });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: ["Pepperoni Stick"] });
    expect(result.pep1Batches).toBe(0);
  });

  it("non-default pep type with batch lb triggers batch calculation", () => {
    const v = makeFormValues({
      casesNeeded: 100, casesOnCurrentSkid: 0, skidsCompleted: 0,
      pep1Type: "Sliced Pep", pep1OzPerPizza: 2, pep1BatchLbs: 25, pep1Sticks: 0,
    });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: ["Pepperoni Stick"] });
    expect(result.pep1Batches).toBeGreaterThan(0);
  });

  it("applicator type containing 'mix' suppresses batch calc", () => {
    const v = makeFormValues({
      casesNeeded: 100, casesOnCurrentSkid: 0, skidsCompleted: 0,
      app1Type: "Cheese Mix", app1OzPerPizza: 4, app1BatchLbs: 25,
    });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.app1Batches).toBe(0);
  });

  it("non-mix applicator type calculates batches", () => {
    const v = makeFormValues({
      casesNeeded: 100, casesOnCurrentSkid: 0, skidsCompleted: 0,
      app1Type: "Mozzarella", app1OzPerPizza: 4, app1BatchLbs: 25,
    });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.app1Batches).toBeGreaterThan(0);
  });

  it("dough recipe recalculates batch yield when doughball weight set", () => {
    const v = makeFormValues({
      doughRecipe: [{ ingredient: "flour", lbs: 100 }],
      targetDoughballWeight: 16,
    });
    // Effective yield: (100 * 16) / 16 = 100 doughballs
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.perBatch).toBe(100);
  });

  it("handles empty dough recipe", () => {
    const v = makeFormValues({ doughRecipe: [], targetDoughballWeight: 16, doughBatchYield: 100 });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.perBatch).toBe(100);
  });

  it("time calculations scale with line speed", () => {
    const v = makeFormValues({ casesPerSkid: 10, pizzasPerCase: 12 });
    const ve = makeFormValues({ crustsPerCycle: 10, cycleSpeed: 60 });
    const result = computeCalc({ v, ve, nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    // ppm = 600; timePerSkidSec = (10 * 12 / 600) * 60 = 12s
    expect(result.timePerSkidSec).toBe(12);
    expect(result.timePerCaseSec).toBe(1.2);
  });

  it("rack times are computed for standard rack sizes", () => {
    const v = makeFormValues({ doughballsPerTray: 30 });
    const ve = makeFormValues({ crustsPerCycle: 10, cycleSpeed: 60 });
    const result = computeCalc({ v, ve, nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.rackTimes).toHaveLength(6);
    expect(result.rackTimes[0]).toEqual({ trays: 10, sec: 3 });
  });

  it("combined pep doubles sticks", () => {
    const v = makeFormValues({
      casesNeeded: 100, casesOnCurrentSkid: 0, skidsCompleted: 0,
      pep1Type: "Custom Pep", pep1OzPerPizza: 2, pep1BatchLbs: 25,
      pep1Sticks: 1, pep1Combined: true,
    });
    const result = computeCalc({ v, ve: makeFormValues(), nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.pep1Lbs).toBeGreaterThan(0);
  });

  it("sauce depletion time is calculated", () => {
    const v = makeFormValues({
      casesNeeded: 10, casesOnCurrentSkid: 0, skidsCompleted: 0,
      sauceBarrelLbs: 50, sauceOzPerPizza: 4,
    });
    const ve = makeFormValues({ crustsPerCycle: 10, cycleSpeed: 60 });
    const result = computeCalc({ v, ve, nowTimeMs: Date.now(), doughSubTab: "dough", defaultPepTypes: [] });
    expect(result.sauceDepletionSec).toBeGreaterThan(0);
  });
});

describe("computeServerCalc", () => {
  /** Build a server-calc payload, casting form values to the untyped server shape. */
  function payload(overrides: {
    runs?: unknown[];
    currentIndex?: number;
    runValues?: Record<string, CalcFormValues>;
    packagingProgress?: Record<string, { skidsCompleted: number; casesOnCurrentSkid: number }>;
  }): Parameters<typeof computeServerCalc>[0] {
    return {
      dayState: { runs: (overrides.runs ?? []) as never[], currentIndex: overrides.currentIndex },
      runValues: Object.fromEntries(
        Object.entries(overrides.runValues ?? {}).map(([id, vals]) => [id, vals as unknown as Record<string, unknown>]),
      ),
      packagingProgress: overrides.packagingProgress,
    } as Parameters<typeof computeServerCalc>[0];
  }

  it("returns null for empty runs", () => {
    expect(computeServerCalc({ dayState: { runs: [] } }, [])).toBeNull();
  });

  it("returns null when runValues are missing", () => {
    expect(computeServerCalc(
      { dayState: { runs: [{ id: "run-1" }], currentIndex: 0 }, runValues: {} },
      [],
    )).toBeNull();
  });

  it("computes calc from SyncPayload-shaped data", () => {
    const p = payload({
      runs: [{ id: "run-1", startedAt: Date.now() - 60000, subTab: "dough" }],
      currentIndex: 0,
      runValues: { "run-1": makeFormValues({ casesNeeded: 100, skidsCompleted: 2, casesOnCurrentSkid: 4 }) },
    });
    const result = computeServerCalc(p, []);
    expect(result).not.toBeNull();
    expect(result!.runId).toBe("run-1");
    expect(result!.calc.casesCompleted).toBe(20);
    expect(result!.calc.casesLeftToRun).toBe(80);
  });

  it("falls back to dough subTab when subTab is absent", () => {
    const p = payload({
      runs: [{ id: "run-1" }],
      currentIndex: 0,
      runValues: { "run-1": makeFormValues() },
    });
    expect(computeServerCalc(p, [])!.calc.perTray).toBe(30);
  });

  it("uses crustsPerStack when subTab is crusts", () => {
    const p = payload({
      runs: [{ id: "run-1", subTab: "crusts" }],
      currentIndex: 0,
      runValues: { "run-1": makeFormValues({ approxLineSpeed: 200 }) },
    });
    expect(computeServerCalc(p, [])!.calc.perTray).toBe(30);
  });

  it("returns null when runValues entry is not an object", () => {
    const p = payload({
      runs: [{ id: "run-1" }],
      currentIndex: 0,
      runValues: {} as Record<string, CalcFormValues>,
    });
    expect(computeServerCalc(p, [])).toBeNull();
  });

  it("defaults currentIndex to 0", () => {
    const p = payload({
      runs: [{ id: "run-a" }, { id: "run-b" }],
      runValues: { "run-a": makeFormValues({ casesNeeded: 50 }) },
    });
    expect(computeServerCalc(p, [])!.runId).toBe("run-a");
  });

  it("respects packagingProgress overrides", () => {
    const p = payload({
      runs: [{ id: "run-1" }],
      currentIndex: 0,
      runValues: { "run-1": makeFormValues({ casesNeeded: 100 }) },
      packagingProgress: { "run-1": { skidsCompleted: 5, casesOnCurrentSkid: 3 } },
    });
    expect(computeServerCalc(p, [])!.calc.casesCompleted).toBe(43);
  });
});
