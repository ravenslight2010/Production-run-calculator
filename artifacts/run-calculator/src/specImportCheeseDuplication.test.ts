// @vitest-environment node
//
// Pipeline-level regression: one named cheese mix must NOT split into two.
//
// The real "Aldo's Pizza Specs" workbook lists a single named blend — "Aldo's
// Cheese Mix" — at TWO different per-pizza weights: 2.07-base for the plain
// CHEESE pizza and 1.75-base for MEAT LOVER / S&P / PEPPERONI / SAUSAGE. Each
// applicator cell embeds the full blend composition inline. If the deterministic
// spec-import safety net (extractEmbeddedApplicatorBlends → canonicalize →
// dedupe → collect → seed) keyed on the per-pizza weight instead of the name, it
// would emit TWO separate cheese pool recipes for one real mix — the exact
// name-splitting bug this test guards against.
//
// This runs the REAL prepare/commit orchestration end-to-end against the REAL
// Aldo workbook bytes, but stays deterministic (no live AI) by mocking the parse
// endpoint to return a fixed ParsedSpecImport that mirrors the workbook: the same
// named mix embedded at the two real weights across the five flavors. The fixture
// is grounded to the real file (asserted below) so it can't silently drift.
//
// Assertions:
//   1. prepareSpecImport → exactly ONE cheese pool recipe ("Aldo's Cheese Mix")
//      and every profile's cheese applicator points at that one name.
//   2. commitSpecImport → exactly ONE cheese recipe seeded into the pool
//      (cheeseRecipesAdded === 1), never two.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gridsToPromptText,
  type ParsedSpecImport,
  type ParsedProfile,
} from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

// ---------------------------------------------------------------------------
// The real workbook. Both per-pizza weights of the ONE named mix live here.
// ---------------------------------------------------------------------------

const ALDO_XLSX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../attached_assets/Aldo's_Pizza_Specs_-_09_1783188271692.xlsx",
);

const CHEESE_MIX_NAME = "Aldo's Cheese Mix";
// The two blends exactly as they appear inline in the real Aldo workbook.
const BLEND_HEAVY = "2.07 Pizella, 1.19 Part Skim Mozzarella, 0.26 Grated Parmesan, 0.13 Oregano Flake";
const BLEND_LIGHT = "1.75 Pizella, 1.0 Part Skim Mozzarella, 0.1 Grated Parmesan, 0.05 Oregano Flake";

