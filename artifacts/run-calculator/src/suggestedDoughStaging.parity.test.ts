// @vitest-environment node
//
// Parity + type-guard test for `suggestedDoughStaging`.
//
// The web copy lives in `src/hooks/useAutoTrack.ts` and exports its return type
// as `SuggestedDoughStagingReturn`. The mobile copy lives in
// `artifacts/run-calculator-mobile/context/RunContext.tsx` and annotates its
// return type inline. Because the two artifacts cannot import from each other,
// there is no automatic compile-time link catching a shape divergence.
//
// This file closes that gap two ways:
//
//   1. Compile-time bidirectional type assertion (no casts): A local mirror
//      type records the mobile function's current return shape. Two `extends`
//      checks anchored to `SuggestedDoughStagingReturn` produce TypeScript
//      errors if the web type adds/removes a field without a matching update to
//      the mirror — and vice versa.  The checks use `AssertTrue<T extends true>`
//      so that a violated constraint becomes a hard compile error, not a warning.
//      The `EXPECTED_KEYS` tuple is also pinned exhaustively against both
//      directions of the web type's key set.
//
//   2. Runtime exact-key-set + value-parity assertions: The mobile module is
//      loaded via the strip-imports pipeline (same pattern as
//      `runCalc.parity.test.ts`). `Object.keys()` checks verify the actual
//      returned object has EXACTLY the keys in `EXPECTED_KEYS` — no more, no
//      less. This catches the reverse drift: the mobile function's body gains a
//      third field, which TypeScript's structural return-type annotation would
//      silently allow even with an explicit annotation.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  suggestedDoughStaging as webSuggestedDoughStaging,
  type SuggestedDoughStagingReturn,
} from "./hooks/useAutoTrack";

// ── Compile-time type assertions ──────────────────────────────────────────────
//
// These resolve entirely at compile time (no runtime cost).  TypeScript
// evaluates the `extends` conditions during type-checking; if either resolves
// to `false`, `AssertTrue<false>` violates the `T extends true` constraint,
// producing a hard compile error.
//
// HOW TO READ:
//   _MobileReturnMirror must be kept in sync with the mobile function's inline
//   return-type annotation in RunContext.tsx. When the mobile or web type
//   changes, update this mirror AND the web type together. The checks below
//   then enforce the invariant at compile time:
//
//     • If web gains a required field → _MobileReturnMirror no longer extends
//       SuggestedDoughStagingReturn → compile error on _AssertMobileExtendsWeb.
//     • If web loses a field → SuggestedDoughStagingReturn no longer extends
//       _MobileReturnMirror → compile error on _AssertWebExtendsMobile.
//     • Same logic applies when the mirror is updated to reflect a mobile change.

// Mirror of mobile RunContext.tsx `suggestedDoughStaging` return type.
// Must be kept identical to the inline annotation in:
//   artifacts/run-calculator-mobile/context/RunContext.tsx
type _MobileReturnMirror = { trays: number | null; batches: number | null };

// Utility: produces a compile error if T is not literally `true`.
type AssertTrue<T extends true> = T;

// Bidirectional compatibility checks — both must be true.
type _MobileExtendsWeb = _MobileReturnMirror extends SuggestedDoughStagingReturn ? true : false;
type _WebExtendsMobile = SuggestedDoughStagingReturn extends _MobileReturnMirror ? true : false;

// These lines error at compile time if either direction is violated.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertMobileExtendsWeb = AssertTrue<_MobileExtendsWeb>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertWebExtendsMobile = AssertTrue<_WebExtendsMobile>;

// ── Exhaustive key tuple ──────────────────────────────────────────────────────
//
// EXPECTED_KEYS is pinned to EXACTLY the key set of SuggestedDoughStagingReturn
// via two bidirectional assertions:
//   • Every key in the array is a key of the web type (no extra keys).
//   • Every key of the web type is in the array (no missing keys).
// If the web type adds or removes a field, one of these compile-time checks
// fails before any runtime assertion even runs.

const EXPECTED_KEYS = ["trays", "batches"] as const;
type _ArrayElem = (typeof EXPECTED_KEYS)[number];

// All web-type keys must be covered by the array (catches web gaining a field).
type _AllWebKeysCoveredByArray = AssertTrue<
  keyof SuggestedDoughStagingReturn extends _ArrayElem ? true : false
>;
// All array elements must be valid web-type keys (catches typos in EXPECTED_KEYS).
type _AllArrayElemsAreWebKeys = AssertTrue<
  _ArrayElem extends keyof SuggestedDoughStagingReturn ? true : false
>;

// ── Strip-imports pipeline ────────────────────────────────────────────────────

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

