// @vitest-environment node
//
// End-to-end proof that an ACTIVE temporary substitution actually redirects the
// auto-deduct inventory consumption keys through each app's real glue — the
// highest-risk part of the substitutions feature and previously only covered by
// typecheck.
//
// The shared overlay math (applySubstitutions) and the consumption mapping
// (computeRunConsumptionLines) are unit-tested in @workspace/inventory-math. What
// is NOT proven there is that the PLATFORM glue wires the two together so a swap/
// add/remove reaches the generated `ingredient:<Name>:lbs|batches` lines:
//   - Web routes through a module-level "active substitutions" mirror
//     (substitutionState.setActiveSubstitutions) that inventoryShared overlays
//     onto `vals` (and maps targetDoughballWeight -> doughballWeightOz) BEFORE
//     calling the shared engine.
//   - Mobile threads the subs explicitly through `overlaySettings(settings, subs)`
//     and a `computeRunConsumptionLines` wrapper.
//
// This test drives BOTH real glue paths and asserts each produces consumption
// lines identical to a hand-applied overlay run through the shared lib, covering
// swap/add/remove and confirming a type-field substitution (e.g. app1Type) flips
// the consumption key. The mobile glue lives behind a React Native / Expo import
// graph, so it is loaded via the documented strip-imports -> transpile ->
// temp-file-import harness (.agents/memory/web-test-harness.md), with the REAL
// shared lib injected via globalThis so the wrappers compute genuine output.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as invMath from "@workspace/inventory-math";
import {
  applySubstitutions,
  computeRunConsumptionLines as libConsumptionLines,
  type IngredientSubstitution,
  type RecipeRow,
  type RunLinesInput,
  type ConsumeLine,
} from "@workspace/inventory-math";
import { DEFAULT_PEP_TYPES } from "./types";
import { setActiveSubstitutions } from "./substitutionState";
import { computeRunConsumptionLines as webConsumptionLines } from "./inventoryShared";

// ── Mobile glue loader (strip-imports → transpile → temp .mjs import) ─────────

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(
  here,
  "../../run-calculator-mobile/context/inventoryShared.ts",
);

// The mobile glue's imported symbols are all used INSIDE functions (never at
// module-eval), so after stripping imports we only need real implementations for
// the symbols the functions under test touch: the shared-lib helpers and
// DEFAULT_PEP_TYPES. The rest are harmless stubs. The real lib is injected via
// globalThis (set in beforeAll) because a temp .mjs in os.tmpdir() can't resolve
// the @workspace/* alias.
const STUB_PRELUDE = `
const __M = globalThis.__INV_MATH__;
const computeRunLinesShared = __M.computeRunLines;
const computeRunConsumptionLinesShared = __M.computeRunConsumptionLines;
const deriveCandidateItemsShared = __M.deriveCandidateItems;
const applySubstitutionsShared = __M.applySubstitutions;
const DEFAULT_PEP_TYPES = __M.DEFAULT_PEP_TYPES;
const getAuthToken = async () => null;
const Platform = { OS: "web" };
const getApiBaseUrl = () => "";
const getOrCreateClientId = async () => "test";
const notifyUnauthorized = () => {};
`;

interface MobileGlue {
  overlaySettings: (
    settings: Record<string, unknown>,
    subs: IngredientSubstitution[] | undefined,
  ) => Record<string, unknown>;
  computeRunConsumptionLines: (s: Record<string, unknown>) => ConsumeLine[];
}

let tempFile: string | null = null;

