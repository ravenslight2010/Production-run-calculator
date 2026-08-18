// @vitest-environment node
//
// Prepare-time regression: a learned appType (blend-name) alias must never
// rename a blend-named applicator slot WITHOUT its recipe — the two must move
// in LOCKSTEP or applySpecImport's slot resolvers can no longer loose-match
// the slot against the import's cheese/mix recipe and the blend leaks into the
// raw applicator Type dropdown.
//
// canonicalizeParsed still skips appType aliases on blend-named slots (the
// unsafe one-sided rename); applySpecImportBlendNameAliases is the safe
// counterpart that then renames the RECIPE and every matching slot together,
// so a prior review-time "Use existing recipe" pick or manual rename is
// REMEMBERED on re-import (this was the "cheese changes are forgotten" bug —
// mix/dough/sauce remembered, cheese didn't).
//
// Genuine applicator-type aliases (e.g. "RAN SAUS" → "Sausage") must keep
// applying to plain topping slots.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

// Any real workbook works — the parse endpoint is mocked; the bytes only need
// to pass the junk-file sanity checks. Reuse the committed Aldo asset.
const REAL_XLSX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../attached_assets/Aldo's_Pizza_Specs_-_09_1783188271692.xlsx",
);

function realBuffer(): ArrayBuffer {
  const buf = fs.readFileSync(REAL_XLSX);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const BLEND_NAME = "Aldo's Spinach Blend";
const LINKED_NAME = "Lowe's Spinach Cheese Mix";

const KNOWN = {
  brands: [] as string[],
  flavorsByBrand: {} as Record<string, string[]>,
  appTypes: ["Sausage"],
  pepTypes: [] as string[],
  cheeseIngredients: [] as string[],
  doughIngredients: [] as string[],
  sauceIngredients: [] as string[],
  sauceNames: [] as string[],
  dieTypes: [] as string[],
  doughRecipes: [] as string[],
  sauceRecipes: [] as string[],
  cheeseRecipes: [] as string[],
};

// One profile: applicator 1 names the sheet's own cheese blend (must stay
// verbatim), applicator 2 is a plain topping with a genuine appType alias
// (must still canonicalize).
function fixtureParse(): ParsedSpecImport {
  return {
    profiles: [
      {
        brand: "Aldo's",
        flavor: "Spinach",
        applicators: [
          { type: BLEND_NAME, ozPerPizza: 3 },
          { type: "RAN SAUS", ozPerPizza: 1 },
        ],
        pepperonis: [],
      },
    ],
    recipes: [
      {
        kind: "cheese",
        name: BLEND_NAME,
        brand: "Aldo's",
        flavor: "Spinach",
        rows: [
          { ingredient: "Mozzarella", lbs: 20 },
          { ingredient: "Spinach", lbs: 5 },
        ],
      },
    ],
  };
}

const { parseSpy } = vi.hoisted(() => ({
  parseSpy: vi.fn(),
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({ ...KNOWN }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: () => ({ touchedProfiles: [], crustProfiles: [] }),
}));
vi.mock("./specImportAliases", () => ({
  // The learned blend-name link from a past "Use existing recipe" pick, plus a
  // genuine applicator-type alias — both live under the same appType kind.
  fetchSpecImportAliases: async () => [
    { kind: "appType", externalName: BLEND_NAME, canonicalName: LINKED_NAME, context: null },
    { kind: "appType", externalName: "RAN SAUS", canonicalName: "Sausage", context: null },
  ],
  saveSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  buildSpecSheetLabel: () => "",
  deriveSourceKey: () => "",
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: parseSpy,
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: async () => {},
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));

import { prepareSpecImport } from "./specImport";

beforeEach(() => {
  parseSpy.mockReset();
  parseSpy.mockImplementation(async () => fixtureParse());
});

describe("prepare — blend-name aliases rename recipe + slots in lockstep", () => {
  it("applies the remembered blend link to the recipe AND its slot together, and still aliases the plain topping", async () => {
    const prepared = await prepareSpecImport(realBuffer(), undefined, ["specs.xlsx"]);

    // The remembered reassignment applies to the RECIPE…
    const cheese = prepared.parsed.recipes.find((r) => r.kind === "cheese");
    expect(cheese?.name).toBe(LINKED_NAME);

    // …and to the blend-named slot IN LOCKSTEP, so the slot still loose-matches
    // the import's cheese recipe (never a one-sided rename).
    const apps = prepared.parsed.profiles[0]?.applicators ?? [];
    const types = apps.map((a) => a.type);
    expect(types).toContain(LINKED_NAME);
    expect(types).not.toContain(BLEND_NAME);

    // The genuine applicator-type alias still applies.
    expect(types).toContain("Sausage");
    expect(types).not.toContain("RAN SAUS");

    // The learned link still surfaces in the advisory suggestion map (harmless
    // now that the name already matches — the dialog skips self-suggestions).
    expect(prepared.aliasLinkSuggestions?.[BLEND_NAME.toLowerCase()]).toBe(LINKED_NAME);
  });
});
