// @vitest-environment node
//
// Per-run lost-update guard (the "I changed a setting, clicked away, and it
// disappeared" bug). The fix adds a monotonic per-run edit timestamp
// (SyncPayload.runValuesUpdatedAt) so the apply path can REJECT a stale remote
// that would clobber a fresher local edit, while leaving the prior accept
// behavior intact for unedited/imported runs (both timestamps 0).
//
// The web apply logic lives inline in pages/home.tsx (not importable); the mobile
// equivalent is the pure `applyPayloadToState` in the mobile sync/mapping module,
// which mirrors it. We assert the gate there. The mapping module sits behind the
// React Native / Expo import graph (`../RunContext`), so it is loaded through the
// same strip-imports -> transpile -> temp-file pipeline documented in
// .agents/memory/web-test-harness.md, with stubs for the symbols it imports.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAPPING_FILE = path.resolve(
  here,
  "../../../_archived/mobile/context/sync/mapping.ts",
);
const TODAY = "2026-06-25";

// Stubs for every value symbol mapping.ts imports (from ../RunContext and
// @workspace/allergen). Rename helpers are identity; todayStr is fixed so the
// reset/date guard accepts our test payloads.
const STUB_PRELUDE = `
const DEFAULT_PROGRESS = {};
const DEFAULT_SETTINGS = {};
const renameIngredientList = (a) => a;
const renameIngredientSettings = (s) => s;
const renamePepList = (a) => a;
const renamePepSettings = (s) => s;
const todayStr = () => "${TODAY}";
const normalizeAllergen = (v) => v;
`;

let tempFile: string | null = null;

