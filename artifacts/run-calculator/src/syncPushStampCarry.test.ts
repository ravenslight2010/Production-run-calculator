// @vitest-environment node
//
// Guard: a mobile sync push must actually CARRY the per-run edit timestamps.
// The mobile source guard (mobileRunValueStampGuard.test.ts) catches write
// paths that bypass the diffStampRunEdits funnel, but it cannot catch a
// regression INSIDE appStateToPayload: if that builder ever stops including
// the runValuesUpdatedAt map passed to it (or misplaces it in the payload
// shape), every push would ship values without stamps — the server's per-run
// lost-update guard (protectRunValues) would treat them as stale and peers'
// old copies would win, silently reverting the user's edits.
//
// Companion contract: the MAP-LESS call (no 3rd arg) is what doPush and the
// change-watcher stableStringify for the echo/no-op signature. That signature
// must be constant regardless of the stamps (runValuesUpdatedAt defaults to
// {}), and identical to the stamped payload on every other key — otherwise a
// fresh stamp would perturb the sig and defeat echo detection (or worse, the
// sig path would leak stamps and suppress real pushes).
//
// The mobile module is loaded through the same strip-imports -> transpile ->
// temp-file pipeline as syncRunMerge.test.ts (.agents/memory/web-test-harness.md).

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
const TODAY = "2026-07-03";

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
    `syncPushStampCarry.mapping.${process.pid}.${Date.now()}.mjs`,
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

// Mirrors RunContext's stableStringify (sorted object keys) so the signature
// assertions here test the exact contract doPush / the change-watcher rely on.
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k];
          return acc;
        }, {});
    }
    return val;
  });
}

// A run with real user data — NOT a pristine seed placeholder, so
// appStateToPayload includes it in the push.
function realRun(id: string): any {
  return {
    id,
    settings: { brand: "Acme", flavor: "Pepperoni", casesNeeded: 120, notes: "" },
    progress: { skidsCompleted: 3 },
    stoppages: [],
    startedAt: undefined,
    endedAt: undefined,
    isRunning: false,
  };
}

function state(runs: any[], extra: Partial<any> = {}): any {
  return {
    runs,
    currentIndex: 0,
    shiftNotes: "note",
    runToTime: "14:00",
    date: TODAY,
    resetAt: 0,
    brands: ["Acme"],
    brandFlavors: { Acme: ["Pepperoni"] },
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

describe("appStateToPayload — per-run edit stamps travel with the push", () => {
  it("carries a populated runValuesUpdatedAt map verbatim at the top level of the payload", () => {
    const stamps = { r1: 1751500000000, r2: 1751500123456 };
    const payload = mapping.appStateToPayload(
      state([realRun("r1"), realRun("r2")]),
      null,
      stamps,
    );
    // Exactly where the server's protectRunValues reads it: top-level key,
    // NOT nested under dayState.
    expect(payload.runValuesUpdatedAt).toEqual(stamps);
    expect((payload.dayState as any).runValuesUpdatedAt).toBeUndefined();
    // Both stamped runs' values were pushed too (stamp + value pair intact).
    expect(Object.keys(payload.runValues).sort()).toEqual(["r1", "r2"]);
  });

  it("does not let a stale raw payload's stamps leak in or override the passed map", () => {
    // lastRaw (the previous remote payload) is spread first; the map passed to
    // the builder must win over any stamps the raw copy carried.
    const lastRaw = {
      dayState: { runs: [{ id: "r1", stoppages: [] }], resetAt: 0, date: TODAY },
      runValues: {},
      runValuesUpdatedAt: { r1: 1, stale: 2 },
    };
    const stamps = { r1: 999 };
    const payload = mapping.appStateToPayload(state([realRun("r1")]), lastRaw, stamps);
    expect(payload.runValuesUpdatedAt).toEqual({ r1: 999 });
  });

  it("map-less call yields an empty stamp map (never inherits lastRaw's)", () => {
    const lastRaw = {
      dayState: { runs: [{ id: "r1", stoppages: [] }], resetAt: 0, date: TODAY },
      runValues: {},
      runValuesUpdatedAt: { r1: 12345 },
    };
    const payload = mapping.appStateToPayload(state([realRun("r1")]), lastRaw);
    expect(payload.runValuesUpdatedAt).toEqual({});
  });

  it("echo/no-op signature contract: map-less signature is stable and unperturbed by stamps", () => {
    const s = state([realRun("r1"), realRun("r2")]);
    // Same state, two map-less builds -> identical signature (deterministic).
    const sigA = stableStringify(mapping.appStateToPayload(s, null));
    const sigB = stableStringify(mapping.appStateToPayload(s, null));
    expect(sigA).toBe(sigB);

    // The stamped push payload differs from the sig payload ONLY at
    // runValuesUpdatedAt — every other key is byte-identical. This is the
    // doPush contract: payload = build(state, raw, stamps); sig =
    // stableStringify(build(state, raw)).
    const stamped = mapping.appStateToPayload(s, null, { r1: 1751500000000 });
    const sigShape = mapping.appStateToPayload(s, null);
    const { runValuesUpdatedAt: stampedMap, ...stampedRest } = stamped;
    const { runValuesUpdatedAt: sigMap, ...sigRest } = sigShape;
    expect(stableStringify(stampedRest)).toBe(stableStringify(sigRest));
    expect(stampedMap).toEqual({ r1: 1751500000000 });
    expect(sigMap).toEqual({});

    // And minting a NEW stamp (a real local edit) must not change the map-less
    // signature at all — otherwise stamps would perturb echo detection.
    const sigAfterStamp = stableStringify(mapping.appStateToPayload(s, null));
    expect(sigAfterStamp).toBe(sigA);
  });

  it("drops stamps only for filtered-out pristine seed runs, keeping pushed and unknown ids", () => {
    // r1 is real, seed is a pristine placeholder (filtered from the push);
    // "gone" is a stamp for a run no longer in local state (kept — it may be
    // a peer's run we edited earlier).
    const seed = {
      id: "seed",
      seeded: true,
      settings: { brand: "", flavor: "", notes: "" },
      progress: {},
      stoppages: [],
      startedAt: undefined,
      endedAt: undefined,
      isRunning: false,
    };
    const stamps = { r1: 100, seed: 200, gone: 300 };
    const payload = mapping.appStateToPayload(state([realRun("r1"), seed]), null, stamps);
    expect(payload.runValuesUpdatedAt).toEqual({ r1: 100, gone: 300 });
    expect(Object.keys(payload.runValues)).toEqual(["r1"]);
  });
});
