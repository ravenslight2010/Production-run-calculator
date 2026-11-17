// @vitest-environment node
//
// Commit-level UNITS guard: a regular spec import must refresh compatible
// cheese-pool data without ever overwriting the server's per-BATCH pounds.
//
// Spec sheets express cheese amounts as PER-PIZZA ounces (dumped into the
// RecipeRow `lbs` field — long-standing parser quirk), while the server cheese
// pool stores PER-BATCH pounds. The importer converts the sheet amounts into
// component share percentages, retaining batch pounds and manager-owned
// metadata. Dough/sauce updates (whose workbooks ARE per-batch) still replace
// rows wholesale.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { NamedRecipe } from "@workspace/named-recipes";
import type { Mix } from "@workspace/mixes";

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

const { appliedLocally } = vi.hoisted(() => ({
  appliedLocally: { last: null as ParsedSpecImport | null },
}));
vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({ ...EMPTY_KNOWN }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: (parsed: ParsedSpecImport) => {
    appliedLocally.last = parsed;
    return { touchedProfiles: [], crustProfiles: [] };
  },
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
  requestParseSpecSheet: async () => {
    throw new Error("no AI parse in this test");
  },

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

// Factory merge history: commit resolves recipe ingredient names through the
// "ingredient" category before writing pool rows (spec-wins re-import).
const { mergeAliasesByCategory } = vi.hoisted(() => ({
  mergeAliasesByCategory: {} as Record<
    string,
    Array<{ externalName: string; canonicalName: string }>
  >,
}));
vi.mock("./mergeSuggest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mergeSuggest")>();
  return {
    ...actual,
    fetchMergeAliases: async (category?: string) =>
      mergeAliasesByCategory[category ?? "ingredient"] ?? [],
  };
});

// The curated pool recipe: per-BATCH pounds a manager refined by hand.
const CURATED_CHEESE: CheeseRecipe = {
  id: "aldos-cheese-mix",
  name: "Aldo's Cheese Mix",
  brand: "",
  flavors: [],
  shredderSetting: "3",
  cellulose: "Manager cellulose",
  notes: "Manager note",
  enabled: false,
  components: [
    { ingredient: "Pizella", lbs: 207 },
    { ingredient: "Part Skim Mozzarella", lbs: 119 },
  ],
};

const { savedCheese } = vi.hoisted(() => ({
  savedCheese: { last: null as CheeseRecipe[] | null, calls: 0 },
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [CURATED_CHEESE],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => {
    savedCheese.last = items;
    savedCheese.calls++;
    return items;
  },
}));

const { savedNamed, writeFailure } = vi.hoisted(() => ({
  savedNamed: { byKind: {} as Record<string, NamedRecipe[]> },
  writeFailure: { kind: "" as "" | "dough" | "sauce" },
}));
vi.mock("./namedRecipes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./namedRecipes")>();
  return {
    ...actual,
    fetchNamedRecipes: async (kind: "dough" | "sauce"): Promise<NamedRecipe[]> =>
      kind === "dough"
        ? [
            {
              id: "house-dough",
              name: "House Dough",
              components: [{ ingredient: "Old Flour", lbs: 10 }],
            },
          ]
        : [],
    saveNamedRecipes: async (kind: "dough" | "sauce", items: NamedRecipe[]) => {
      if (writeFailure.kind === kind) throw new Error(`simulated ${kind} pool write failure`);
      savedNamed.byKind[kind] = items;
      return items;
    },
  };
});

vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));

import { commitSpecImport, type SpecImportPrepared } from "./specImport";

function makePrepared(parsed: ParsedSpecImport): SpecImportPrepared {
  return {
    parsed,
    summary: { profilesTotal: 0, profilesNew: 0, recipesTotal: parsed.recipes.length, recipesNew: 0, warnings: [] } as unknown as SpecImportPrepared["summary"],
    newAliases: [],
    flagged: [],
    discrepancies: [],
    skipped: { profiles: [], recipes: [] },
    brands: [],
    flavorsByBrand: {},
    sourceNames: ["guard-test.xlsx"],
  };
}

beforeEach(() => {
  savedCheese.last = null;
  savedCheese.calls = 0;
  savedNamed.byKind = {};
  writeFailure.kind = "";
  appliedLocally.last = null;
  for (const k of Object.keys(mergeAliasesByCategory)) delete mergeAliasesByCategory[k];
});