// No `as` cast is used here — the interface describes the runtime shape we
// assert below; it intentionally does NOT claim to enforce the type of the
// dynamically loaded export (which is always `unknown` at the module boundary).
interface MobileModule {
  suggestedDoughStaging: (...args: unknown[]) => unknown;
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
    `suggestedDoughStaging.mobile.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  tempFile = out;
  return (await import(pathToFileURL(out).href)) as unknown as MobileModule;
}

let mobile: MobileModule;

beforeAll(async () => {
  mobile = await loadStrippedModule(MOBILE_FILE);
});

afterAll(() => {
  if (tempFile) {
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertExactShape(result: unknown, label: string): SuggestedDoughStagingReturn {
  expect(result, `${label}: result must be an object`).toBeTypeOf("object");
  expect(result, `${label}: result must not be null`).not.toBeNull();
  const keys = Object.keys(result as object).sort();
  const expected = [...EXPECTED_KEYS].sort();
  expect(
    keys,
    `${label}: exact key set must be ${JSON.stringify(expected)} — no extra fields, no missing fields`,
  ).toEqual(expected);
  return result as SuggestedDoughStagingReturn;
}

// ── Test cases ────────────────────────────────────────────────────────────────

const CASES: Array<{
  label: string;
  traysNeeded: number;
  batchesNeeded: number;
  expectedTrays: number | null;
  expectedBatches: number | null;
}> = [
  {
    label: "both positive (typical mid-run)",
    traysNeeded: 20,
    batchesNeeded: 2,
    expectedTrays: 20,
    expectedBatches: 2,
  },
  {
    label: "trays capped at 40-tray staging limit",
    traysNeeded: 60,
    batchesNeeded: 1,
    expectedTrays: 40,
    expectedBatches: 1,
  },
  {
    label: "trays capped at 74-tray stepper max",
    traysNeeded: 80,
    batchesNeeded: 3,
    expectedTrays: 40,
    expectedBatches: 3,
  },
  {
    label: "batches capped at 3",
    traysNeeded: 10,
    batchesNeeded: 5,
    expectedTrays: 10,
    expectedBatches: 3,
  },
  {
    label: "trays fractional rounds to nearest integer",
    traysNeeded: 7.6,
    batchesNeeded: 1.4,
    expectedTrays: 8,
    expectedBatches: 2,
  },
  {
    label: "trays minimum clamped to 1",
    traysNeeded: 0.1,
    batchesNeeded: 0.1,
    expectedTrays: 1,
    expectedBatches: 1,
  },
  {
    label: "zero trays needed → null",
    traysNeeded: 0,
    batchesNeeded: 2,
    expectedTrays: null,
    expectedBatches: 2,
  },
  {
    label: "zero batches needed → null",
    traysNeeded: 5,
    batchesNeeded: 0,
    expectedTrays: 5,
    expectedBatches: null,
  },
  {
    label: "both zero → both null",
    traysNeeded: 0,
    batchesNeeded: 0,
    expectedTrays: null,
    expectedBatches: null,
  },
  {
    label: "negative trays → null (treated as nothing needed)",
    traysNeeded: -3,
    batchesNeeded: 2,
    expectedTrays: null,
    expectedBatches: 2,
  },
];

describe("suggestedDoughStaging parity — web vs mobile", () => {
  for (const { label, traysNeeded, batchesNeeded, expectedTrays, expectedBatches } of CASES) {
    it(label, () => {
      const webResult = webSuggestedDoughStaging(traysNeeded, batchesNeeded);
      const mobileRaw = mobile.suggestedDoughStaging(traysNeeded, batchesNeeded);

      // Runtime exact-shape guard: mobile must return EXACTLY the two keys, no
      // more. This is the primary runtime drift detector; the compile-time checks
      // above catch web-type changes, but only this catches the mobile BODY
      // gaining a third field that its own inline annotation would silently allow.
      const mobileResult = assertExactShape(mobileRaw, `mobile(${traysNeeded}, ${batchesNeeded})`);
      assertExactShape(webResult, `web(${traysNeeded}, ${batchesNeeded})`);

      // Value parity: both functions must produce identical numbers.
      expect(mobileResult.trays, `trays mismatch for "${label}"`).toBe(webResult.trays);
      expect(mobileResult.batches, `batches mismatch for "${label}"`).toBe(webResult.batches);

      // Expected-value lock: pins the formula for regressions.
      expect(webResult.trays, `web trays for "${label}"`).toBe(expectedTrays);
      expect(webResult.batches, `web batches for "${label}"`).toBe(expectedBatches);
    });
  }
});

describe("suggestedDoughStaging return type — exact key set contract", () => {
  it("returned object has exactly the keys declared in SuggestedDoughStagingReturn (trays, batches) and no others", () => {
    const webResult = webSuggestedDoughStaging(10, 2);
    const mobileResult = assertExactShape(
      mobile.suggestedDoughStaging(10, 2),
      "mobile(10, 2)",
    );

    const webKeys = Object.keys(webResult).sort();
    const mobileKeys = Object.keys(mobileResult).sort();
    const contractKeys = [...EXPECTED_KEYS].sort();

    expect(webKeys, "web: key set must match SuggestedDoughStagingReturn").toEqual(contractKeys);
    expect(mobileKeys, "mobile: key set must match SuggestedDoughStagingReturn").toEqual(contractKeys);

    // Counter-proof: verify the assertion above has real teeth — if the key
    // lists somehow collapsed to a single element, something is wrong.
    expect(webKeys.length).toBeGreaterThan(1);
    expect(mobileKeys.length).toBeGreaterThan(1);
  });

  it("mobile and web key sets are identical (no fields added to one side only)", () => {
    const webKeys = Object.keys(webSuggestedDoughStaging(5, 1)).sort();
    const mobileKeys = Object.keys(
      assertExactShape(mobile.suggestedDoughStaging(5, 1), "mobile(5, 1)"),
    ).sort();
    expect(mobileKeys, "mobile key set diverged from web").toEqual(webKeys);
  });
});
