// @vitest-environment node
//
// Regression guard: the mobile elapsed-time formula uses a stoppages-based
// approach rather than the web's startedAt-shift-on-resume strategy.
// computeCalc (in artifacts/run-calculator-mobile/context/RunContext.tsx)
// computes:
//
//   netElapsedSec = grossElapsedSec - totalDowntimeSec
//   grossElapsedSec = max(0, (boundaryMs - startedAt) / 1000)
//   totalDowntimeSec = sum(completed stoppages) + accrued(open stoppage)
//
// This is the mobile equivalent of the web's computeResumedStartedAt shift.
// If someone refactors computeCalc to drop the downtime subtraction (the
// equivalent of losing the startedAt shift on the web), these tests catch it.
//
// Invariants mirrored from artifacts/run-calculator/src/resumeRun.test.ts:
//   - netElapsedSec >= 0 for all valid inputs
//   - After a pause-resume cycle, netElapsedSec equals only the running time
//     (excluding the pause window), not the wall-clock window
//   - Counter-proof: without stoppages subtraction elapsed overstates by
//     exactly the pause duration

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(
  here,
  "../../run-calculator-mobile/context/RunContext.tsx",
);

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
  computeCalc: (state: any, nowMs: number) => {
    netElapsedSec: number;
    totalDowntimeSec: number;
    grossElapsedSec?: number;
  };
  DEFAULT_SETTINGS: Record<string, any>;
  DEFAULT_PROGRESS: Record<string, any>;
}

let tempFile: string | null = null;

