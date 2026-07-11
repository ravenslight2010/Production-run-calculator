// @vitest-environment node
//
// Prepare-time regression: a learned appType alias must NEVER silently rename
// an applicator whose grid cell names a cheese/mix RECIPE parsed from the same
// sheet.
//
// The appType alias kind doubles as the blend-name namespace: a "Use existing
// recipe" pick in the review dialog learns `sheet blend name → existing recipe
// name`. On a later import, canonicalizeParsed applies appType aliases to
// applicator types — if it renames a blend-named applicator to the existing
// recipe's name while the user declines the suggested link (creates new), the
// applicator type no longer loose-matches the created recipe, so
// applySpecImport's slot resolvers never re-type the slot to the generic
// "cheese"/"Mix" card and the blend leaks into the raw applicator Type
// dropdown. The alias must surface ONLY as an advisory link suggestion
// (aliasLinkSuggestions → dialog pre-select), never as a prepare-time rename.
//
// Genuine applicator-type aliases (e.g. "RAN SAUS" → "Sausage") must keep
// applying — only blend-named slots are exempt.

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
  applySpecImport: () => {},
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

describe("prepare — blend-named applicator slots are exempt from appType aliases", () => {
  it("keeps the sheet's blend name on the applicator, aliases the plain topping, and still surfaces the link suggestion", async () => {
    const prepared = await prepareSpecImport(realBuffer(), undefined, ["specs.xlsx"]);

    const apps = prepared.parsed.profiles[0]?.applicators ?? [];
    const types = apps.map((a) => a.type);
    // The blend-named slot survives verbatim so applySpecImport's slot resolver
    // still loose-matches it against the import's cheese recipe.
    expect(types).toContain(BLEND_NAME);
    expect(types).not.toContain(LINKED_NAME);
    // The genuine applicator-type alias still applies.
    expect(types).toContain("Sausage");
    expect(types).not.toContain("RAN SAUS");

    // The learned link surfaces as the advisory dialog suggestion instead.
    expect(prepared.aliasLinkSuggestions?.[BLEND_NAME.toLowerCase()]).toBe(LINKED_NAME);
  });
});
