// Mobile counterpart of the web schedule re-import case-update verification
// (Task: accepting one run's NEW case count must never change other runs).
//
// The mobile flow lives in artifacts/run-calculator-mobile:
//   app/schedule.tsx        — wires promptCaseUpdates(offers, prefix,
//                             (o) => updateRunSettingsById(o.runId, { casesNeeded: o.to }))
//   utils/importCaseUpdates.ts — buildCaseUpdateOffers + promptCaseUpdates
//   context/RunContext.tsx  — updateRunSettingsById (id-scoped settings merge)
//
// This test loads the REAL mobile utils/importCaseUpdates.ts through the
// strip-imports -> transpile pipeline (see .agents/memory/web-test-harness.md),
// stubs showConfirm so the dialog chain can be driven programmatically, and
// applies accepted offers through the exact updateRunSettingsById state
// transform semantics (findIndex by id; merge ONLY that run's settings;
// progress and all other runs untouched). Source guards at the bottom pin the
// schedule.tsx wiring and the RunContext transform so a refactor that broadens
// the write (e.g. touching progress or other runs) fails here.
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = path.resolve(here, "../../run-calculator-mobile");
const UTIL_FILE = path.join(MOBILE_DIR, "utils/importCaseUpdates.ts");
const SCHEDULE_FILE = path.join(MOBILE_DIR, "app/schedule.tsx");
const SUMMARY_FILE = path.join(MOBILE_DIR, "app/(tabs)/summary.tsx");
const MASTER_DATA_FILE = path.join(MOBILE_DIR, "app/master-data.tsx");
const RUN_CONTEXT_FILE = path.join(MOBILE_DIR, "context/RunContext.tsx");

type Offer = {
  runId: string;
  brand: string;
  flavor: string;
  from: number;
  to: number;
  madeAlready?: number;
};

type ConfirmCall = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
};

type MobileMod = {
  buildCaseUpdateOffers: (
    matches: {
      row: { brand: string; flavor: string; casesNeeded: number };
      run: {
        brand: string;
        flavor: string;
        id: string;
        startedAt?: number;
        endedAt?: number;
        casesNeeded: number;
        casesMade?: number;
      };
    }[],
  ) => Offer[];
  promptCaseUpdates: (offers: Offer[], prefix: string, apply: (o: Offer) => void) => void;
  __confirmCalls: ConfirmCall[];
};

function loadMobileModule(): MobileMod {
  const ts = require("typescript") as typeof import("typescript");
  const raw = fs.readFileSync(UTIL_FILE, "utf8");
  // Drop every `import ... from "...";` — the module's only import is
  // showConfirm from @/utils/notify, which the prelude replaces with a
  // recording stub so the test can drive the Accept/Keep dialog chain.
  const withoutImports = raw.replace(/import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g, "");
  const prelude = `
const __confirmCalls = [];
exports.__confirmCalls = __confirmCalls;
const showConfirm = (opts) => { __confirmCalls.push(opts); };
`;
  const { outputText } = ts.transpileModule(prelude + withoutImports, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  });
  const factory = new Function("exports", "require", outputText);
  const mod: Partial<MobileMod> = {};
  factory(mod, () => ({}));
  if (!mod.buildCaseUpdateOffers || !mod.promptCaseUpdates) {
    throw new Error("mobile importCaseUpdates exports not found");
  }
  return mod as MobileMod;
}

// ── Minimal mobile app-state, applied through updateRunSettingsById's exact
//    transform (RunContext.tsx: findIndex by id, merge settings only) ──
type Run = {
  id: string;
  startedAt?: number;
  endedAt?: number;
  settings: { brand: string; flavor: string; casesNeeded: number; casesPerSkid: number };
  progress: { skidsCompleted: number; casesOnCurrentSkid: number };
};

function updateRunSettingsById(
  runs: Run[],
  runId: string,
  partial: Partial<Run["settings"]>,
): Run[] {
  const idx = runs.findIndex((r) => r.id === runId);
  if (idx < 0) return runs;
  const next = [...runs];
  next[idx] = { ...next[idx], settings: { ...next[idx].settings, ...partial } };
  return next;
}