async function loadStrippedModule(file: string): Promise<MobileModule> {
  const ts = (await import("typescript")).default;
  const raw = fs.readFileSync(file, "utf8");
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
    `mobileResumeRun.${process.pid}.${Date.now()}.mjs`,
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

function mobileState(runOverrides: Record<string, any> = {}) {
  return {
    id: "test",
    settings: { ...mobile.DEFAULT_SETTINGS, casesNeeded: 100, pizzasPerCase: 12 },
    progress: { ...mobile.DEFAULT_PROGRESS },
    stoppages: [],
    isRunning: false,
    ...runOverrides,
  };
}

function stoppage(
  type: "jam" | "changeover" | "break" | "other",
  startedAt: number,
  endedAt?: number,
) {
  return { id: `${startedAt}`, type, startedAt, endedAt };
}

const START = 1_000_000; // arbitrary epoch ms
const MIN = 60_000;

describe("mobile elapsed-time after pause-resume — netElapsedSec invariants", () => {
  it("netElapsedSec >= 0 for a run with no stoppages", () => {
    const c = mobile.computeCalc(
      mobileState({ startedAt: START }),
      START + 30 * MIN,
    );
    expect(c.netElapsedSec).toBeGreaterThanOrEqual(0);
  });

  it("after a completed pause window, netElapsedSec reflects only running time", () => {
    // Run started 40 min ago. Paused 30 min ago, resumed 20 min ago (10-min pause).
    // Running time: 10 min before pause + 20 min after resume = 30 min.
    const now = START + 40 * MIN;
    const c = mobile.computeCalc(
      mobileState({
        startedAt: START,
        stoppages: [stoppage("break", START + 10 * MIN, START + 20 * MIN)],
      }),
      now,
    );
    expect(c.netElapsedSec).toBeCloseTo(30 * 60, 9);
    expect(c.netElapsedSec).toBeGreaterThanOrEqual(0);
  });

  it("netElapsedSec == gross elapsed when there are no stoppages", () => {
    const now = START + 45 * MIN;
    const c = mobile.computeCalc(mobileState({ startedAt: START }), now);
    expect(c.netElapsedSec).toBeCloseTo(45 * 60, 9);
    expect(c.totalDowntimeSec).toBe(0);
  });

  it("a pause immediately after start, resumed 10 min later: netElapsedSec reflects only post-resume time", () => {
    // Started, paused instantly (0 min of running), resumed after 10 min.
    // Running time after resume: 5 more minutes.
    const now = START + 15 * MIN;
    const c = mobile.computeCalc(
      mobileState({
        startedAt: START,
        stoppages: [stoppage("jam", START, START + 10 * MIN)],
      }),
      now,
    );
    // gross = 15 min, pause = 10 min, net = 5 min
    expect(c.netElapsedSec).toBeCloseTo(5 * 60, 9);
    expect(c.netElapsedSec).toBeGreaterThanOrEqual(0);
  });

  it("handles a long pause (overnight): netElapsedSec equals only pre-pause running time", () => {
    // Ran for 2 hours, paused overnight (12 h), then resumed but nothing new yet.
    const pausedAt = START + 2 * 60 * MIN;
    const now = pausedAt + 12 * 60 * MIN;
    const c = mobile.computeCalc(
      mobileState({
        startedAt: START,
        stoppages: [stoppage("other", pausedAt, now)],
      }),
      now,
    );
    // gross = 14 h, pause = 12 h, net = 2 h
    expect(c.netElapsedSec).toBeCloseTo(2 * 60 * 60, 9);
    expect(c.netElapsedSec).toBeGreaterThanOrEqual(0);
  });

  it("multiple completed pauses: each one is subtracted from elapsed", () => {
    // 60-min run with two 5-min pauses: net = 50 min.
    const now = START + 60 * MIN;
    const c = mobile.computeCalc(
      mobileState({
        startedAt: START,
        stoppages: [
          stoppage("break", START + 10 * MIN, START + 15 * MIN), // 5 min
          stoppage("jam",   START + 30 * MIN, START + 35 * MIN), // 5 min
        ],
      }),
      now,
    );
    expect(c.totalDowntimeSec).toBeCloseTo(10 * 60, 9); // 5 + 5
    expect(c.netElapsedSec).toBeCloseTo(50 * 60, 9);    // 60 - 10
    expect(c.netElapsedSec).toBeGreaterThanOrEqual(0);
  });

  it("an open (not yet ended) pause accrues up to now: netElapsedSec reflects only pre-pause time", () => {
    // Run started 30 min ago; paused 10 min ago (still paused now).
    // Pre-pause running time = 20 min; open pause = 10 min.
    const now = START + 30 * MIN;
    const c = mobile.computeCalc(
      mobileState({
        startedAt: START,
        stoppages: [stoppage("break", START + 20 * MIN)], // no endedAt
      }),
      now,
    );
    expect(c.totalDowntimeSec).toBeCloseTo(10 * 60, 9);
    expect(c.netElapsedSec).toBeCloseTo(20 * 60, 9);
    expect(c.netElapsedSec).toBeGreaterThanOrEqual(0);
  });

  it("netElapsedSec is always >= 0 across a range of pause/resume inputs", () => {
    const cases: Array<{ pause: number; pauseDuration: number }> = [
      { pause: 0,          pauseDuration: 0 },
      { pause: 5 * MIN,    pauseDuration: 1_000 },
      { pause: 60 * MIN,   pauseDuration: 8 * 60 * MIN },
      { pause: 0,          pauseDuration: 30 * MIN },
    ];
    for (const { pause, pauseDuration } of cases) {
      const pausedAt = START + pause;
      const now = pausedAt + pauseDuration + MIN; // 1 extra minute after resume
      const c = mobile.computeCalc(
        mobileState({
          startedAt: START,
          stoppages: [stoppage("jam", pausedAt, pausedAt + pauseDuration)],
        }),
        now,
      );
      expect(c.netElapsedSec).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("mobile elapsed-time — counter-proof: without downtime subtraction elapsed overstates", () => {
  it("removing downtime subtraction overstates elapsed by exactly the pause duration", () => {
    // Paused 30 min in, resumed 10 min later.  Now = 40 min after start.
    // Correct net:  40 min gross - 10 min pause = 30 min running time.
    // Broken (no subtraction): 40 min gross — inflated by 10 min.
    const pausedAt = START + 30 * MIN;
    const now = pausedAt + 10 * MIN;
    const c = mobile.computeCalc(
      mobileState({
        startedAt: START,
        stoppages: [stoppage("break", pausedAt, now)],
      }),
      now,
    );

    const correctNet = c.netElapsedSec;                         // 30 min
    const brokenNet  = (now - START) / 1000;                    // 40 min (no subtraction)

    expect(correctNet).toBeCloseTo(30 * 60, 9);
    expect(brokenNet).toBeCloseTo(40 * 60, 9);
    expect(correctNet).toBeLessThan(brokenNet);
    // The gap equals the pause duration exactly.
    expect(brokenNet - correctNet).toBeCloseTo(10 * 60, 9);
  });

  it("with an extreme overnight pause, removing subtraction overstates by hours", () => {
    // Ran 1 min, paused 8 hours. Without subtraction: elapsed = 8 h 1 min.
    const pausedAt = START + MIN;
    const now = pausedAt + 8 * 60 * MIN;
    const c = mobile.computeCalc(
      mobileState({
        startedAt: START,
        stoppages: [stoppage("other", pausedAt, now)],
      }),
      now,
    );

    const correctNet = c.netElapsedSec;            // 1 min
    const brokenNet  = (now - START) / 1000;       // 8 h 1 min

    expect(correctNet).toBeCloseTo(1 * 60, 9);
    expect(brokenNet).toBeCloseTo(8 * 60 * 60 + 60, 9);
    expect(correctNet).toBeLessThan(brokenNet);
  });

  it("source guard: computeCalc subtracts stoppages from elapsed (formula must not drop the subtraction)", () => {
    // This test reads the raw RunContext source and asserts the downtime
    // subtraction is present. If a refactor removes it, this fails immediately.
    const source = fs.readFileSync(MOBILE_FILE, "utf8");
    // The formula: netElapsedSec = Math.max(0, grossElapsedSec - totalDowntimeSec)
    // Both operands must appear on the same line.
    expect(source).toMatch(/netElapsedSec\s*=\s*Math\.max\s*\(\s*0\s*,\s*grossElapsedSec\s*-\s*totalDowntimeSec\s*\)/);
  });
});
