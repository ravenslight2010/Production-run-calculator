// @vitest-environment node
//
// Regression: when commitSpecImport auto-links a near-exact recipe name at
// commit time (e.g. "Mystic Pizza Sause" → "Mystic Pizza Sauce"), it must
// also persist a learned alias so the next re-import of the same sheet links
// silently without re-triggering the near-dup scan.
//
// The pure rename logic is covered in lib/spec-import — this locks the
// WIRING: that commitSpecImport passes the autoLinkedRenames accumulator,
// collects any renames produced by linkSpecImportNamedRecipesToExisting, and
// includes them in the aliases batch handed to saveSpecImportAliases.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ParsedSpecImport,
  ParsedProfile,
  ParsedRecipe,
} from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

// ---------------------------------------------------------------------------
// Fixture — one dough recipe whose imported name is a single-character typo
// of the existing pool entry. The near-dup matcher must fire and auto-link.
// ---------------------------------------------------------------------------

const BRAND = "Mystic Pizza";
const FLAVOR = "Cheese";
const POOL_NAME = "Mystic Dough"; // the correct existing pool name
const SHEET_NAME = "Mystic Dugh"; // single-char typo — near-dup matcher layer 3

function fixtureProfile(): ParsedProfile {
  return { brand: BRAND, flavor: FLAVOR, applicators: [], pepperonis: [] };
}

function fixtureRecipe(): ParsedRecipe {
  return {
    kind: "dough",
    name: SHEET_NAME,
    rows: [
      { ingredient: "Flour", lbs: 50 },
      { ingredient: "Water", lbs: 30 },
    ],
  };
}

function fixtureParse(): ParsedSpecImport {
  return { profiles: [fixtureProfile()], recipes: [fixtureRecipe()] };
}

// ---------------------------------------------------------------------------
// Mocks — same collaborator shape as specImportReimportPrune.test.ts
// ---------------------------------------------------------------------------

