// @vitest-environment node
//
// A product spec often names its dough, sauce, cheese blend, or topping mix
// before the corresponding master-data workbook is imported. Those names are
// useful profile links, but must never become all-zero server-pool recipes.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

const {
  applySpy,
  addNamedSpy,
  saveNamedSpy,
  saveCheeseSpy,
  saveMixesSpy,
} = vi.hoisted(() => ({
  applySpy: vi.fn(() => ({ touchedProfiles: [], crustProfiles: [] })),
  addNamedSpy: vi.fn(async () => ({ added: 0, updated: 0, items: [] })),
  saveNamedSpy: vi.fn(async () => []),
  saveCheeseSpy: vi.fn(async (items: CheeseRecipe[]) => items),
  saveMixesSpy: vi.fn(async (items: Mix[]) => items),
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
  canonicalProfileKey: (brand: string, flavor: string) => `${brand}\u0000${flavor}`,
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
  buildSpecSheetLabel: () => "",
  deriveSourceKey: () => "",
  selectPruneSnapshots: () => [],
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: vi.fn(),
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({ requestMatchImport: async () => [] }));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: async () => [],
  saveNamedRecipes: saveNamedSpy,
  addNamedRecipesToServerIfAbsent: addNamedSpy,
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: saveCheeseSpy,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: saveMixesSpy,
}));
vi.mock("./dieLineDefaultsServer", () => ({
  fetchDieLineDefaults: async () => [],
  toOverridesMap: () => ({}),
}));
vi.mock("./mergeSuggest", () => ({ fetchMergeAliases: async () => [] }));

import { commitSpecImport } from "./specImport";

describe("commitSpecImport empty pool stub guard", () => {
  beforeEach(() => {
    applySpy.mockClear();
    addNamedSpy.mockClear();
    saveNamedSpy.mockClear();
    saveCheeseSpy.mockClear();
    saveMixesSpy.mockClear();
  });

  it("keeps name-only profile links out of every server recipe pool", async () => {
    const result = await commitSpecImport({
      parsed: {
        profiles: [{
          brand: "Acme",
          flavor: "Cheese",
          doughName: "Awaiting Dough Workbook",
          sauceName: "Awaiting Sauce Workbook",
          applicators: [],
          pepperonis: [],
        }],
        recipes: [
          {
            kind: "dough",
            name: "Awaiting Dough Workbook",
            rows: [{ ingredient: "Flour", lbs: 0 }],
          },
          {
            kind: "sauce",
            name: "Awaiting Sauce Workbook",
            rows: [{ ingredient: "Tomatoes", lbs: 0 }],
          },
          {
            kind: "cheese",
            name: "Awaiting Cheese Workbook",
            rows: [{ ingredient: "Mozzarella", lbs: 0 }],
          },
          {
            kind: "cheese",
            name: "Awaiting Premix Workbook",
            forcedCategory: "mix",
            rows: [
              { ingredient: "Sauce", lbs: 0 },
              { ingredient: "Seasoning", lbs: 0 },
            ],
          },
        ],
      },
      newAliases: [],
    } as Parameters<typeof commitSpecImport>[0]);

    expect(applySpy).toHaveBeenCalledOnce();
    expect(addNamedSpy).not.toHaveBeenCalled();
    expect(saveNamedSpy).not.toHaveBeenCalled();
    expect(saveCheeseSpy).not.toHaveBeenCalled();
    expect(saveMixesSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mixesAdded: 0,
      cheeseRecipesAdded: 0,
      recipesUpdated: 0,
    });
  });
});