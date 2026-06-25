// @vitest-environment node
//
// Additive run-union on live-sync (the "I was adding a new run and it disappeared
// before I was done" bug). Root cause: on an accepted sync both apps rebuilt the
// runs list from the REMOTE payload only, so a run just added on THIS device that
// hadn't been pushed yet was clobbered. The fix unions runs by id during same-day
// editing (keeping local-only runs), while a "runs" deletion tombstone still lets
// real deletes propagate, and a true daily reset adopts the remote runs wholesale.
//
// The web apply logic lives inline in pages/home.tsx (not importable); the mobile
// equivalent is the pure `applyPayloadToState` in the mobile sync/mapping module,
// which mirrors it. We assert it there, loaded through the same strip-imports ->
// transpile -> temp-file pipeline documented in .agents/memory/web-test-harness.md.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAPPING_FILE = path.resolve(
  here,
  "../../run-calculator-mobile/context/sync/mapping.ts",
);
const TODAY = "2026-06-25";

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
    `syncRunMerge.mapping.${process.pid}.${Date.now()}.mjs`,
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

function prevState(runs: any[], extra: Partial<any> = {}): any {
  return {
    runs,
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
    ...extra,
  };
}

function payloadWith(opts: {
  runIds: string[];
  resetAt?: number;
  deletedItems?: Record<string, string[]>;
}): any {
  return {
    dayState: {
      runs: opts.runIds.map((id) => ({ id, stoppages: [] })),
      resetAt: opts.resetAt ?? 0,
      date: TODAY,
    },
    runValues: {},
    runValuesUpdatedAt: {},
    deletedItems: opts.deletedItems,
  };
}

describe("applyPayloadToState — additive run-union", () => {
  it("keeps a local-only run that the incoming (same-day) payload doesn't have yet", () => {
    // We added r2 locally; the remote payload predates it and only has r1.
    const r1 = localRun("r1");
    const r2 = localRun("r2");
    const prev = prevState([r1, r2]);
    const payload = payloadWith({ runIds: ["r1"] }); // resetAt 0 == prev -> not a reset
    const { patch } = mapping.applyPayloadToState(payload, prev, {});
    const ids = patch.runs.map((r: any) => r.id);
    expect(ids).toContain("r1");
    expect(ids).toContain("r2"); // the just-added local run survives
    // r2 is the untouched local object (not present remotely, so not rebuilt).
    expect(patch.runs.find((r: any) => r.id === "r2")).toBe(r2);
  });

  it("does not resurrect a run that was deleted on a peer (runs tombstone)", () => {
    // A peer deleted r2 (tombstone) but still carries it in its runs list.
    const r1 = localRun("r1");
    const r2 = localRun("r2");
    const prev = prevState([r1, r2]);
    const payload = payloadWith({
      runIds: ["r1", "r2"],
      deletedItems: { runs: ["r2"] },
    });
    const { patch } = mapping.applyPayloadToState(payload, prev, {});
    const ids = patch.runs.map((r: any) => r.id);
    expect(ids).toContain("r1");
    expect(ids).not.toContain("r2"); // tombstoned -> stays deleted
  });

  it("adopts the remote runs wholesale on a true daily reset and clears the runs tombstone", () => {
    // Local has a stale local-only run + a tombstone from yesterday; the reset
    // payload (resetAt strictly forward) starts a fresh set of runs.
    const stale = localRun("old1");
    const prev = prevState([stale], { deletedItems: { runs: ["old2"] } });
    const payload = payloadWith({ runIds: ["new1"], resetAt: 1 });
    const { patch } = mapping.applyPayloadToState(payload, prev, {});
    const ids = patch.runs.map((r: any) => r.id);
    expect(ids).toEqual(["new1"]); // remote adopted wholesale, local dropped
    // The per-day run tombstones are cleared on reset (can't match fresh ids).
    expect(patch.deletedItems?.runs).toBeUndefined();
  });

  it("adopts an empty remote run list wholesale on reset (web parity; no ≥1 fallback on reset)", () => {
    const stale = localRun("old1");
    const prev = prevState([stale]);
    const payload = payloadWith({ runIds: [], resetAt: 1 });
    const { patch } = mapping.applyPayloadToState(payload, prev, {});
    expect(patch.runs).toEqual([]); // reset = remote wholesale, even when empty
  });
});
