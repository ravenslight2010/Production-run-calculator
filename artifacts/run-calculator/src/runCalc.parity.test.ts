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
//  5. The dough/crust SUPPLY math (trays/batches needed, cases left to open,
//     staged dough-on-hand, buffer, depletion) — duplicated as mobile
//     `computeDoughSupply` and an inline `useMemo` in the web pages/home.tsx — is
//     locked: concrete unit expectations for both modes (incl. ceil rounding) plus
//     a parity guard against a faithful transcription of the web inline formula
//     (`webDoughSupply`), with the two crust-mode divergences (perBatch source and
//     the casesOnLine ppm source) encoded as deliberate expectations.
//  6. The run TIMING / PACE / CATCH-UP math — per-tray/-batch/-skid/-case seconds,
//     total + freeze-tunnel-adjusted time, the pace gauge (ahead/behind/on-pace
//     within a +/-2 case tolerance vs expected cases), and the catch-up PPM when
//     behind — is web-only (it lives inline in the same pages/home.tsx `calc`
//     useMemo; the mobile engine has no pace/catch-up and no "pause" stoppage
//     type). It is locked via a faithful transcription (`webTiming`) with concrete
//     unit expectations across pending/started/paused/ended runs, with and without
//     stoppages, and the non-pause downtime-exclusion + freeze-tunnel rules
//     encoded as expectations. Mobile's own timing outputs (timePerBatchSec is
//     covered in section 1; downtime/elapsed are covered here in section 6b).

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

  it("computes pepperoni lbs and batches (no built-in default pep types post-purge)", () => {
    const c = calc();
    expect(c.pep1Lbs).toBeCloseTo(80, 10); // (1200 * 1) / 16 + 5 sticks
    // DEFAULT_PEP_TYPES is intentionally empty since the 2026-07-03 data
    // purge, so no pep type is treated as pre-made by default anymore.
    expect(c.pep1Batches).toBeCloseTo(3.2, 10); // 80 / 25
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

  it("matches on the 'mix' applicator exclusion (no default pep types post-purge)", () => {
    const web = computeSummaryStats({
      ...scenario,
      app1Type: "Cheese Mix",
      pep1Type: "Pepperoni Stick",
    } as any);
    const m = mobile.computeCalc(
      mobileState({ ...scenario, app1Type: "Cheese Mix", pep1Type: "Pepperoni Stick" }),
      NOW,
    );
    // "mix"-named applicators are still pre-made (zero batches) on both.
    expect(web.app1Batches).toBe(0);
    expect(m.app1Batches).toBe(0);
    // DEFAULT_PEP_TYPES is intentionally empty since the 2026-07-03 data
    // purge, so "Pepperoni Stick" is no longer pre-made — both engines
    // compute batches and must agree. pep1Lbs = (2400*2)/16 + 4 = 304;
    // batches = 304 / 30.
    expect(web.pep1Batches).toBeCloseTo(304 / 30, 9);
    expect(m.pep1Batches).toBeCloseTo(web.pep1Batches, 9);
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

// ── 5. Dough / crust supply math (computeDoughSupply) ─────────────────────────
//
// The web supply math lives inline in a `useMemo` in pages/home.tsx and is NOT
// importable (unlike the frontline math, which is shared via @workspace/
// inventory-math). `webDoughSupply` below is a faithful, line-for-line
// transcription of that inline block (home.tsx, the `calc` useMemo: ppm /
// perTray / effectiveDoughBatchYield / perBatch / casesOnLine / casesLeftToRun /
// totalPizzasLeft / doughOnHand / doughDeficit / batchesNeeded / traysNeeded /
// pizzasNetOfStaged / casesLeftToOpen / stacksNeededTotal / buffer /
// doughShortCases). If the web inline formula changes, update this transcription
// in lockstep — the parity guard exists to make a silent divergence loud.
//
// Web/mobile field-name differences encoded here:
//   - web `targetDoughballWeight`  ↔ mobile `doughballWeightOz`
//   - web `approxLineSpeed`        ↔ mobile `lineSpeedPPM`
//   - web reads skidsCompleted / casesOnCurrentSkid / traysOnLine / batchesReady
//     from settings; mobile reads them from `progress`.
// Two intentional crust-mode divergences are asserted, not smoothed over:
//   - perBatch: web uses crustsPerCase, mobile uses effectiveDoughBatchYield.
//   - casesOnLine ppm: web uses approxLineSpeed, mobile reuses the dough ppm
//     (crustsPerCycle*cycleSpeed*speedAdjustment, else lineSpeedPPM). This only
//     bites once a run has started (freezerTime > 0); unstarted runs coincide.

interface DoughSupplyVals {
  approxLineSpeed: number;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  crustsPerStack: number;
  doughballsPerTray: number;
  doughRecipe?: { lbs?: number }[];
  targetDoughballWeight: number;
  doughBatchYield: number;
  crustsPerCase: number;
  casesNeeded: number;
  skidsCompleted: number;
  casesPerSkid: number;
  casesOnCurrentSkid: number;
  casesPerLayer: number;
  pizzasPerCase: number;
  traysOnLine: number;
  batchesReady: number;
}

// Faithful transcription of the web pages/home.tsx inline supply useMemo.
function webDoughSupply(
  v: DoughSupplyVals,
  liveFreezerMin: number,
  doughSubTab: "dough" | "crusts",
) {
  const ppm =
    doughSubTab === "crusts"
      ? v.approxLineSpeed
      : v.crustsPerCycle * v.cycleSpeed * v.speedAdjustment;
  const perTray = doughSubTab === "crusts" ? v.crustsPerStack : v.doughballsPerTray;
  const doughRecipeLbs = (v.doughRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const effectiveDoughBatchYield =
    doughRecipeLbs > 0 && v.targetDoughballWeight > 0
      ? (doughRecipeLbs * 16) / v.targetDoughballWeight
      : v.doughBatchYield;
  const perBatch = doughSubTab === "crusts" ? v.crustsPerCase : effectiveDoughBatchYield;
  const freezerTime = liveFreezerMin;
  const casesOnLine =
    ppm > 0 ? Math.floor((ppm * freezerTime) / v.pizzasPerCase) : 0;
  const casesLeftToRun =
    v.casesNeeded -
    v.skidsCompleted * v.casesPerSkid -
    v.casesOnCurrentSkid -
    casesOnLine +
    v.casesPerLayer;
  const totalPizzasLeft = casesLeftToRun * v.pizzasPerCase;
  const doughOnHand =
    v.traysOnLine * perTray + v.batchesReady * effectiveDoughBatchYield;
  const doughDeficit = Math.max(0, totalPizzasLeft - doughOnHand);
  const batchesNeeded = doughDeficit / effectiveDoughBatchYield;
  const traysNeeded = doughDeficit / perTray;
  const pizzasNetOfStaged = Math.max(0, totalPizzasLeft - v.traysOnLine * perTray);
  const casesLeftToOpen =
    v.crustsPerCase > 0 ? Math.ceil(pizzasNetOfStaged / v.crustsPerCase) : 0;
  const stacksNeededTotal =
    perTray > 0 ? Math.ceil(pizzasNetOfStaged / perTray) : 0;
  const buffer = Math.max(0, doughOnHand - totalPizzasLeft) / v.pizzasPerCase;
  const doughShortCases = doughDeficit / v.pizzasPerCase;
  return {
    perTray,
    perBatch,
    casesOnLine,
    casesLeftToRun,
    totalPizzasLeft,
    doughOnHand,
    doughDeficit,
    batchesNeeded,
    traysNeeded,
    casesLeftToOpen,
    stacksNeededTotal,
    buffer,
    doughShortCases,
  };
}

// Build a mobile RunState whose progress fields drive computeDoughSupply, and
// whose started/ended flags produce a known liveFreezerMin (0 unstarted; the
// settings.freezerTime when ended).
function supplyState(
  settings: Record<string, any>,
  progress: Record<string, any> = {},
  started = false,
) {
  const runOverrides: Record<string, any> = {
    progress: { ...mobile.DEFAULT_PROGRESS, ...progress },
  };
  if (started) {
    runOverrides.startedAt = NOW - 60 * 60 * 1000;
    runOverrides.endedAt = NOW; // ended -> liveFreezerMin === settings.freezerTime
  }
  return mobileState(settings, runOverrides);
}

describe("computeDoughSupply (mobile) — dough mode unit coverage", () => {
  it("computes trays/batches/cases needed for an unstarted run with no staged dough", () => {
    const d = mobile.computeDoughSupply(
      supplyState({
        casesNeeded: 100,
        pizzasPerCase: 12,
        casesPerSkid: 48,
        casesPerLayer: 6,
        crustsPerCycle: 4,
        cycleSpeed: 10,
        speedAdjustment: 1,
        doughballsPerTray: 60,
        doughBatchYield: 300,
        doughballWeightOz: 8,
        crustsPerCase: 12,
      }),
      NOW,
      "dough",
    );
    expect(d.perTray).toBe(60);
    expect(d.perBatch).toBe(300); // dough mode -> effectiveDoughBatchYield
    expect(d.casesOnLine).toBe(0); // unstarted -> liveFreezerMin 0
    expect(d.casesLeftToRun).toBe(106); // 100 - 0 - 0 - 0 + 6
    expect(d.totalPizzasLeft).toBe(1272); // 106 * 12
    expect(d.doughOnHand).toBe(0);
    expect(d.doughDeficit).toBe(1272);
    expect(d.batchesNeeded).toBeCloseTo(4.24, 10); // 1272 / 300
    expect(d.traysNeeded).toBeCloseTo(21.2, 10); // 1272 / 60
    expect(d.casesLeftToOpen).toBe(106); // ceil(1272 / 12)
    expect(d.stacksNeededTotal).toBe(22); // ceil(1272 / 60) = ceil(21.2)
    expect(d.buffer).toBe(0);
    expect(d.doughShortCases).toBeCloseTo(106, 10); // 1272 / 12
  });

  it("nets out cases-on-line and staged dough for a started run", () => {
    const d = mobile.computeDoughSupply(
      supplyState(
        {
          casesNeeded: 100,
          pizzasPerCase: 12,
          casesPerSkid: 48,
          casesPerLayer: 6,
          crustsPerCycle: 4,
          cycleSpeed: 10,
          speedAdjustment: 1,
          freezerTime: 15,
          doughballsPerTray: 60,
          doughBatchYield: 300,
          doughballWeightOz: 8,
          crustsPerCase: 12,
        },
        { traysOnLine: 2, batchesReady: 1 },
        true, // ended -> liveFreezerMin = 15
      ),
      NOW,
      "dough",
    );
    expect(d.casesOnLine).toBe(50); // floor(40 * 15 / 12)
    expect(d.casesLeftToRun).toBe(56); // 100 - 0 - 0 - 50 + 6
    expect(d.totalPizzasLeft).toBe(672); // 56 * 12
    expect(d.doughOnHand).toBe(420); // 2*60 + 1*300
    expect(d.doughDeficit).toBe(252); // 672 - 420
    expect(d.batchesNeeded).toBeCloseTo(0.84, 10); // 252 / 300
    expect(d.traysNeeded).toBeCloseTo(4.2, 10); // 252 / 60
    expect(d.casesLeftToOpen).toBe(46); // ceil((672 - 120) / 12) = ceil(46)
    expect(d.stacksNeededTotal).toBe(10); // ceil(552 / 60) = ceil(9.2)
    expect(d.buffer).toBe(0);
    expect(d.doughShortCases).toBeCloseTo(21, 10); // 252 / 12
  });

  it("reports a positive buffer (and zero deficit) when staged dough exceeds demand", () => {
    const d = mobile.computeDoughSupply(
      supplyState(
        {
          casesNeeded: 100,
          pizzasPerCase: 12,
          casesPerSkid: 48,
          casesPerLayer: 6,
          crustsPerCycle: 4,
          cycleSpeed: 10,
          speedAdjustment: 1,
          freezerTime: 15,
          doughballsPerTray: 60,
          doughBatchYield: 300,
          doughballWeightOz: 8,
          crustsPerCase: 12,
        },
        { skidsCompleted: 1, casesOnCurrentSkid: 3, traysOnLine: 5, batchesReady: 1 },
        true,
      ),
      NOW,
      "dough",
    );
    expect(d.casesLeftToRun).toBe(5); // 100 - 48 - 3 - 50 + 6
    expect(d.totalPizzasLeft).toBe(60); // 5 * 12
    expect(d.doughOnHand).toBe(600); // 5*60 + 1*300
    expect(d.doughDeficit).toBe(0); // max(0, 60 - 600)
    expect(d.batchesNeeded).toBe(0);
    expect(d.traysNeeded).toBe(0);
    expect(d.casesLeftToOpen).toBe(0); // max(0, 60 - 300) -> 0
    expect(d.stacksNeededTotal).toBe(0);
    expect(d.buffer).toBeCloseTo(45, 10); // (600 - 60) / 12
    expect(d.doughShortCases).toBe(0);
  });

  it("derives batch yield from the dough recipe + doughball weight when present", () => {
    const d = mobile.computeDoughSupply(
      supplyState({
        casesNeeded: 50,
        pizzasPerCase: 12,
        casesPerSkid: 48,
        casesPerLayer: 6,
        crustsPerCycle: 4,
        cycleSpeed: 10,
        speedAdjustment: 1,
        doughballsPerTray: 60,
        doughBatchYield: 300, // overridden by the recipe below
        doughballWeightOz: 8,
        crustsPerCase: 12,
        doughRecipe: [
          { ingredient: "Flour", lbs: 50 },
          { ingredient: "Water", lbs: 30 },
        ],
      }),
      NOW,
      "dough",
    );
    // (80 lbs * 16) / 8 oz = 160 doughballs/batch -> overrides the flat 300.
    expect(d.perBatch).toBeCloseTo(160, 10);
    expect(d.totalPizzasLeft).toBe(672); // (50 + 6) * 12
    expect(d.doughDeficit).toBe(672);
    expect(d.batchesNeeded).toBeCloseTo(4.2, 10); // 672 / 160
    expect(d.stacksNeededTotal).toBe(12); // ceil(672 / 60) = ceil(11.2)
  });
});

describe("computeDoughSupply (mobile) — crusts mode unit coverage", () => {
  it("uses crustsPerStack as the per-tray basis (perBatch keeps batch yield)", () => {
    const d = mobile.computeDoughSupply(
      supplyState({
        casesNeeded: 100,
        pizzasPerCase: 12,
        casesPerSkid: 48,
        casesPerLayer: 6,
        crustsPerCycle: 4,
        cycleSpeed: 10,
        speedAdjustment: 1,
        crustsPerStack: 40,
        doughballsPerTray: 60, // ignored in crusts mode
        doughBatchYield: 300,
        doughballWeightOz: 8,
        crustsPerCase: 12,
      }),
      NOW,
      "crusts",
    );
    expect(d.perTray).toBe(40); // crustsPerStack, not doughballsPerTray
    expect(d.perBatch).toBe(300); // mobile keeps effectiveDoughBatchYield even in crusts
    expect(d.casesLeftToRun).toBe(106);
    expect(d.totalPizzasLeft).toBe(1272);
    expect(d.traysNeeded).toBeCloseTo(31.8, 10); // 1272 / 40
    expect(d.stacksNeededTotal).toBe(32); // ceil(1272 / 40) = ceil(31.8)
    expect(d.casesLeftToOpen).toBe(106); // ceil(1272 / 12)
  });
});

describe("computeDoughSupply (mobile) — ceil/floor edge cases", () => {
  const base = {
    casesNeeded: 0,
    pizzasPerCase: 1, // 1 pizza per case so totalPizzasLeft == casesLeftToRun
    casesPerSkid: 48,
    casesPerLayer: 0,
    crustsPerCycle: 4,
    cycleSpeed: 10,
    speedAdjustment: 1,
    doughballsPerTray: 25,
    doughBatchYield: 300,
    doughballWeightOz: 8,
    crustsPerCase: 25,
  };

  it("casesLeftToOpen / stacksNeededTotal hit the boundary exactly on a clean multiple", () => {
    const d = mobile.computeDoughSupply(
      supplyState({ ...base, casesNeeded: 100 }),
      NOW,
      "dough",
    );
    expect(d.totalPizzasLeft).toBe(100);
    expect(d.casesLeftToOpen).toBe(4); // ceil(100 / 25) -> exact 4
    expect(d.stacksNeededTotal).toBe(4); // ceil(100 / 25) -> exact 4
  });

  it("a single pizza over the boundary rounds both up by one", () => {
    const d = mobile.computeDoughSupply(
      supplyState({ ...base, casesNeeded: 101 }),
      NOW,
      "dough",
    );
    expect(d.totalPizzasLeft).toBe(101);
    expect(d.casesLeftToOpen).toBe(5); // ceil(101 / 25) = ceil(4.04)
    expect(d.stacksNeededTotal).toBe(5); // ceil(101 / 25) = ceil(4.04)
  });

  it("returns 0 cases-to-open / stacks when the divisors are 0 (no divide-by-zero)", () => {
    const d = mobile.computeDoughSupply(
      supplyState({
        ...base,
        casesNeeded: 100,
        crustsPerCase: 0, // guards casesLeftToOpen
        doughballsPerTray: 0, // guards stacksNeededTotal (perTray 0)
      }),
      NOW,
      "dough",
    );
    expect(d.casesLeftToOpen).toBe(0);
    expect(d.stacksNeededTotal).toBe(0);
  });

  it("floors casesOnLine (partial case on the line is not counted)", () => {
    // ppm 40, freezerTime 15, pizzasPerCase 13 -> 600 / 13 = 46.15 -> floor 46.
    const d = mobile.computeDoughSupply(
      supplyState(
        {
          casesNeeded: 200,
          pizzasPerCase: 13,
          casesPerSkid: 48,
          casesPerLayer: 0,
          crustsPerCycle: 4,
          cycleSpeed: 10,
          speedAdjustment: 1,
          freezerTime: 15,
          doughballsPerTray: 60,
          doughBatchYield: 300,
          doughballWeightOz: 8,
          crustsPerCase: 12,
        },
        {},
        true,
      ),
      NOW,
      "dough",
    );
    expect(d.casesOnLine).toBe(46); // floor(40 * 15 / 13)
  });
});

// ── 5b. Web <-> mobile supply parity guard ───────────────────────────────────

describe("supply parity: web inline useMemo (webDoughSupply) <-> mobile computeDoughSupply", () => {
  // Fields whose formulas are identical across the two engines (given the
  // field-name mapping). perBatch is compared only in dough mode (see the
  // crust-mode divergence test below).
  const SHARED_FIELDS = [
    "perTray",
    "casesOnLine",
    "casesLeftToRun",
    "totalPizzasLeft",
    "doughOnHand",
    "doughDeficit",
    "batchesNeeded",
    "traysNeeded",
    "casesLeftToOpen",
    "stacksNeededTotal",
    "buffer",
    "doughShortCases",
  ] as const;

  const runParity = (sc: {
    settings: Record<string, any>;
    progress?: Record<string, any>;
    started?: boolean;
    mode: "dough" | "crusts";
  }) => {
    const started = sc.started ?? false;
    const progress = sc.progress ?? {};
    const liveFreezerMin = started ? (sc.settings.freezerTime ?? 0) : 0;
    const web = webDoughSupply(
      {
        approxLineSpeed: sc.settings.lineSpeedPPM ?? 0,
        crustsPerCycle: sc.settings.crustsPerCycle ?? 0,
        cycleSpeed: sc.settings.cycleSpeed ?? 0,
        speedAdjustment: sc.settings.speedAdjustment ?? 1,
        crustsPerStack: sc.settings.crustsPerStack ?? 0,
        doughballsPerTray: sc.settings.doughballsPerTray ?? 0,
        doughRecipe: sc.settings.doughRecipe ?? [],
        targetDoughballWeight: sc.settings.doughballWeightOz ?? 0, // web name
        doughBatchYield: sc.settings.doughBatchYield ?? 0,
        crustsPerCase: sc.settings.crustsPerCase ?? 0,
        casesNeeded: sc.settings.casesNeeded ?? 0,
        casesPerSkid: sc.settings.casesPerSkid ?? 0,
        casesPerLayer: sc.settings.casesPerLayer ?? 0,
        pizzasPerCase: sc.settings.pizzasPerCase ?? 0,
        // web reads these progress values from settings:
        skidsCompleted: progress.skidsCompleted ?? 0,
        casesOnCurrentSkid: progress.casesOnCurrentSkid ?? 0,
        traysOnLine: progress.traysOnLine ?? 0,
        batchesReady: progress.batchesReady ?? 0,
      },
      liveFreezerMin,
      sc.mode,
    );
    const m = mobile.computeDoughSupply(
      supplyState(sc.settings, progress, started),
      NOW,
      sc.mode,
    );
    return { web, m };
  };

  const assertSharedParity = (
    web: Record<string, number>,
    m: Record<string, number>,
  ) => {
    for (const key of SHARED_FIELDS) {
      expect(m[key], `mobile ${key} should match web ${key}`).toBeCloseTo(
        web[key],
        9,
      );
    }
  };

  const doughSettings = {
    casesNeeded: 137,
    pizzasPerCase: 12,
    casesPerSkid: 48,
    casesPerLayer: 6,
    crustsPerCycle: 4,
    cycleSpeed: 10,
    speedAdjustment: 1,
    freezerTime: 15,
    doughballsPerTray: 60,
    doughBatchYield: 300,
    doughballWeightOz: 8,
    crustsPerCase: 12,
  };

  it("matches in dough mode for an unstarted run with no staged dough", () => {
    const { web, m } = runParity({ settings: doughSettings, mode: "dough" });
    assertSharedParity(web, m);
    expect(m.perBatch).toBeCloseTo(web.perBatch, 9); // dough mode: both = yield
  });

  it("matches in dough mode for a started run with skids + staged dough", () => {
    const { web, m } = runParity({
      settings: doughSettings,
      progress: { skidsCompleted: 1, casesOnCurrentSkid: 7, traysOnLine: 3, batchesReady: 2 },
      started: true,
      mode: "dough",
    });
    assertSharedParity(web, m);
    expect(m.casesOnLine).toBe(web.casesOnLine);
    expect(m.casesOnLine).toBeGreaterThan(0); // the started path is actually exercised
    expect(m.perBatch).toBeCloseTo(web.perBatch, 9);
  });

  it("matches in dough mode when batch yield is recipe-derived", () => {
    const { web, m } = runParity({
      settings: {
        ...doughSettings,
        doughRecipe: [
          { ingredient: "Flour", lbs: 55 },
          { ingredient: "Water", lbs: 33 },
        ],
      },
      progress: { traysOnLine: 4 },
      started: true,
      mode: "dough",
    });
    assertSharedParity(web, m);
    expect(m.perBatch).toBeCloseTo(web.perBatch, 9);
  });

  it("matches the shared supply fields in crusts mode for an unstarted run", () => {
    // Unstarted -> casesOnLine 0 in both, so the ppm-source divergence (web
    // approxLineSpeed vs mobile dough ppm) does not affect any shared field.
    const { web, m } = runParity({
      settings: { ...doughSettings, crustsPerStack: 40, lineSpeedPPM: 999 },
      progress: { traysOnLine: 2, batchesReady: 1 },
      mode: "crusts",
    });
    assertSharedParity(web, m);
  });
});

// ── 5c. Intentional crust-mode supply divergences, encoded as expectations ────

describe("intentional crust-mode supply divergences (web vs mobile)", () => {
  it("perBatch: web uses crustsPerCase, mobile keeps the batch yield", () => {
    const settings = {
      casesNeeded: 100,
      pizzasPerCase: 12,
      casesPerSkid: 48,
      casesPerLayer: 6,
      crustsPerStack: 40,
      crustsPerCase: 12,
      doughBatchYield: 300,
      doughballWeightOz: 8,
    };
    const web = webDoughSupply(
      {
        approxLineSpeed: 0,
        crustsPerCycle: 0,
        cycleSpeed: 0,
        speedAdjustment: 1,
        crustsPerStack: settings.crustsPerStack,
        doughballsPerTray: 0,
        doughRecipe: [],
        targetDoughballWeight: settings.doughballWeightOz,
        doughBatchYield: settings.doughBatchYield,
        crustsPerCase: settings.crustsPerCase,
        casesNeeded: settings.casesNeeded,
        casesPerSkid: settings.casesPerSkid,
        casesPerLayer: settings.casesPerLayer,
        pizzasPerCase: settings.pizzasPerCase,
        skidsCompleted: 0,
        casesOnCurrentSkid: 0,
        traysOnLine: 0,
        batchesReady: 0,
      },
      0,
      "crusts",
    );
    const m = mobile.computeDoughSupply(supplyState(settings), NOW, "crusts");
    expect(web.perBatch).toBe(12); // crustsPerCase
    expect(m.perBatch).toBe(300); // effectiveDoughBatchYield
    expect(m.perBatch).not.toBe(web.perBatch);
  });

  it("casesOnLine ppm source: web uses approxLineSpeed, mobile reuses dough ppm once started", () => {
    const settings = {
      casesNeeded: 100,
      pizzasPerCase: 12,
      casesPerSkid: 48,
      casesPerLayer: 0,
      crustsPerCycle: 4,
      cycleSpeed: 10,
      speedAdjustment: 1, // mobile crust ppm = 40
      freezerTime: 15,
      crustsPerStack: 40,
      crustsPerCase: 12,
      lineSpeedPPM: 24, // web crust ppm = approxLineSpeed = 24
      doughBatchYield: 300,
      doughballWeightOz: 8,
    };
    const web = webDoughSupply(
      {
        approxLineSpeed: settings.lineSpeedPPM,
        crustsPerCycle: settings.crustsPerCycle,
        cycleSpeed: settings.cycleSpeed,
        speedAdjustment: settings.speedAdjustment,
        crustsPerStack: settings.crustsPerStack,
        doughballsPerTray: 0,
        doughRecipe: [],
        targetDoughballWeight: settings.doughballWeightOz,
        doughBatchYield: settings.doughBatchYield,
        crustsPerCase: settings.crustsPerCase,
        casesNeeded: settings.casesNeeded,
        casesPerSkid: settings.casesPerSkid,
        casesPerLayer: settings.casesPerLayer,
        pizzasPerCase: settings.pizzasPerCase,
        skidsCompleted: 0,
        casesOnCurrentSkid: 0,
        traysOnLine: 0,
        batchesReady: 0,
      },
      settings.freezerTime, // started
      "crusts",
    );
    const m = mobile.computeDoughSupply(
      supplyState(settings, {}, true),
      NOW,
      "crusts",
    );
    expect(web.casesOnLine).toBe(30); // floor(24 * 15 / 12)
    expect(m.casesOnLine).toBe(50); // floor(40 * 15 / 12)
    expect(m.casesOnLine).not.toBe(web.casesOnLine);
  });
});

// ── 6. Run timing / pace / catch-up math (web-only) ──────────────────────────
//
// The run-screen timing, pace gauge, and catch-up PPM are computed inline in the
// SAME pages/home.tsx `calc` useMemo as the supply math (section 5), and are
// likewise NOT importable. The mobile engine has no pace/catch-up at all and no
// "pause" stoppage type (its Stoppage.type is jam|changeover|break|other), so
// this is a web-only contract. `webTiming` below is a faithful, line-for-line
// transcription of those inline blocks (home.tsx, the `calc` useMemo):
//   - liveFreezerMin (lines ~3449-3456): 0 unstarted, the freezerTime setting
//     once ended, else min(elapsed-since-start, freezerTime), frozen at pausedAt.
//   - ppm / perTray / effectiveDoughBatchYield / perBatch / casesOnLine /
//     casesForTiming and the timePer{Tray,Batch,Skid,Case}Sec + totalTimeSec +
//     adjustedTimeSec timing block.
//   - the pace block: expectedCases = floor(ppm * (elapsed - downtime - freezer)
//     / pizzasPerCase); paceDelta = casesCompleted - expectedCases; status is
//     on-pace within |delta| <= 2, else ahead (>0) / behind (<0).
//   - the catch-up block: when behind, catchUpPpm = round(remainingCases *
//     pizzasPerCase * 60 / remainingSec), remainingSec floored at 60s.
// Two subtleties are deliberately preserved and asserted:
//   - downtime subtracted from elapsed EXCLUDES "pause" stoppages (only counts
//     ended, non-pause stoppages); a pause does not give the line credit for time.
//   - expectedCases nets out the full freezer-tunnel time (cases aren't "done"
//     until they exit the tunnel).
// If the web inline timing/pace/catch-up changes, update this transcription in
// lockstep — these unit expectations exist to make a silent drift loud.

interface TimingVals {
  approxLineSpeed: number;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  crustsPerStack: number;
  doughballsPerTray: number;
  doughRecipe?: { lbs?: number }[];
  targetDoughballWeight: number;
  doughBatchYield: number;
  crustsPerCase: number;
  casesNeeded: number;
  casesPerSkid: number;
  casesOnCurrentSkid: number;
  skidsCompleted: number;
  pizzasPerCase: number;
  freezerTime: number;
}

interface TimingRun {
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  stoppages?: { type?: string; startedAt: number; endedAt?: number }[];
}

// Faithful transcription of the web liveFreezerMin IIFE in pages/home.tsx.
function webLiveFreezerMin(v: TimingVals, run: TimingRun, nowMs: number): number {
  if (!run.startedAt) return 0;
  if (run.endedAt) return Number(v.freezerTime);
  const refTime = run.pausedAt ?? nowMs;
  const elapsed = (refTime - run.startedAt) / 60000;
  return Math.min(elapsed, Number(v.freezerTime));
}

type PaceStatus = "on-pace" | "ahead" | "behind" | null;

// Faithful transcription of the web pages/home.tsx inline timing/pace/catch-up.
function webTiming(
  v: TimingVals,
  run: TimingRun,
  nowMs: number,
  doughSubTab: "dough" | "crusts",
) {
  const ppm =
    doughSubTab === "crusts"
      ? v.approxLineSpeed
      : v.crustsPerCycle * v.cycleSpeed * v.speedAdjustment;
  const perTray = doughSubTab === "crusts" ? v.crustsPerStack : v.doughballsPerTray;
  const doughRecipeLbs = (v.doughRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const effectiveDoughBatchYield =
    doughRecipeLbs > 0 && v.targetDoughballWeight > 0
      ? (doughRecipeLbs * 16) / v.targetDoughballWeight
      : v.doughBatchYield;
  const perBatch = doughSubTab === "crusts" ? v.crustsPerCase : effectiveDoughBatchYield;

  const freezerTime = webLiveFreezerMin(v, run, nowMs);
  const casesOnLine = ppm > 0 ? Math.floor((ppm * freezerTime) / v.pizzasPerCase) : 0;
  const casesForTiming =
    v.casesNeeded -
    v.skidsCompleted * v.casesPerSkid -
    v.casesOnCurrentSkid -
    casesOnLine;

  const timePerTraySec = ppm > 0 ? (perTray / ppm) * 60 : 0;
  const timePerBatchSec = ppm > 0 ? (perBatch / ppm) * 60 : 0;
  const timePerSkidSec = ppm > 0 ? ((v.casesPerSkid * v.pizzasPerCase) / ppm) * 60 : 0;
  const timePerCaseSec = ppm > 0 ? (v.pizzasPerCase / ppm) * 60 : 0;
  const totalTimeSec = ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : 0;

  const casesCompleted = v.skidsCompleted * v.casesPerSkid + v.casesOnCurrentSkid;
  const adjustedTimeSec =
    ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : totalTimeSec;

  let paceStatus: PaceStatus = null;
  let paceDelta = 0;
  if (run.startedAt && !run.endedAt && ppm > 0 && v.pizzasPerCase > 0) {
    const refTime = run.pausedAt ?? nowMs;
    const downtimeMs = (run.stoppages ?? [])
      .filter((s) => s.endedAt && s.type !== "pause")
      .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
    const elapsedMin = Math.max(0, refTime - run.startedAt - downtimeMs) / 60000;
    const elapsedMinAfterTunnel = Math.max(0, elapsedMin - Number(v.freezerTime));
    const expectedCases = Math.floor((ppm * elapsedMinAfterTunnel) / v.pizzasPerCase);
    paceDelta = casesCompleted - expectedCases;
    paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
  }

  let catchUpPpm: number | null = null;
  if (
    paceStatus === "behind" &&
    run.startedAt &&
    !run.endedAt &&
    ppm > 0 &&
    v.pizzasPerCase > 0 &&
    v.casesNeeded > 0
  ) {
    const refTime = run.pausedAt ?? nowMs;
    const downtimeMs = (run.stoppages ?? [])
      .filter((s) => s.endedAt && s.type !== "pause")
      .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
    const elapsedSec = Math.max(0, refTime - run.startedAt - downtimeMs) / 1000;
    const remainingCases = v.casesNeeded - casesCompleted;
    const originalTotalSec = ppm > 0 ? (v.casesNeeded * v.pizzasPerCase * 60) / ppm : 0;
    const remainingSec = Math.max(60, originalTotalSec - elapsedSec);
    if (remainingSec > 0 && remainingCases > 0) {
      catchUpPpm = Math.round((remainingCases * v.pizzasPerCase * 60) / remainingSec);
    }
  }

  return {
    ppm,
    casesOnLine,
    casesForTiming,
    casesCompleted,
    timePerTraySec,
    timePerBatchSec,
    timePerSkidSec,
    timePerCaseSec,
    totalTimeSec,
    adjustedTimeSec,
    paceStatus,
    paceDelta,
    catchUpPpm,
  };
}

const MIN = 60 * 1000;

// ppm 40 (4 * 10 * 1), 12 pizzas/case, 100 cases, 15-min freeze tunnel.
const TIMING_SETTINGS: TimingVals = {
  approxLineSpeed: 24,
  crustsPerCycle: 4,
  cycleSpeed: 10,
  speedAdjustment: 1,
  crustsPerStack: 40,
  doughballsPerTray: 60,
  doughRecipe: [],
  targetDoughballWeight: 8,
  doughBatchYield: 300,
  crustsPerCase: 12,
  casesNeeded: 100,
  casesPerSkid: 48,
  casesOnCurrentSkid: 0,
  skidsCompleted: 0,
  pizzasPerCase: 12,
  freezerTime: 15,
};

describe("webTiming — per-tray/-batch/-skid/-case + total/adjusted time", () => {
  it("dough mode: derives the timing seconds for a pending run (no cases on line)", () => {
    const t = webTiming(TIMING_SETTINGS, {}, NOW, "dough");
    expect(t.ppm).toBe(40);
    expect(t.casesOnLine).toBe(0); // pending -> liveFreezerMin 0
    expect(t.casesForTiming).toBe(100);
    expect(t.timePerTraySec).toBeCloseTo(90, 9); // 60 / 40 * 60
    expect(t.timePerBatchSec).toBeCloseTo(450, 9); // 300 / 40 * 60
    expect(t.timePerSkidSec).toBeCloseTo(864, 9); // (48 * 12) / 40 * 60
    expect(t.timePerCaseSec).toBeCloseTo(18, 9); // 12 / 40 * 60
    expect(t.totalTimeSec).toBeCloseTo(1800, 9); // 100 * 12 * 60 / 40
    expect(t.adjustedTimeSec).toBeCloseTo(1800, 9); // same basis as totalTime
    expect(t.paceStatus).toBeNull(); // no start -> no pace
    expect(t.catchUpPpm).toBeNull();
  });

  it("crusts mode: ppm/perTray/perBatch switch to the crust sources", () => {
    const t = webTiming(TIMING_SETTINGS, {}, NOW, "crusts");
    expect(t.ppm).toBe(24); // approxLineSpeed
    expect(t.timePerTraySec).toBeCloseTo(100, 9); // crustsPerStack 40 / 24 * 60
    expect(t.timePerBatchSec).toBeCloseTo(30, 9); // crustsPerCase 12 / 24 * 60
    expect(t.timePerCaseSec).toBeCloseTo(30, 9); // 12 / 24 * 60
    expect(t.timePerSkidSec).toBeCloseTo(1440, 9); // (48 * 12) / 24 * 60
    expect(t.totalTimeSec).toBeCloseTo(3000, 9); // 100 * 12 * 60 / 24
  });

  it("ended run: casesOnLine uses the full freezerTime, shrinking casesForTiming", () => {
    const t = webTiming(
      TIMING_SETTINGS,
      { startedAt: NOW - 60 * MIN, endedAt: NOW },
      NOW,
      "dough",
    );
    expect(t.casesOnLine).toBe(50); // floor(40 * 15 / 12)
    expect(t.casesForTiming).toBe(50); // 100 - 0 - 0 - 50
    expect(t.totalTimeSec).toBeCloseTo(900, 9); // 50 * 12 * 60 / 40
    expect(t.paceStatus).toBeNull(); // ended -> no pace even though startedAt set
    expect(t.catchUpPpm).toBeNull();
  });
});

describe("webTiming — pace gauge (ahead / behind / on-pace within +/-2)", () => {
  // 30 min elapsed, 15-min tunnel -> elapsedAfterTunnel 15 -> expected = 50.
  const startedAt = NOW - 30 * MIN;
  const run = (skids: number, onSkid: number): TimingRun => ({ startedAt });
  const settings = (skids: number, onSkid: number): TimingVals => ({
    ...TIMING_SETTINGS,
    skidsCompleted: skids,
    casesOnCurrentSkid: onSkid,
  });

  const pace = (skids: number, onSkid: number) =>
    webTiming(settings(skids, onSkid), run(skids, onSkid), NOW, "dough");

  it("expected cases nets out the freeze tunnel", () => {
    // 1 skid (48) + 2 == 50 completed, expected 50 -> exactly on pace.
    const t = pace(1, 2);
    expect(t.casesCompleted).toBe(50);
    expect(t.paceDelta).toBe(0);
    expect(t.paceStatus).toBe("on-pace");
  });

  it("on-pace at the +2 and -2 tolerance boundaries", () => {
    expect(pace(1, 4).paceDelta).toBe(2); // 52 - 50
    expect(pace(1, 4).paceStatus).toBe("on-pace");
    expect(pace(0, 48).paceDelta).toBe(-2); // 48 - 50
    expect(pace(0, 48).paceStatus).toBe("on-pace");
  });

  it("ahead once delta exceeds +2; behind once it drops below -2", () => {
    expect(pace(1, 5).paceDelta).toBe(3); // 53 - 50
    expect(pace(1, 5).paceStatus).toBe("ahead");
    expect(pace(0, 47).paceDelta).toBe(-3); // 47 - 50
    expect(pace(0, 47).paceStatus).toBe("behind");
  });

  it("a paused run measures elapsed to pausedAt, not to now", () => {
    // started 30 min ago but paused 10 min ago: elapsed-at-pause = 20 min,
    // after tunnel 5 -> expected = floor(40 * 5 / 12) = 16. 16 completed -> on pace.
    // (If it wrongly used `now`, elapsed would be 30 -> expected 50 -> behind.)
    const t = webTiming(
      { ...TIMING_SETTINGS, skidsCompleted: 0, casesOnCurrentSkid: 16 },
      { startedAt: NOW - 30 * MIN, pausedAt: NOW - 10 * MIN },
      NOW,
      "dough",
    );
    expect(t.paceDelta).toBe(0);
    expect(t.paceStatus).toBe("on-pace");
  });
});

describe("webTiming — downtime exclusion (non-pause vs pause stoppages)", () => {
  // 24 min elapsed, 15-min tunnel -> elapsedAfterTunnel 9 -> expected = 30.
  // 10 cases completed -> 20 behind with no downtime.
  const startedAt = NOW - 24 * MIN;
  const settings: TimingVals = {
    ...TIMING_SETTINGS,
    skidsCompleted: 0,
    casesOnCurrentSkid: 10,
  };

  it("a non-pause stoppage is subtracted from elapsed (shifts behind -> on-pace)", () => {
    const noDowntime = webTiming(settings, { startedAt }, NOW, "dough");
    expect(noDowntime.paceDelta).toBe(-20); // 10 - 30
    expect(noDowntime.paceStatus).toBe("behind");

    // A completed 6-min "stop" inside the run window. Elapsed becomes 18 min,
    // after tunnel 3 -> expected = floor(40 * 3 / 12) = 10 -> on pace.
    const withStop = webTiming(
      settings,
      {
        startedAt,
        stoppages: [{ type: "stop", startedAt: NOW - 20 * MIN, endedAt: NOW - 14 * MIN }],
      },
      NOW,
      "dough",
    );
    expect(withStop.paceDelta).toBe(0);
    expect(withStop.paceStatus).toBe("on-pace");
  });

  it("a pause stoppage is NOT subtracted (stays behind)", () => {
    const withPause = webTiming(
      settings,
      {
        startedAt,
        stoppages: [{ type: "pause", startedAt: NOW - 20 * MIN, endedAt: NOW - 14 * MIN }],
      },
      NOW,
      "dough",
    );
    expect(withPause.paceDelta).toBe(-20); // pause ignored -> same as no downtime
    expect(withPause.paceStatus).toBe("behind");
  });

  it("an open (un-ended) stoppage is ignored until it ends", () => {
    const withOpen = webTiming(
      settings,
      { startedAt, stoppages: [{ type: "stop", startedAt: NOW - 5 * MIN }] },
      NOW,
      "dough",
    );
    expect(withOpen.paceDelta).toBe(-20); // no endedAt -> not counted
    expect(withOpen.paceStatus).toBe("behind");
  });
});

describe("webTiming — catch-up PPM (only when behind)", () => {
  it("computes the PPM needed to finish on time when behind", () => {
    // 24 min elapsed, expected 30, 10 completed -> behind. remainingCases 90.
    // originalTotalSec = 100 * 12 * 60 / 40 = 1800; elapsedSec = 1440;
    // remainingSec = max(60, 360) = 360 -> catchUp = round(90*12*60/360) = 180.
    const t = webTiming(
      { ...TIMING_SETTINGS, skidsCompleted: 0, casesOnCurrentSkid: 10 },
      { startedAt: NOW - 24 * MIN },
      NOW,
      "dough",
    );
    expect(t.paceStatus).toBe("behind");
    expect(t.catchUpPpm).toBe(180);
  });

  it("floors the remaining time at 60s (catch-up spikes when out of time)", () => {
    // 30 min elapsed (== originalTotalSec 1800s), 5 completed, expected 50 -> behind.
    // remainingSec = max(60, 1800 - 1800) = 60; remainingCases 95.
    // catchUp = round(95 * 12 * 60 / 60) = 1140.
    const t = webTiming(
      { ...TIMING_SETTINGS, skidsCompleted: 0, casesOnCurrentSkid: 5 },
      { startedAt: NOW - 30 * MIN },
      NOW,
      "dough",
    );
    expect(t.paceStatus).toBe("behind");
    expect(t.catchUpPpm).toBe(1140);
  });

  it("is null when on-pace or ahead", () => {
    const onPace = webTiming(
      { ...TIMING_SETTINGS, skidsCompleted: 1, casesOnCurrentSkid: 2 },
      { startedAt: NOW - 30 * MIN },
      NOW,
      "dough",
    );
    expect(onPace.paceStatus).toBe("on-pace");
    expect(onPace.catchUpPpm).toBeNull();

    const ahead = webTiming(
      { ...TIMING_SETTINGS, skidsCompleted: 1, casesOnCurrentSkid: 12 },
      { startedAt: NOW - 30 * MIN },
      NOW,
      "dough",
    );
    expect(ahead.paceStatus).toBe("ahead");
    expect(ahead.catchUpPpm).toBeNull();
  });
});

// ── 6b. Mobile computeCalc — downtime / net-elapsed timing ────────────────────
//
// The mobile engine has no pace/catch-up, but computeCalc does return downtime
// and net-elapsed timing used by the mobile run screen. Unlike the web pace math,
// mobile has no "pause" stoppage type (Stoppage.type is jam|changeover|break|
// other), so ALL ended stoppages count toward downtime, and an OPEN stoppage
// accrues up to the run boundary (now, or endedAt once the run is finished).

describe("computeCalc (mobile) — downtime + net elapsed", () => {
  it("sums completed stoppages and accrues an open stoppage up to now", () => {
    const c = mobile.computeCalc(
      mobileState(
        { casesNeeded: 100, pizzasPerCase: 12 },
        {
          startedAt: NOW - 30 * MIN,
          stoppages: [
            { id: "a", type: "jam", startedAt: NOW - 25 * MIN, endedAt: NOW - 19 * MIN }, // 6 min
            { id: "b", type: "break", startedAt: NOW - 5 * MIN }, // open -> 5 min to now
          ],
        },
      ),
      NOW,
    );
    expect(c.totalDowntimeSec).toBeCloseTo(660, 9); // 360 completed + 300 open
    expect(c.netElapsedSec).toBeCloseTo(1140, 9); // 1800 gross - 660 downtime
  });

  it("caps an open stoppage at endedAt once the run is finished", () => {
    const c = mobile.computeCalc(
      mobileState(
        { casesNeeded: 100, pizzasPerCase: 12 },
        {
          startedAt: NOW - 30 * MIN,
          endedAt: NOW - 10 * MIN, // boundary is endedAt, not now
          stoppages: [
            { id: "a", type: "jam", startedAt: NOW - 25 * MIN, endedAt: NOW - 19 * MIN }, // 6 min
            { id: "b", type: "other", startedAt: NOW - 14 * MIN }, // open -> caps at endedAt = 4 min
          ],
        },
      ),
      NOW,
    );
    // gross = (endedAt - startedAt) = 20 min = 1200s; open accrues 14-10 = 4 min.
    expect(c.totalDowntimeSec).toBeCloseTo(600, 9); // 360 + 240
    expect(c.netElapsedSec).toBeCloseTo(600, 9); // 1200 - 600
  });

  it("reports zero downtime / zero elapsed for a pending run", () => {
    const c = mobile.computeCalc(mobileState({ casesNeeded: 100, pizzasPerCase: 12 }), NOW);
    expect(c.totalDowntimeSec).toBe(0);
    expect(c.netElapsedSec).toBe(0);
  });
});