describe("commitSpecImport — regular spec cheese updates preserve batch pounds", () => {
  it("refreshes matching recipe shares and assignment data without duplicating or overwriting manager fields", async () => {
    const prepared = makePrepared({
      profiles: [
        {
          brand: "Aldo's",
          flavor: "Pepperoni",
          app1: "Cheese",
          app1OzPerPizza: 3.26,
          app1CheeseRecipeName: "Aldo's Cheese Mix",
        },
      ],
      recipes: [
        {
          kind: "cheese",
          name: "Aldo's Cheese Mix",
          brand: "Aldo's",
          flavor: "Pepperoni",
          userNamed: true,
          // Per-pizza ounces in the lbs field (parser quirk). They become
          // sharePct values and must NEVER land in the pool's batch lbs column.
          rows: [
            { ingredient: "Pizella", lbs: 2.07 },
            { ingredient: "Part Skim Mozzarella", lbs: 1.19 },
          ],
        },
      ],
    });

    const { recipesUpdated, cheeseRecipesAdded } =
      await commitSpecImport(prepared);

    expect(recipesUpdated).toBe(0);
    expect(cheeseRecipesAdded).toBe(0);
    expect(savedCheese.calls).toBe(1);
    expect(savedCheese.last).toEqual([
      expect.objectContaining({
        id: "aldos-cheese-mix",
        name: "Aldo's Cheese Mix",
        brand: "Aldo's",
        flavors: ["Pepperoni"],
        shredderSetting: "3",
        cellulose: "Manager cellulose",
        notes: "Manager note",
        enabled: false,
        components: [
          { ingredient: "Pizella", lbs: 207, sharePct: 63.5 },
          { ingredient: "Part Skim Mozzarella", lbs: 119, sharePct: 36.5 },
        ],
      }),
    ]);
    expect(savedCheese.last).toHaveLength(1);
    // Commit hands the existing apply path the sheet's applicator assignment;
    // that path updates the run/profile link independently of the server pool.
    expect(appliedLocally.last?.profiles[0]).toMatchObject({
      app1: "Cheese",
      app1OzPerPizza: 3.26,
      app1CheeseRecipeName: "Aldo's Cheese Mix",
    });
  });

  it("always overwrites a dough pool recipe's rows on re-import — no updateExisting opt-in (spec wins)", async () => {
    const prepared = makePrepared({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "House Dough",
          rows: [{ ingredient: "New Flour", lbs: 42 }],
        },
      ],
    });

    const { recipesUpdated } = await commitSpecImport(prepared);

    expect(recipesUpdated).toBe(1);
    const dough = savedNamed.byKind["dough"] ?? [];
    expect(dough.find((r) => r.name === "House Dough")?.components).toEqual([
      { ingredient: "New Flour", lbs: 42 },
    ]);
    // Cheese pool untouched throughout.
    expect(savedCheese.calls).toBe(0);
  });

  it("never touches the pool for an explicit referenceOnly ('use existing, keep it') pick", async () => {
    const prepared = makePrepared({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "House Dough",
          referenceOnly: true,
          rows: [{ ingredient: "New Flour", lbs: 42 }],
        },
      ],
    });

    const { recipesUpdated } = await commitSpecImport(prepared);

    expect(recipesUpdated).toBe(0);
    expect(savedNamed.byKind["dough"]).toBeUndefined();
  });

  it("rejects an explicit import when a required dough/sauce pool write is not acknowledged", async () => {
    writeFailure.kind = "dough";
    const prepared = makePrepared({
      profiles: [],
      recipes: [{
        kind: "dough",
        name: "House Dough",
        rows: [{ ingredient: "New Flour", lbs: 42 }],
      }],
    });
    await expect(
      commitSpecImport(prepared, new Set(["corner booth\u0000pepperoni"])),
    ).rejects.toThrow("simulated dough pool write failure");
  });

  it("writes Fresh Spinach under its canonical Spinach survivor (resolveImportName)", async () => {
    mergeAliasesByCategory["ingredient"] = [
      { externalName: "Fresh Spinach (broken up)", canonicalName: "Spinach" },
    ];
    const prepared = makePrepared({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "House Dough",
          rows: [
            { ingredient: "Fresh Spinach (broken up)", lbs: 42 },
            { ingredient: "Water", lbs: 20 },
          ],
        },
      ],
    });

    const { recipesUpdated } = await commitSpecImport(prepared);

    expect(recipesUpdated).toBe(1);
    const dough = savedNamed.byKind["dough"] ?? [];
    expect(dough.find((r) => r.name === "House Dough")?.components).toEqual([
      { ingredient: "Spinach", lbs: 42 },
      { ingredient: "Water", lbs: 20 },
    ]);
    // The LOCAL apply (presets + ingredient lists) must see the SAME canonical
    // name — resolution happens once, before applySpecImport, so client-side
    // recipe state never diverges from the server pool.
    const localRows = appliedLocally.last?.recipes?.[0]?.rows ?? [];
    expect(localRows.map((r) => r.ingredient)).toEqual([
      "Spinach",
      "Water",
    ]);
  });
});