async function loadStrippedModule(file: string): Promise<any> {
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
      isolatedModules: true,
    },
  });
  const out = path.join(
    os.tmpdir(),
    `syncRevGate.mapping.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  tempFile = out;
  return await import(pathToFileURL(out).href);
}

let mapping: any;

beforeAll(async () => {
  mapping = await loadStrippedModule(MAPPING_FILE);
});

afterAll(() => {
  if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
});

function prevState(run: any): any {
  return {
    runs: [run],
    currentIndex: 0,
    shiftNotes: "",
    runToTime: "",
    date: TODAY,
    resetAt: 0,
    brands: [],
    brandFlavors: {},
    pepTypes: [],
    dieTypes: [],
    cheeseIngredients: [],
    doughIngredients: [],
    frontlineIngredients: [],
    mergedAway: [],
    deletedItems: {},
    substitutions: [],
    substitutionLog: [],
    stagedItems: {},
  };
}

// A local run carrying a distinguishing settings value, so we can tell whether
// the apply kept our run (object identity / preserved value) or rebuilt it from
// the stale remote.
function localRun(id: string): any {
  return {
    id,
    settings: { casesNeeded: 100 },
    progress: {},
    stoppages: [],
    startedAt: undefined,
    endedAt: undefined,
    isRunning: false,
  };
}

// Remote payload for `id` whose run value is stale (casesNeeded 5).
function remotePayload(
  id: string,
  runValuesUpdatedAt: Record<string, number>,
): any {
  return {
    dayState: {
      runs: [{ id, stoppages: [] }],
      resetAt: 0,
      date: TODAY,
    },
    runValues: { [id]: { casesNeeded: 5 } },
    runValuesUpdatedAt,
  };
}

describe("applyPayloadToState — per-run lost-update guard", () => {
  it("keeps the local run when the local edit is strictly newer (rejects stale remote)", () => {
    const run = localRun("r1");
    const prev = prevState(run);
    const payload = remotePayload("r1", { r1: 1000 });
    const { patch, rejectedStale, mergedUpdatedAt } = mapping.applyPayloadToState(
      payload,
      prev,
      { r1: 2000 }, // local edited more recently than remote
    );
    // Local run is preserved verbatim (same reference) — the just-made edit survives.
    expect(patch.runs[0]).toBe(run);
    expect(patch.runs[0].settings.casesNeeded).toBe(100);
    expect(rejectedStale).toBe(true);
    // Timestamp map converges to the per-id max.
    expect(mergedUpdatedAt.r1).toBe(2000);
  });

  it("adopts the remote run when the remote edit is newer", () => {
    const run = localRun("r1");
    const prev = prevState(run);
    const payload = remotePayload("r1", { r1: 2000 });
    const { patch, rejectedStale, mergedUpdatedAt } = mapping.applyPayloadToState(
      payload,
      prev,
      { r1: 1000 }, // local older than remote
    );
    // Remote wins: the run is rebuilt (not our preserved object).
    expect(patch.runs[0]).not.toBe(run);
    expect(rejectedStale).toBe(false);
    expect(mergedUpdatedAt.r1).toBe(2000);
  });

  it("preserves prior accept-remote behavior when neither side recorded an edit (both 0)", () => {
    const run = localRun("r1");
    const prev = prevState(run);
    const payload = remotePayload("r1", {}); // remote ts absent -> 0
    const { patch, rejectedStale } = mapping.applyPayloadToState(
      payload,
      prev,
      {}, // local ts absent -> 0
    );
    // 0 is not strictly greater than 0, so the remote is adopted exactly as before.
    expect(patch.runs[0]).not.toBe(run);
    expect(rejectedStale).toBe(false);
  });
});

describe("diffStampRunEdits — mobile per-run edit attribution", () => {
  it("does NOT stamp on the first (priming) snapshot, only records the baseline", () => {
    const { updatedAt, stamped } = mapping.diffStampRunEdits(
      { r1: "v1", r2: "v2" },
      {}, // empty baseline
      false, // not primed yet
      1000,
      {},
    );
    expect(stamped).toBe(false);
    expect(updatedAt).toEqual({});
  });

  it("stamps the FIRST real edit of a run once primed (the residual lost-update gap)", () => {
    const { updatedAt, stamped } = mapping.diffStampRunEdits(
      { r1: "v1-edited", r2: "v2" }, // r1 changed vs baseline
      { r1: "v1", r2: "v2" }, // primed baseline
      true,
      1000,
      {},
    );
    expect(stamped).toBe(true);
    expect(updatedAt).toEqual({ r1: 1000 });
  });

  it("stamps a newly created run id (absent from baseline) once primed", () => {
    const { updatedAt, stamped } = mapping.diffStampRunEdits(
      { r1: "v1", r2: "new" },
      { r1: "v1" }, // r2 is new
      true,
      2000,
      { r1: 500 },
    );
    expect(stamped).toBe(true);
    expect(updatedAt).toEqual({ r1: 500, r2: 2000 });
  });

  it("does not stamp when nothing changed", () => {
    const { updatedAt, stamped } = mapping.diffStampRunEdits(
      { r1: "v1" },
      { r1: "v1" },
      true,
      3000,
      { r1: 500 },
    );
    expect(stamped).toBe(false);
    expect(updatedAt).toEqual({ r1: 500 });
  });

  // Empty-over-populated guard (web parity). A programmatic reset to the
  // all-default/empty run value must NEVER be stamped — that fresh timestamp
  // would win the per-run lost-update guard on every peer and clobber real data
  // on the SHARED daily_sync row (the recurring "I entered it, waited,
  // refreshed, and it vanished" loss). Web never stamps an all-DEFAULT form;
  // mobile mirrors that by skipping any value equal to emptyValString.
  const EMPTY = "__EMPTY__";

  it("does NOT stamp a populated→empty transition (the clobber vector)", () => {
    const { updatedAt, stamped } = mapping.diffStampRunEdits(
      { r1: EMPTY }, // run reset to all-default
      { r1: "populated" }, // baseline had real data
      true,
      4000,
      { r1: 500 },
      EMPTY,
    );
    expect(stamped).toBe(false);
    expect(updatedAt).toEqual({ r1: 500 }); // prior stamp untouched
  });

  it("does NOT stamp a brand-new empty run (absent from baseline)", () => {
    const { updatedAt, stamped } = mapping.diffStampRunEdits(
      { r1: EMPTY },
      {}, // new run id, no baseline
      true,
      4000,
      {},
      EMPTY,
    );
    expect(stamped).toBe(false);
    expect(updatedAt).toEqual({});
  });

  it("STILL stamps a genuine populated edit when an emptyValString is supplied", () => {
    const { updatedAt, stamped } = mapping.diffStampRunEdits(
      { r1: "v1-edited" },
      { r1: "v1" },
      true,
      4000,
      { r1: 500 },
      EMPTY,
    );
    expect(stamped).toBe(true);
    expect(updatedAt).toEqual({ r1: 4000 });
  });

  it("STILL stamps first real data typed into a previously-empty run", () => {
    const { updatedAt, stamped } = mapping.diffStampRunEdits(
      { r1: "populated" },
      { r1: EMPTY }, // baseline was empty
      true,
      4000,
      {},
      EMPTY,
    );
    expect(stamped).toBe(true);
    expect(updatedAt).toEqual({ r1: 4000 });
  });
});