function makeRuns(): Run[] {
  return [
    {
      id: "run-alpha",
      startedAt: 1000,
      settings: { brand: "Alpha", flavor: "Pepperoni", casesNeeded: 50, casesPerSkid: 20 },
      progress: { skidsCompleted: 2, casesOnCurrentSkid: 3 },
    },
    {
      id: "run-beta",
      startedAt: 2000,
      settings: { brand: "Beta", flavor: "Cheese", casesNeeded: 40, casesPerSkid: 20 },
      progress: { skidsCompleted: 1, casesOnCurrentSkid: 5 },
    },
  ];
}

// The re-imported schedule rows: Alpha now 80 (was 50), Beta now 60 (was 40).
function makeMatches(runs: Run[]) {
  return [
    {
      row: { brand: "Alpha", flavor: "Pepperoni", casesNeeded: 80 },
      run: {
        brand: "Alpha",
        flavor: "Pepperoni",
        id: runs[0].id,
        startedAt: runs[0].startedAt,
        endedAt: runs[0].endedAt,
        casesNeeded: runs[0].settings.casesNeeded,
        casesMade:
          runs[0].progress.skidsCompleted * runs[0].settings.casesPerSkid +
          runs[0].progress.casesOnCurrentSkid,
      },
    },
    {
      row: { brand: "Beta", flavor: "Cheese", casesNeeded: 60 },
      run: {
        brand: "Beta",
        flavor: "Cheese",
        id: runs[1].id,
        startedAt: runs[1].startedAt,
        endedAt: runs[1].endedAt,
        casesNeeded: runs[1].settings.casesNeeded,
        casesMade:
          runs[1].progress.skidsCompleted * runs[1].settings.casesPerSkid +
          runs[1].progress.casesOnCurrentSkid,
      },
    },
  ];
}

let mod: MobileMod;

beforeAll(() => {
  mod = loadMobileModule();
});

describe("mobile re-import case-update offers (buildCaseUpdateOffers)", () => {
  it("offers updates for both in-progress runs with changed counts", () => {
    const runs = makeRuns();
    const offers = mod.buildCaseUpdateOffers(makeMatches(runs));
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ runId: "run-alpha", from: 50, to: 80 });
    expect(offers[1]).toMatchObject({ runId: "run-beta", from: 40, to: 60 });
  });

  it("never offers updates for finished runs or unchanged counts", () => {
    const runs = makeRuns();
    runs[0].endedAt = 5000; // Alpha finished
    const matches = makeMatches(runs);
    matches[1].row.casesNeeded = 40; // Beta unchanged
    matches[1].run.casesNeeded = 40;
    expect(mod.buildCaseUpdateOffers(matches)).toHaveLength(0);
  });
});