async function loadStrippedModule(file: string): Promise<MobileGlue> {
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
    `subConsume.mobile.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  tempFile = out;
  return (await import(pathToFileURL(out).href)) as unknown as MobileGlue;
}

let mobile: MobileGlue;

beforeAll(async () => {
  // Inject the real shared lib (plus DEFAULT_PEP_TYPES, identical web↔mobile by
  // the replit.md parity rule) for the stripped mobile glue to call.
  (globalThis as unknown as { __INV_MATH__: unknown }).__INV_MATH__ = {
    ...invMath,
    DEFAULT_PEP_TYPES,
  };
  mobile = await loadStrippedModule(MOBILE_FILE);
});

afterAll(() => {
  if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
});

// The web glue reads active subs from a module-level mirror; reset it after each
// test so cases can't leak into one another.
afterEach(() => setActiveSubstitutions([]));

// ── Fixtures ─────────────────────────────────────────────────────────────────

// A complete run settings object. Includes BOTH doughball field names so the
// same object feeds the web glue (FormValues.targetDoughballWeight) and the
// mobile glue / shared lib (doughballWeightOz) with identical values.
function baseSettings(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    casesNeeded: 100,
    pizzasPerCase: 12,
    casesPerLayer: 0,
    sauceBarrelLbs: 50,
    sauceOzPerPizza: 0,
    app1Type: "", app1BatchLbs: 30, app1OzPerPizza: 0,
    app2Type: "", app2BatchLbs: 30, app2OzPerPizza: 0,
    app3Type: "", app3BatchLbs: 30, app3OzPerPizza: 0,
    app4Type: "", app4BatchLbs: 30, app4OzPerPizza: 0,
    pep1Type: "", pep1BatchLbs: 28, pep1OzPerPizza: 0, pep1Sticks: 0,
    pep2Type: "", pep2BatchLbs: 28, pep2OzPerPizza: 0, pep2Sticks: 0,
    crustsPerCycle: 4, cycleSpeed: 10, speedAdjustment: 1,
    doughballWeightOz: 8, targetDoughballWeight: 8, doughBatchYield: 300,
    cartonsPerCase: 0, cartoned: "no",
    ...over,
  };
}

function sub(p: Partial<IngredientSubstitution>): IngredientSubstitution {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    ingredient: p.ingredient ?? "",
    action: p.action ?? "swap",
    substitute: p.substitute,
    amount: p.amount,
  };
}

// {itemKey -> qty}, so two consumption-line sets can be compared order-independently.
function keyQty(lines: ConsumeLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) out[l.itemKey] = l.qty;
  return out;
}

// Expected lines = the shared lib run on a hand-applied overlay. If the glue
// applies the substitution correctly, its output must equal this exactly
// (proving both the redirected key AND the substituted amount/qty).
function expectedLines(
  settings: Record<string, unknown>,
  subs: IngredientSubstitution[],
): Record<string, number> {
  const effective = applySubstitutions(settings, subs) as unknown as RunLinesInput;
  return keyQty(libConsumptionLines(effective, DEFAULT_PEP_TYPES));
}

// Run the WEB glue: set the module-level active subs, then compute lines.
function webLines(
  settings: Record<string, unknown>,
  subs: IngredientSubstitution[],
): Record<string, number> {
  setActiveSubstitutions(subs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return keyQty(webConsumptionLines(settings as any));
}

// Run the MOBILE glue: overlay the subs onto settings, then compute lines.
function mobileLines(
  settings: Record<string, unknown>,
  subs: IngredientSubstitution[],
): Record<string, number> {
  const overlaid = mobile.overlaySettings(settings, subs);
  return keyQty(mobile.computeRunConsumptionLines(overlaid));
}

// ── 1. Swap (type field) — the consumption key flips to the substitute ────────

describe("swap a type field redirects the consumption key (both platforms)", () => {
  const settings = baseSettings({
    app1Type: "Whole Mozzarella",
    app1OzPerPizza: 5,
    app1BatchLbs: 30,
  });
  const subs = [
    sub({ ingredient: "Whole Mozzarella", action: "swap", substitute: "Part Skim Mozzarella" }),
  ];

  it("web glue draws down the substitute, not the short item", () => {
    const before = keyQty(webConsumptionLines(settings as never));
    const after = webLines(settings, subs);
    expect(before["ingredient:Whole Mozzarella:batches"]).toBeGreaterThan(0);
    expect(after["ingredient:Whole Mozzarella:batches"]).toBeUndefined();
    // Substitute key present, carrying the same computed batches (batchLbs unchanged).
    expect(after["ingredient:Part Skim Mozzarella:batches"]).toBeCloseTo(
      before["ingredient:Whole Mozzarella:batches"],
      9,
    );
    expect(after).toEqual(expectedLines(settings, subs));
  });

  it("mobile glue matches the same hand-applied overlay", () => {
    const after = mobileLines(settings, subs);
    expect(after["ingredient:Whole Mozzarella:batches"]).toBeUndefined();
    expect(after["ingredient:Part Skim Mozzarella:batches"]).toBeGreaterThan(0);
    expect(after).toEqual(expectedLines(settings, subs));
  });
});

// ── 2. Remove (type field) — the consumption key is dropped entirely ──────────

describe("remove a type field drops the consumption key (both platforms)", () => {
  const settings = baseSettings({
    pep1Type: "Beef Crumble", // non-default -> produces a :batches line
    pep1OzPerPizza: 2,
    pep1BatchLbs: 28,
  });
  const subs = [sub({ ingredient: "Beef Crumble", action: "remove" })];

  it("web glue removes the line", () => {
    const before = keyQty(webConsumptionLines(settings as never));
    const after = webLines(settings, subs);
    expect(before["ingredient:Beef Crumble:batches"]).toBeGreaterThan(0);
    expect(after["ingredient:Beef Crumble:batches"]).toBeUndefined();
    expect(after).toEqual(expectedLines(settings, subs));
  });

  it("mobile glue removes the line", () => {
    const after = mobileLines(settings, subs);
    expect(after["ingredient:Beef Crumble:batches"]).toBeUndefined();
    expect(after).toEqual(expectedLines(settings, subs));
  });
});

// ── 3. Add (recipe row, with amount) — the supplement changes the line qty ────
// A recipe-row "add" supplements the cheese recipe, raising the effective batch
// weight and so changing the applicator's batches qty. Recipe-row ingredient
// names are not themselves keys; the substituted AMOUNT flows into the qty.

describe("add to a recipe row changes the consumption qty (both platforms)", () => {
  const settings = baseSettings({
    app1Type: "Whole Mozzarella",
    app1OzPerPizza: 5,
    app1BatchLbs: 30,
    app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 30 }] as RecipeRow[],
  });
  const subs = [
    sub({ ingredient: "Mozz", action: "add", substitute: "Skim Mozz", amount: 20 }),
  ];
  const KEY = "ingredient:Whole Mozzarella:batches";

  it("web glue reflects the added amount in the qty", () => {
    const before = keyQty(webConsumptionLines(settings as never));
    const after = webLines(settings, subs);
    // Same key (type unchanged), but the supplement raised the effective batch
    // weight (30 -> 50 lbs), so fewer batches are needed.
    expect(after[KEY]).toBeGreaterThan(0);
    expect(after[KEY]).toBeLessThan(before[KEY]);
    expect(after).toEqual(expectedLines(settings, subs));
  });

  it("mobile glue reflects the added amount in the qty", () => {
    const after = mobileLines(settings, subs);
    expect(after).toEqual(expectedLines(settings, subs));
  });
});

// ── 4. Swap (recipe row, with amount) — substitute amount drives the qty ──────

describe("swap a recipe row applies the substitute amount to the qty (both platforms)", () => {
  const settings = baseSettings({
    doughballWeightOz: 8,
    targetDoughballWeight: 8,
    doughBatchYield: 300,
    doughRecipe: [
      { ingredient: "Flour", lbs: 50 },
      { ingredient: "Water", lbs: 30 },
    ] as RecipeRow[],
  });
  const subs = [
    sub({ ingredient: "Flour", action: "swap", substitute: "GF Flour", amount: 70 }),
  ];
  const KEY = "ingredient:Dough:batches";

  it("web glue recomputes dough batches off the substituted recipe lbs", () => {
    const before = keyQty(webConsumptionLines(settings as never));
    const after = webLines(settings, subs);
    // Flour 50 -> GF Flour 70 lbs raises dough recipe lbs (80 -> 100), changing
    // the effective batch yield and so the batches qty.
    expect(after[KEY]).toBeGreaterThan(0);
    expect(after[KEY]).not.toBe(before[KEY]);
    expect(after).toEqual(expectedLines(settings, subs));
  });

  it("mobile glue recomputes dough batches off the substituted recipe lbs", () => {
    const after = mobileLines(settings, subs);
    expect(after).toEqual(expectedLines(settings, subs));
  });
});

// ── 5. Web and mobile glue agree line-for-line across every action ────────────

describe("web and mobile glue produce identical consumption lines (parity)", () => {
  const cases: { name: string; settings: Record<string, unknown>; subs: IngredientSubstitution[] }[] = [
    {
      name: "swap type field",
      settings: baseSettings({ app1Type: "Whole Mozzarella", app1OzPerPizza: 5 }),
      subs: [sub({ ingredient: "Whole Mozzarella", action: "swap", substitute: "Part Skim Mozzarella" })],
    },
    {
      name: "remove type field",
      settings: baseSettings({ pep1Type: "Beef Crumble", pep1OzPerPizza: 2 }),
      subs: [sub({ ingredient: "Beef Crumble", action: "remove" })],
    },
    {
      name: "add recipe row",
      settings: baseSettings({
        app1Type: "Whole Mozzarella",
        app1OzPerPizza: 5,
        app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 30 }] as RecipeRow[],
      }),
      subs: [sub({ ingredient: "Mozz", action: "add", substitute: "Skim Mozz", amount: 20 })],
    },
    {
      name: "swap recipe row",
      settings: baseSettings({
        doughRecipe: [
          { ingredient: "Flour", lbs: 50 },
          { ingredient: "Water", lbs: 30 },
        ] as RecipeRow[],
      }),
      subs: [sub({ ingredient: "Flour", action: "swap", substitute: "GF Flour", amount: 70 })],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const web = webLines(c.settings, c.subs);
      const mob = mobileLines(c.settings, c.subs);
      expect(web).toEqual(mob);
      expect(web).toEqual(expectedLines(c.settings, c.subs));
    });
  }
});
