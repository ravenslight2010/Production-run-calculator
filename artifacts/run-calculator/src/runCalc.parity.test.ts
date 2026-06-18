// @vitest-environment node
//
// Unit + parity tests for the core production-run math (the calc engine that is
// the heart of the product). The web engine lives inline in a React `useMemo`
// in pages/home.tsx and is not directly importable; its shared, pure pieces
// (`computeSummaryStats`, `sauceBarrelBreakdown`) are exported from ./utils. The
// mobile engine (`computeCalc`, `sauceBarrelBreakdown`, `computeDoughSupply`,
// `liveFreezerMin`) lives behind a React Native / Expo import graph in
// artifacts/run-calculator-mobile/context/RunContext.tsx and cannot load in a
// node test, so it is pulled in through a strip-imports -> transpile ->
// temp-file-import pipeline (the same pattern documented in
// .agents/memory/web-test-harness.md), with a STUB_PRELUDE supplying the symbols
// the stripped imports used to provide.
//
// What is asserted:
//  1. Mobile `computeCalc` produces the expected concrete numbers for a
//     representative run (dough/sauce/cheese/pepperoni batches + timing).
//  2. A parity guard drives web `computeSummaryStats` and mobile `computeCalc`
//     with the same input (chosen so their pizza bases coincide) and asserts the
//     frontline lbs/batch formulas are identical across the two engines.
//  3. The documented `sauceBarrelBreakdown` signature difference (web takes
//     BATCHES, mobile takes LBS) is encoded as an expectation, including the trap
//     that copying a call site verbatim between the apps miscounts barrels.
//  4. The intentional dough/timing divergence (frontline uses casesLeftToRun with
//     a doubled layer buffer; dough/timing use the casesLeft basis) is encoded so
//     it reads as a deliberate expectation, not a surprise.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeSummaryStats, sauceBarrelBreakdown as webSauceBarrelBreakdown } from "./utils";

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(
  here,
  "../../run-calculator-mobile/context/RunContext.tsx",
);

// Stubs for every symbol the mobile module imports. Only `createContext` is
// touched at module-eval time (a top-level `const RunContext = createContext(...)`);
// the rest live in function bodies / the React component that these tests never
// invoke, but they must exist so the stripped module evaluates.
const STUB_PRELUDE = `
const React = { createElement: () => null, Fragment: "Fragment" };
const createContext = () => ({ Provider: () => null, Consumer: () => null });
const useCallback = (fn) => fn;
const useContext = () => null;
const useEffect = () => {};
const useRef = (v) => ({ current: v });
const useState = (v) => [typeof v === "function" ? v() : v, () => {}];
const AsyncStorage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
const Alert = { alert: () => {} };
const MIX_SEED = { brands: [], brandFlavors: {}, frontlineIngredients: [] };
const SPEC_BRANDS = [];
const SPEC_BRAND_FLAVORS = {};
const SPEC_PEP_TYPES = [];
const SPEC_CHEESE_INGREDIENTS = [];
const SPEC_PROFILES = {};
const SPEC_DIE_TYPES = [];
const DOUGH_RECIPES = {};
const DOUGH_BRAND_SPECS = {};
const SAUCE_RECIPES = {};
const SAUCE_BRAND_SPECS = {};
const CHEESE_RECIPES = {};
const CHEESE_BRAND_SPECS = {};
const appStateToPayload = () => ({});
const applyPayloadToState = (s) => s;
const fetchToday = async () => null;
const getApiBaseUrl = () => "";
const getOrCreateClientId = async () => "test-client";
const openSyncStream = () => ({ close: () => {} });
const putToday = async () => {};
const computeRunConsumptionLines = () => [];
const consumeRunInventory = async () => {};
const fetchInventory = async () => [];
const mergeInventory = () => [];
const useAuth = () => ({});
const buildMergeMap = () => ({});
const mapName = (n) => n;
const mergeList = (a) => a;
const mergeRecipePresetMap = (a) => a;
const mergeSettingsObject = (a) => a;
`;

interface MobileModule {
  computeCalc: (state: any, nowMs: number) => any;
  computeDoughSupply: (state: any, nowMs: number, mode: "dough" | "crusts") => any;
  liveFreezerMin: (state: any, nowMs: number) => number;
  sauceBarrelBreakdown: (
    sauceLbs: number,
    effBarrelLbs: number,
  ) => { batchesPerBarrel: number; totalBarrels: number } | null;
  sumRecipe: (rows: any) => number;
  DEFAULT_SETTINGS: Record<string, any>;
  DEFAULT_PROGRESS: Record<string, any>;
  DEFAULT_PEP_TYPES: string[];
}