describe("mobile Accept-one / Keep-other isolation (promptCaseUpdates)", () => {
  it("accepting Alpha's new count and keeping Beta's updates ONLY Alpha's casesNeeded; progress preserved", () => {
    mod.__confirmCalls.length = 0;
    let runs = makeRuns();
    const before = makeRuns();
    const betaBeforeRef = runs[1];
    const alphaProgressRef = runs[0].progress;
    const offers = mod.buildCaseUpdateOffers(makeMatches(runs));

    // Exact schedule.tsx wiring: (o) => updateRunSettingsById(o.runId, { casesNeeded: o.to })
    mod.promptCaseUpdates(offers, "", (o) => {
      runs = updateRunSettingsById(runs, o.runId, { casesNeeded: o.to });
    });

    // Dialog 1 (Alpha 50 -> 80): accept.
    expect(mod.__confirmCalls).toHaveLength(1);
    expect(mod.__confirmCalls[0].title).toBe("Case count changed (1 of 2)");
    expect(mod.__confirmCalls[0].confirmText).toBe("Update to 80");
    expect(mod.__confirmCalls[0].cancelText).toBe("Keep 50");
    mod.__confirmCalls[0].onConfirm();

    // Dialog 2 (Beta 40 -> 60): keep current.
    expect(mod.__confirmCalls).toHaveLength(2);
    expect(mod.__confirmCalls[1].title).toBe("Case count changed (2 of 2)");
    expect(mod.__confirmCalls[1].confirmText).toBe("Update to 60");
    expect(mod.__confirmCalls[1].cancelText).toBe("Keep 40");
    mod.__confirmCalls[1].onCancel();

    // Alpha: ONLY casesNeeded changed; progress object untouched (same ref).
    expect(runs[0].settings.casesNeeded).toBe(80);
    expect(runs[0].settings.brand).toBe("Alpha");
    expect(runs[0].progress).toBe(alphaProgressRef);
    expect(runs[0].progress).toEqual({ skidsCompleted: 2, casesOnCurrentSkid: 3 });

    // Beta: completely untouched — the exact same object reference.
    expect(runs[1]).toBe(betaBeforeRef);
    expect(runs[1].settings.casesNeeded).toBe(40);
    expect(runs[1]).toEqual(before[1]);
  });

  it("keeping ALL current counts changes nothing (web 'Keep All Current' parity)", () => {
    mod.__confirmCalls.length = 0;
    let runs = makeRuns();
    const alphaRef = runs[0];
    const betaRef = runs[1];
    const offers = mod.buildCaseUpdateOffers(makeMatches(runs));
    let applied = 0;

    mod.promptCaseUpdates(offers, "", (o) => {
      applied += 1;
      runs = updateRunSettingsById(runs, o.runId, { casesNeeded: o.to });
    });
    mod.__confirmCalls[0].onCancel();
    mod.__confirmCalls[1].onCancel();

    expect(applied).toBe(0);
    expect(runs[0]).toBe(alphaRef);
    expect(runs[1]).toBe(betaRef);
    expect(runs[0].settings.casesNeeded).toBe(50);
    expect(runs[1].settings.casesNeeded).toBe(40);
  });

  it("a stray double-callback cannot double-apply or re-ask a run", () => {
    mod.__confirmCalls.length = 0;
    let runs = makeRuns();
    const offers = mod.buildCaseUpdateOffers(makeMatches(runs));
    let applied = 0;
    mod.promptCaseUpdates(offers, "", (o) => {
      applied += 1;
      runs = updateRunSettingsById(runs, o.runId, { casesNeeded: o.to });
    });
    mod.__confirmCalls[0].onConfirm();
    mod.__confirmCalls[0].onConfirm(); // stray duplicate
    mod.__confirmCalls[0].onCancel(); // stray contradictory callback
    expect(applied).toBe(1);
    expect(mod.__confirmCalls).toHaveLength(2);
  });
});