function realAldoBuffer(): ArrayBuffer {
  const buf = fs.readFileSync(ALDO_XLSX);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ---------------------------------------------------------------------------
// Mocks — same collaborator shape as specImportJunkFileGuard.test.ts.
// ---------------------------------------------------------------------------

const EMPTY_KNOWN = {
  brands: [] as string[],
  flavorsByBrand: {} as Record<string, string[]>,
  appTypes: [] as string[],
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

// One profile per flavor, each with a single cheese applicator whose `type`
// embeds "Aldo's Cheese Mix <blend>" — the worst case the AI can emit (blend
// left inline). The CHEESE flavor uses the heavy blend; the rest use the light
// blend, exactly as the real workbook does.
const FLAVOR_BLENDS: Array<[flavor: string, blend: string, oz: number]> = [
  ["Cheese", BLEND_HEAVY, 3.65],
  ["Meat Lover", BLEND_LIGHT, 2.9],
  ["S & P", BLEND_LIGHT, 2.9],
  ["Pepperoni", BLEND_LIGHT, 2.9],
  ["Sausage", BLEND_LIGHT, 2.9],
];

function fixtureParse(): ParsedSpecImport {
  const profiles: ParsedProfile[] = FLAVOR_BLENDS.map(([flavor, blend, oz]) => ({
    brand: "Aldo's",
    flavor,
    applicators: [{ type: `${CHEESE_MIX_NAME} ${blend}`, ozPerPizza: oz }],
    pepperonis: [],
  }));
  return { profiles, recipes: [] };
}

const { parseSpy } = vi.hoisted(() => ({
  parseSpy: vi.fn(),
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({ ...EMPTY_KNOWN }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: () => ({ touchedProfiles: [], crustProfiles: [] }),
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
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
  // No AI matcher in tests — the import must fall back to the canonical parse.
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: async () => {},
}));

const { savedCheese } = vi.hoisted(() => ({
  savedCheese: { last: null as CheeseRecipe[] | null },
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => {
    savedCheese.last = items;
    return items;
  },
}));

const { savedMixes } = vi.hoisted(() => ({
  savedMixes: { last: null as Mix[] | null },
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => {
    savedMixes.last = items;
    return items;
  },
}));

import { prepareSpecImport, commitSpecImport, readWorkbookGrids } from "./specImport";

beforeEach(() => {
  parseSpy.mockReset();
  parseSpy.mockImplementation(async () => fixtureParse());
  savedCheese.last = null;
  savedMixes.last = null;
});

// ---------------------------------------------------------------------------
// Grounding: the fixture reflects the REAL workbook (same mix, two weights).
// ---------------------------------------------------------------------------

describe("Aldo workbook — fixture stays honest to the real file", () => {
  it("the real workbook lists one named cheese mix at two per-pizza weights", async () => {
    const grids = await readWorkbookGrids(realAldoBuffer());
    const text = gridsToPromptText(grids);
    expect(text).toContain(CHEESE_MIX_NAME);
    // Both real per-pizza weights of that ONE mix are present in the source.
    expect(text).toContain("2.07 Pizella");
    expect(text).toContain("1.75 Pizella");
  });
});

// ---------------------------------------------------------------------------
// The regression: prepare + commit must produce exactly ONE cheese recipe.
// ---------------------------------------------------------------------------

function cheeseRecipesOf(parsed: ParsedSpecImport) {
  return parsed.recipes.filter((r) => r.kind === "cheese");
}

describe("spec-import pipeline — one named cheese mix does not split into two", () => {
  it("prepareSpecImport collapses both weights to a single cheese pool recipe", async () => {
    const prepared = await prepareSpecImport(realAldoBuffer(), undefined, ["Aldo's_Pizza_Specs.xlsx"]);

    // Exactly one cheese pool recipe despite two distinct per-pizza weights.
    const cheese = cheeseRecipesOf(prepared.parsed);
    expect(cheese).toHaveLength(1);
    expect(cheese[0]?.name).toBe(CHEESE_MIX_NAME);

    // Every profile's cheese applicator points at that one recipe name — the
    // embedded blend has been stripped out of the type and hoisted to the pool.
    const cheeseApplicatorTypes = prepared.parsed.profiles.flatMap((p) =>
      p.applicators
        .filter((a) => a.type.includes("Cheese Mix") || a.type === CHEESE_MIX_NAME)
        .map((a) => a.type),
    );
    expect(cheeseApplicatorTypes.length).toBeGreaterThan(0);
    for (const t of cheeseApplicatorTypes) {
      expect(t).toBe(CHEESE_MIX_NAME);
    }
  });

  it("commitSpecImport seeds exactly ONE cheese recipe into the pool", async () => {
    const prepared = await prepareSpecImport(realAldoBuffer(), undefined, ["Aldo's_Pizza_Specs.xlsx"]);
    const { cheeseRecipesAdded } = await commitSpecImport(prepared);

    expect(cheeseRecipesAdded).toBe(1);
    expect(savedCheese.last).not.toBeNull();
    const savedCheeseNames = (savedCheese.last ?? []).map((c) => c.name);
    expect(savedCheeseNames).toEqual([CHEESE_MIX_NAME]);

    // The named cheese mix must never leak into the Mixes pool.
    expect(savedMixes.last ?? []).toHaveLength(0);
  });
});