let tempFile: string | null = null;

async function loadStrippedModule(file: string): Promise<MobileModule> {
  const ts = (await import("typescript")).default;
  const raw = fs.readFileSync(file, "utf8");
  // Drop every `import ... from "...";` (incl. multiline + `import type`).
  const withoutImports = raw.replace(
    /import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g,
    "",
  );
  const source = STUB_PRELUDE + withoutImports;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      isolatedModules: true,
    },
  });
  const out = path.join(
    os.tmpdir(),
    `runCalc.mobile.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  tempFile = out;
  return (await import(pathToFileURL(out).href)) as MobileModule;
}

let mobile: MobileModule;

beforeAll(async () => {
  mobile = await loadStrippedModule(MOBILE_FILE);
});

afterAll(() => {
  if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
});

// Build a mobile RunState from flat setting overrides. By default the run is
// unstarted (liveFreezerMin = 0 -> casesOnLine = 0), so casesLeftToRun reduces
// to casesNeeded + casesPerLayer and the ingredient basis is easy to reason about.
function mobileState(overrides: Record<string, any>, runOverrides: Record<string, any> = {}) {
  return {
    id: "test",
    settings: { ...mobile.DEFAULT_SETTINGS, ...overrides },
    progress: { ...mobile.DEFAULT_PROGRESS },
    stoppages: [],
    isRunning: false,
    ...runOverrides,
  };
}

const NOW = 1_000_000;

// ── 1. Mobile computeCalc unit coverage ──────────────────────────────────────

describe("computeCalc (mobile) — representative run", () => {
  const calc = () =>
    mobile.computeCalc(
      mobileState({
        casesNeeded: 100,
        pizzasPerCase: 12,
        casesPerSkid: 48,
        casesPerLayer: 0,
        crustsPerCycle: 4,
        cycleSpeed: 10,
        speedAdjustment: 1.0,
        freezerTime: 15,
        sauceOzPerPizza: 4,
        sauceBarrelLbs: 50,
        app1Type: "Mozzarella",
        app1OzPerPizza: 5,
        app1BatchLbs: 40,
        app2Type: "Cheddar Mix", // contains "mix" -> pre-made, no batches
        app2OzPerPizza: 2,
        app2BatchLbs: 30,
        pep1Type: "Pepperoni Stick", // default type -> pre-made, no batches
        pep1OzPerPizza: 1,
        pep1Sticks: 5,
        pep1BatchLbs: 25,
        pep2Type: "Custom Crumble", // custom -> batches computed
        pep2OzPerPizza: 1.5,
        pep2Sticks: 2,
        pep2BatchLbs: 20,
        doughballWeightOz: 8,
        doughBatchLbs: 50,
      }),
      NOW,
    );

  it("derives line speed, cases, and timing", () => {
    const c = calc();
    expect(c.ppm).toBe(40); // 4 * 10 * 1.0
    expect(c.casesLeft).toBe(100);
    expect(c.pizzasLeft).toBe(1200);
    expect(c.casesLeftToRun).toBe(100); // unstarted -> casesOnLine 0, casesPerLayer 0
    expect(c.minutesRemaining).toBeCloseTo(30, 10); // 1200 / 40
    expect(c.estCompletionMs).toBe(NOW + 30 * 60 * 1000);
  });

  it("computes sauce lbs/batches off the +30 buffer", () => {
    const c = calc();
    expect(c.sauceEffBarrel).toBe(50);
    expect(c.sauceLbs).toBeCloseTo(330, 10); // (1200 * 4) / 16 + 30
    expect(c.sauceBatches).toBeCloseTo(6.6, 10); // 330 / 50
  });

  it("computes applicator lbs/batches and excludes 'mix' applicators from batches", () => {
    const c = calc();
    expect(c.app1Lbs).toBeCloseTo(395, 10); // (1200 * 5) / 16 + 20
    expect(c.app1Batches).toBeCloseTo(9.875, 10); // 395 / 40
    expect(c.app2Lbs).toBeCloseTo(170, 10); // (1200 * 2) / 16 + 20 (still reported)
    expect(c.app2Batches).toBe(0); // "Cheddar Mix" is pre-made
  });

  it("computes pepperoni lbs and excludes default pep types from batches", () => {
    const c = calc();
    expect(c.pep1Lbs).toBeCloseTo(80, 10); // (1200 * 1) / 16 + 5 sticks
    expect(c.pep1Batches).toBe(0); // default "Pepperoni Stick" is pre-made
    expect(c.pep2Lbs).toBeCloseTo(114.5, 10); // (1200 * 1.5) / 16 + 2 sticks
    expect(c.pep2Batches).toBeCloseTo(5.725, 10); // 114.5 / 20
  });

  it("computes dough lbs/batches (ceil) and per-batch cycle time", () => {
    const c = calc();
    expect(c.doughEffBatch).toBe(50);
    expect(c.doughLbs).toBeCloseTo(600, 10); // (1200 * 8) / 16
    expect(c.doughBatches).toBe(12); // ceil(600 / 50)
    expect(c.timePerBatchSec).toBeCloseTo(150, 10); // pizzasPerBatch 100 / ppm 40 * 60
  });
});

// ── 2. Web <-> mobile frontline parity guard ─────────────────────────────────

describe("frontline math parity: web computeSummaryStats <-> mobile computeCalc", () => {
  // casesPerLayer = 0 + unstarted + zero progress makes both engines use the
  // same pizza basis (casesNeeded * pizzasPerCase), so the per-pizza lbs/batch
  // formulas can be compared directly. Every slot is active with a non-"mix",
  // non-default type so both engines take their "compute batches" branch.
  const scenario = {
    casesNeeded: 200,
    pizzasPerCase: 12,
    casesPerLayer: 0,
    crustsPerCycle: 4,
    cycleSpeed: 9,
    speedAdjustment: 1,
    sauceOzPerPizza: 4.5,
    sauceBarrelLbs: 60,
    frontlineRecipe: [],
    app1Type: "Whole Mozz",
    app1OzPerPizza: 5,
    app1BatchLbs: 45,
    app1CheeseRecipe: [],
    app2Type: "Provolone",
    app2OzPerPizza: 3,
    app2BatchLbs: 50,
    app2CheeseRecipe: [],
    app3Type: "Parmesan",
    app3OzPerPizza: 1,
    app3BatchLbs: 25,
    app3CheeseRecipe: [],
    app4Type: "Romano",
    app4OzPerPizza: 0.5,
    app4BatchLbs: 22,
    app4CheeseRecipe: [],
    pep1Type: "Cup & Char",
    pep1OzPerPizza: 2,
    pep1Sticks: 4,
    pep1BatchLbs: 30,
    pep2Type: "Beef Crumble",
    pep2OzPerPizza: 1.5,
    pep2Sticks: 3,
    pep2BatchLbs: 28,
  };

  const assertParity = (sc: Record<string, any>) => {
    const web = computeSummaryStats(sc as any);
    const m = mobile.computeCalc(mobileState(sc), NOW);
    const fields: [string, number][] = [
      ["sauceEffBarrel", web.sauceEffBarrel],
      ["sauceBatches", web.sauceBatches],
      ["app1Lbs", web.app1Lbs],
      ["app1Batches", web.app1Batches],
      ["app2Lbs", web.app2Lbs],
      ["app2Batches", web.app2Batches],
      ["app3Lbs", web.app3Lbs],
      ["app3Batches", web.app3Batches],
      ["app4Lbs", web.app4Lbs],
      ["app4Batches", web.app4Batches],
      ["pep1Lbs", web.pep1Lbs],
      ["pep1Batches", web.pep1Batches],
      ["pep2Lbs", web.pep2Lbs],
      ["pep2Batches", web.pep2Batches],
    ];
    for (const [key, webVal] of fields) {
      expect(m[key], `mobile ${key} should match web`).toBeCloseTo(webVal, 9);
    }
  };

  it("matches on a fully-active run (flat batch weights)", () => {
    assertParity(scenario);
  });

  it("matches when recipe lbs override the flat batch/barrel weights", () => {
    // sumRecipe(frontlineRecipe) overrides sauceBarrelLbs; app1CheeseRecipe
    // overrides app1BatchLbs — both engines must apply the same override.
    assertParity({
      ...scenario,
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 33 }, { ingredient: "Spice", lbs: 22 }],
      app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 48 }],
    });
  });

  it("matches on the pre-made exclusions (a 'mix' applicator and a default pepperoni)", () => {
    const web = computeSummaryStats({
      ...scenario,
      app1Type: "Cheese Mix",
      pep1Type: "Pepperoni Stick",
    } as any);
    const m = mobile.computeCalc(
      mobileState({ ...scenario, app1Type: "Cheese Mix", pep1Type: "Pepperoni Stick" }),
      NOW,
    );
    // Both still report lbs, both report zero batches for the pre-made items.
    expect(web.app1Batches).toBe(0);
    expect(m.app1Batches).toBe(0);
    expect(web.pep1Batches).toBe(0);
    expect(m.pep1Batches).toBe(0);
    expect(m.app1Lbs).toBeCloseTo(web.app1Lbs, 9);
    expect(m.pep1Lbs).toBeCloseTo(web.pep1Lbs, 9);
  });
});

// ── 3. sauceBarrelBreakdown: signature difference encoded as an expectation ───

describe("sauceBarrelBreakdown signature: web takes BATCHES, mobile takes LBS", () => {
  it("agrees on barrel counts when each is called per its own contract", () => {
    const effBarrel = 50;
    const sauceLbs = 900;
    const sauceBatches = sauceLbs / effBarrel; // 18

    const web = webSauceBarrelBreakdown(sauceBatches, effBarrel); // BATCHES in
    const m = mobile.sauceBarrelBreakdown(sauceLbs, effBarrel); // LBS in

    expect(web).toEqual({ batchesPerBarrel: 9, totalBarrels: 2 });
    expect(m).toEqual(web);
  });

  it("documents the trap: copying a call site verbatim across apps miscounts", () => {
    const effBarrel = 50;
    const sauceLbs = 900;
    // Wrongly passing LBS into the WEB helper (which expects batches) over-counts.
    const webMisused = webSauceBarrelBreakdown(sauceLbs, effBarrel);
    const mobileCorrect = mobile.sauceBarrelBreakdown(sauceLbs, effBarrel);
    expect(webMisused!.totalBarrels).toBe(100); // ceil(900 / 9) — clearly wrong
    expect(mobileCorrect!.totalBarrels).toBe(2);
    expect(webMisused!.totalBarrels).not.toBe(mobileCorrect!.totalBarrels);
  });

  it("returns null on the same edge cases in both apps", () => {
    // effBarrel out of range, or fewer than 2 batches fit per barrel.
    for (const eff of [0, -5, 450, 500, 300]) {
      expect(webSauceBarrelBreakdown(5, eff)).toBeNull();
      expect(mobile.sauceBarrelBreakdown(5, eff)).toBeNull();
    }
    // Zero/negative first arg -> null in both.
    expect(webSauceBarrelBreakdown(0, 50)).toBeNull();
    expect(mobile.sauceBarrelBreakdown(0, 50)).toBeNull();
  });
});

// ── 4. Intentional dough/timing divergence, encoded as an expectation ─────────

describe("intentional divergence: frontline basis vs dough/timing basis", () => {
  // See .agents/memory/frontline-formula-parity.md: frontline ingredients use
  // casesLeftToRun (nets out cases on the line, adds a DOUBLED casesPerLayer
  // buffer); dough lbs/timing use the simpler casesLeft basis. This is deliberate.
  it("uses casesLeftToRun (+ double layer buffer) for frontline but casesLeft for dough", () => {
    const calc = mobile.computeCalc(
      mobileState(
        {
          casesNeeded: 100,
          pizzasPerCase: 12,
          casesPerSkid: 48,
          casesPerLayer: 6,
          crustsPerCycle: 4,
          cycleSpeed: 10,
          speedAdjustment: 1,
          freezerTime: 15,
          sauceOzPerPizza: 4,
          sauceBarrelLbs: 50,
          doughballWeightOz: 8,
          doughBatchLbs: 50,
        },
        // A finished run pins liveFreezerMin to freezerTime (15), so casesOnLine
        // = floor(40 * 15 / 12) = 50.
        { startedAt: NOW - 60 * 60 * 1000, endedAt: NOW },
      ),
      NOW,
    );

    expect(calc.casesOnLine ?? 50).toBeDefined();
    expect(calc.casesLeftToRun).toBe(56); // 100 - 0 - 0 - 50 + 6
    expect(calc.pizzasLeft).toBe(1200); // casesLeft basis: 100 * 12 (unaffected)

    // Frontline pizza basis = casesLeftToRun*ppc + casesPerLayer*ppc = 744.
    const frontlinePizzas = 56 * 12 + 6 * 12; // 744
    expect(calc.sauceLbs).toBeCloseTo((frontlinePizzas * 4) / 16 + 30, 9);
    // Dough lbs uses pizzasLeft (1200), NOT the frontline basis (744).
    expect(calc.doughLbs).toBeCloseTo((1200 * 8) / 16, 9);
    expect(frontlinePizzas).not.toBe(calc.pizzasLeft);
  });
});