describe("source guards: the mobile apply path stays id-scoped", () => {
  it("schedule.tsx applies an accepted offer ONLY via updateRunSettingsById(o.runId, { casesNeeded: o.to })", () => {
    const src = fs.readFileSync(SCHEDULE_FILE, "utf8");
    expect(src).toMatch(
      /promptCaseUpdates\(caseUpdateOffers,\s*skippedNote,\s*\(o\)\s*=>\s*updateRunSettingsById\(o\.runId,\s*\{\s*casesNeeded:\s*o\.to\s*\}\s*\)/,
    );
  });

  it("summary.tsx (Import Runs) wires the SAME id-scoped apply callback", () => {
    const src = fs.readFileSync(SUMMARY_FILE, "utf8");
    expect(src).toMatch(
      /promptCaseUpdates\(caseUpdateOffers,\s*skippedNote,\s*\(o\)\s*=>\s*updateRunSettingsById\(o\.runId,\s*\{\s*casesNeeded:\s*o\.to\s*\}\s*\)/,
    );
  });

  it("master-data.tsx (schedule import) wires the SAME id-scoped apply callback", () => {
    const src = fs.readFileSync(MASTER_DATA_FILE, "utf8");
    expect(src).toMatch(
      /promptCaseUpdates\(caseUpdateOffers,\s*`\$\{summary\}\\n\\n`,\s*\(o\)\s*=>\s*updateRunSettingsById\(o\.runId,\s*\{\s*casesNeeded:\s*o\.to\s*\}\s*\)/,
    );
  });

  it("no promptCaseUpdates call site applies through anything but updateRunSettingsById", () => {
    // If a new screen adopts the offer dialog with a different (broader or
    // unstamped) write path, this catches it: every apply callback must be
    // exactly the id-scoped settings merge above.
    for (const file of [SCHEDULE_FILE, SUMMARY_FILE, MASTER_DATA_FILE]) {
      const src = fs.readFileSync(file, "utf8");
      const calls = src.match(/promptCaseUpdates\(/g) ?? [];
      const scoped =
        src.match(
          /promptCaseUpdates\([^)]*\(o\)\s*=>\s*updateRunSettingsById\(o\.runId,\s*\{\s*casesNeeded:\s*o\.to\s*\}\s*\)/g,
        ) ?? [];
      // Exclude the import statement itself (no opening-paren match there).
      expect(scoped.length, path.basename(file)).toBe(calls.length);
      expect(calls.length, path.basename(file)).toBeGreaterThan(0);
    }
  });

  it("accepted updates get the per-run LWW stamp: the change-watcher diffs appState and stamps edited runs", () => {
    // Mobile has no explicit markRunValuesUpdated at the apply site; instead
    // updateRunSettingsById goes through setAppState, and the change-watcher
    // effect (keyed on [appState]) attributes the diff to the edited run via
    // diffStampRunEdits — the mobile equivalent of the web autosave's
    // markRunValuesUpdated. If either half changes shape, an accepted count
    // would sync WITHOUT a fresh stamp and lose the LWW merge to a peer's
    // stale copy (the exact bug class this dialog shipped with on web).
    const src = fs.readFileSync(RUN_CONTEXT_FILE, "utf8");
    // 1. The apply write goes through setAppState (so the watcher sees it).
    const fnStart = src.indexOf("const updateRunSettingsById");
    expect(fnStart).toBeGreaterThan(-1);
    expect(src.slice(fnStart, fnStart + 700)).toMatch(/setAppState\(\(prev\)\s*=>/);
    // 2. The change-watcher stamps per-run edits and schedules a push.
    const watcherStart = src.indexOf("diffStampRunEdits(");
    expect(watcherStart).toBeGreaterThan(-1);
    const watcher = src.slice(Math.max(0, watcherStart - 2000), watcherStart + 800);
    expect(watcher).toMatch(/lastLocalEditRef\.current\s*=\s*now/);
    expect(watcher).toMatch(/runValuesUpdatedAtRef\.current\s*=\s*updatedAt/);
    expect(watcher).toMatch(/schedulePush\(\)/);
    // 3. The watcher effect re-runs on every appState change.
    expect(src).toMatch(/\},\s*\[appState,\s*schedulePush\]\);/);
  });

  it("RunContext updateRunSettingsById merges only the matched run's settings (progress and other runs untouched)", () => {
    const src = fs.readFileSync(RUN_CONTEXT_FILE, "utf8");
    const fnStart = src.indexOf("const updateRunSettingsById");
    expect(fnStart).toBeGreaterThan(-1);
    const body = src.slice(fnStart, fnStart + 700);
    // Scoped lookup by id, bail when absent.
    expect(body).toMatch(/findIndex\(\(r\)\s*=>\s*r\.id\s*===\s*runId\)/);
    expect(body).toMatch(/if\s*\(idx\s*<\s*0\)\s*return\s*prev/);
    // Merge is confined to `settings` of the matched run.
    expect(body).toMatch(
      /runs\[idx\]\s*=\s*\{\s*\.\.\.runs\[idx\],\s*settings:\s*\{\s*\.\.\.runs\[idx\]\.settings,\s*\.\.\.partial\s*\}\s*\}/,
    );
    // No progress write anywhere in the transform.
    expect(body).not.toMatch(/progress\s*:/);
  });
});