const { saveAliasesSpy, fetchNamedRecipesSpy } = vi.hoisted(() => ({
  saveAliasesSpy: vi.fn(async () => {}),
  fetchNamedRecipesSpy: vi.fn(async () => {
    throw new Error("no pool in tests");
  }),
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({}),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: () => ({ touchedProfiles: [], crustProfiles: [] }),
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: saveAliasesSpy,
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  fetchSavedSpecSheets: async () => [],
  buildSpecSheetLabel: () => "Sheet",
  deriveSourceKey: () => "mystic-pizza",
  selectPruneSnapshots: () => [],
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({ requestParseSpecSheet: vi.fn() ,
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: fetchNamedRecipesSpy,
  saveNamedRecipes: async () => {},
  addNamedRecipesToServerIfAbsent: async () => {},
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));

import { commitSpecImport } from "./specImport";

function preparedOf(parsed: ParsedSpecImport) {
  return {
    parsed,
    newAliases: [],
    sourceNames: ["mystic-pizza.xlsx"],
  } as unknown as Parameters<typeof commitSpecImport>[0];
}

beforeEach(() => {
  saveAliasesSpy.mockClear();
  fetchNamedRecipesSpy.mockReset();
  // Default: pool fetch fails (no pool) — no auto-link fires.
  fetchNamedRecipesSpy.mockRejectedValue(new Error("no pool in tests"));
});

describe("commitSpecImport auto-link alias learning", () => {
  it("saves no alias when the pool is unavailable (best-effort guard)", async () => {
    // Pool fetch throws → no relink, no alias.
    fetchNamedRecipesSpy.mockRejectedValue(new Error("offline"));
    await commitSpecImport(preparedOf(fixtureParse()));

    const savedAliases = saveAliasesSpy.mock.calls.flatMap((c) => c[0] as unknown[]);
    const recipeNameAliases = savedAliases.filter(
      (a): a is { kind: string; externalName: string; canonicalName: string; context: string } =>
        typeof a === "object" && a !== null && (a as { kind: string }).kind === "recipeName",
    );
    expect(recipeNameAliases).toHaveLength(0);
  });

  it("saves no alias when the sheet name exactly matches the pool name (no rename needed)", async () => {
    // Pool carries the SAME name as the sheet — exact loose-key match, no alias.
    fetchNamedRecipesSpy.mockImplementation(async (kind: string) => {
      if (kind === "dough") return [{ name: SHEET_NAME, components: [] }];
      return [];
    });
    await commitSpecImport(preparedOf(fixtureParse()));

    const savedAliases = saveAliasesSpy.mock.calls.flatMap((c) => c[0] as unknown[]);
    const recipeNameAliases = savedAliases.filter(
      (a): a is { kind: string; externalName: string; canonicalName: string; context: string } =>
        typeof a === "object" && a !== null && (a as { kind: string }).kind === "recipeName",
    );
    expect(recipeNameAliases).toHaveLength(0);
  });

  it("saves a recipeName alias when a near-exact dough name is auto-linked at commit time", async () => {
    // Pool has the correctly-spelled name; the sheet has a typo.
    // The near-dup matcher (layer 3, single-char typo) must auto-link and
    // the alias must be written so the next import skips the matcher.
    fetchNamedRecipesSpy.mockImplementation(async (kind: string) => {
      if (kind === "dough") return [{ name: POOL_NAME, components: [
        { ingredient: "Flour", lbs: 50 },
        { ingredient: "Water", lbs: 30 },
      ] }];
      return [];
    });

    await commitSpecImport(preparedOf(fixtureParse()));

    expect(saveAliasesSpy).toHaveBeenCalled();

    const allSaved = saveAliasesSpy.mock.calls.flatMap((c) => c[0] as unknown[]);
    const recipeNameAliases = allSaved.filter(
      (a): a is { kind: string; externalName: string; canonicalName: string; context: string } =>
        typeof a === "object" && a !== null && (a as { kind: string }).kind === "recipeName",
    );

    expect(recipeNameAliases.length).toBeGreaterThan(0);

    const alias = recipeNameAliases.find(
      (a) =>
        a.externalName.toLowerCase() === SHEET_NAME.toLowerCase() &&
        a.canonicalName.toLowerCase() === POOL_NAME.toLowerCase(),
    );
    expect(alias).toBeDefined();
    expect(alias!.context).toBe("dough");
  });

  it("saves a recipeName alias when a near-exact sauce name is auto-linked at commit time", async () => {
    const SAUCE_POOL = "House Marinara";
    const SAUCE_SHEET = "House Marinera"; // single vowel typo
    const sauceParse: ParsedSpecImport = {
      profiles: [fixtureProfile()],
      recipes: [
        {
          kind: "sauce",
          name: SAUCE_SHEET,
          rows: [{ ingredient: "Crushed Tomato", lbs: 20 }],
        },
      ],
    };

    fetchNamedRecipesSpy.mockImplementation(async (kind: string) => {
      if (kind === "sauce") return [{ name: SAUCE_POOL, components: [{ ingredient: "Crushed Tomato", lbs: 20 }] }];
      return [];
    });

    await commitSpecImport(preparedOf(sauceParse));

    const allSaved = saveAliasesSpy.mock.calls.flatMap((c) => c[0] as unknown[]);
    const recipeNameAliases = allSaved.filter(
      (a): a is { kind: string; externalName: string; canonicalName: string; context: string } =>
        typeof a === "object" && a !== null && (a as { kind: string }).kind === "recipeName",
    );

    const alias = recipeNameAliases.find(
      (a) =>
        a.externalName.toLowerCase() === SAUCE_SHEET.toLowerCase() &&
        a.canonicalName.toLowerCase() === SAUCE_POOL.toLowerCase(),
    );
    expect(alias).toBeDefined();
    expect(alias!.context).toBe("sauce");
  });
});
