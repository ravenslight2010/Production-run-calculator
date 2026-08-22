// @vitest-environment node
//
// Import success must mean the profile and its required recipe data both
// landed. In particular, a failed shared-pool write must not be swallowed after
// applySpecImport has already written a local profile.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ParsedProfile,
  ParsedRecipe,
  ParsedSpecImport,
} from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

const { applySpy, saveNamedSpy, fetchNamedSpy } = vi.hoisted(() => ({
  applySpy: vi.fn(() => ({ touchedProfiles: [], crustProfiles: [] })),
  saveNamedSpy: vi.fn(async () => []),
  fetchNamedSpy: vi.fn(async (kind: "dough" | "sauce") => [
    {
      id: `${kind}-1`,
      name: kind === "dough" ? "Classic Dough" : "House Marinara",
      components: [{ ingredient: "Old Ingredient", lbs: 1 }],
    },
  ]),
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({}),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: applySpy,
}));
vi.mock("./profileServerSync", () => ({
  canonicalProfileKey: (brand: string, flavor: string) =>
    `${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`,
  flushProfileQueueStrict: async () => {},
  markProfileForceEdited: () => {},
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
  deleteSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  fetchSavedSpecSheets: async () => [],
  buildSpecSheetLabel: () => "Representative spec",
  deriveSourceKey: () => "representative-spec",
  selectPruneSnapshots: () => [],
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: vi.fn(),
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("matcher is not part of the commit regression");
  },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: fetchNamedSpy,
  saveNamedRecipes: saveNamedSpy,
  addNamedRecipesToServerIfAbsent: async () => ({ added: 0, updated: 0, items: [] }),
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));
vi.mock("./dieLineDefaultsServer", () => ({
  fetchDieLineDefaults: async () => [],
  toOverridesMap: () => ({}),
}));
vi.mock("./mergeSuggest", () => ({
  fetchMergeAliases: async () => [],
}));

import { commitSpecImport } from "./specImport";

const profile: ParsedProfile = {
  brand: "Aldo's",
  flavor: "Cheese",
  sauceName: "House Marinara",
  doughName: "Classic Dough",
  sauceOzPerPizza: 4,
  applicators: [{ type: "Mozzarella", ozPerPizza: 5 }],
  pepperonis: [],
};

const sauce: ParsedRecipe = {
  kind: "sauce",
  name: "House Marinara",
  rows: [
    { ingredient: "Crushed Tomato", lbs: 20 },
    { ingredient: "Pull Garlic", lbs: 1.5 },
  ],
};

const dough: ParsedRecipe = {
  kind: "dough",
  name: "Classic Dough",
  rows: [{ ingredient: "Flour", lbs: 100 }],
};

function prepared(): Parameters<typeof commitSpecImport>[0] {
  return {
    parsed: { profiles: [profile], recipes: [sauce, dough] },
    newAliases: [],
    sourceNames: ["representative-spec.xlsx"],
  } as Parameters<typeof commitSpecImport>[0];
}

describe("commitSpecImport completeness", () => {
  beforeEach(() => {
    applySpy.mockReset();
    applySpy.mockReturnValue({
      touchedProfiles: [{ brand: profile.brand, flavor: profile.flavor }],
      crustProfiles: [],
    });
    fetchNamedSpy.mockReset();
    fetchNamedSpy.mockImplementation(async (kind: "dough" | "sauce") => [
      {
        id: `${kind}-1`,
        name: kind === "dough" ? "Classic Dough" : "House Marinara",
        components: [{ ingredient: "Old Ingredient", lbs: 1 }],
      },
    ]);
    saveNamedSpy.mockReset();
  saveNamedSpy.mockResolvedValue([
    {
      id: "dough-1",
      name: "Classic Dough",
      components: [{ ingredient: "Flour", lbs: 100 }],
    },
    {
      id: "sauce-1",
      name: "House Marinara",
      components: [
        { ingredient: "Crushed Tomato", lbs: 20 },
        { ingredient: "Pull Garlic", lbs: 1.5 },
      ],
    },
  ]);
  });

  it("passes the complete profile-linked recipe payload through the normal commit", async () => {
    await commitSpecImport(prepared());

    const applied = applySpy.mock.calls[0][0] as ParsedSpecImport;
    expect(applied.profiles).toEqual([expect.objectContaining({
      brand: "Aldo's",
      flavor: "Cheese",
      doughName: "Classic Dough",
      sauceName: "House Marinara",
    })]);
    expect(applied.recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "sauce",
        name: "House Marinara",
        rows: expect.arrayContaining([
          { ingredient: "Pull Garlic", lbs: 1.5 },
        ]),
      }),
      expect.objectContaining({
        kind: "dough",
        name: "Classic Dough",
        rows: [{ ingredient: "Flour", lbs: 100 }],
      }),
    ]));
    expect(saveNamedSpy).toHaveBeenCalled();
  });

  it("rejects when a required recipe write is not acknowledged", async () => {
    saveNamedSpy.mockRejectedValueOnce(new Error("Save sauce recipes failed (503)"));

    await expect(commitSpecImport(prepared())).rejects.toThrow(
      "Save sauce recipes failed (503)",
    );
  });

  it("rejects when the server acknowledges fewer normalized components", async () => {
    saveNamedSpy.mockResolvedValueOnce([
      { id: "sauce-1", name: "House Marinara", components: [{ ingredient: "Crushed Tomato", lbs: 20 }] },
    ]);
    await expect(commitSpecImport(prepared())).rejects.toThrow("Import incomplete");
  });
});