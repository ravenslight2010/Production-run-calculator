import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheeseImportPrepared } from "./cheeseImport";

const fetchCheeseRecipes = vi.fn(async () => []);
const saveCheeseRecipes = vi.fn(async (recipes: unknown[]) => recipes);
const fetchMixes = vi.fn(async () => []);
const fetchSpecImportAliases = vi.fn(async () => []);
const saveSpecImportAliases = vi.fn(async () => {});
const deleteSpecImportAliases = vi.fn(async () => {});
const saveAiCorrections = vi.fn(async () => {});

vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: (...a: unknown[]) => fetchCheeseRecipes(...(a as [])),
  saveCheeseRecipes: (...a: unknown[]) => saveCheeseRecipes(...(a as [])),
}));
vi.mock("./mixes", () => ({
  fetchMixes: (...a: unknown[]) => fetchMixes(...(a as [])),
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: (...a: unknown[]) => fetchSpecImportAliases(...(a as [])),
  saveSpecImportAliases: (...a: unknown[]) => saveSpecImportAliases(...(a as [])),
  deleteSpecImportAliases: (...a: unknown[]) => deleteSpecImportAliases(...(a as [])),
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: (...a: unknown[]) => saveAiCorrections(...(a as [])),
}));
vi.mock("./specImport", () => ({ readWorkbookGrids: async () => [] }));

import { commitCheeseImport } from "./cheeseImport";

const prepared = {
  recipes: [],
  candidates: [],
  summary: { newCount: 0, updateCount: 0, names: [] },
  existingIds: [],
  prepItems: [],
  existingPool: [],
  absentRecipes: [],
} as unknown as CheeseImportPrepared;

const recipe = {
  id: "cheese:acme:correct-blend",
  name: "Correct Blend",
  brand: "Acme",
  flavors: [],
  shredderSetting: "",
  cellulose: 0,
  notes: "",
  components: [],
  enabled: true,
} as never;

describe("commitCheeseImport correcting aliases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCheeseRecipes.mockResolvedValue([]);
    fetchMixes.mockResolvedValue([]);
    fetchSpecImportAliases.mockResolvedValue([]);
  });

  it("removes a non-live stale redirect and learns the reverse correction", async () => {
    fetchSpecImportAliases.mockResolvedValue([
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Wrong Blend",
        context: "Acme",
      },
    ]);

    await commitCheeseImport(prepared, [recipe], [
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Correct Blend",
        context: "Acme",
      },
    ]);

    expect(deleteSpecImportAliases).toHaveBeenCalledWith(
      [
        {
          kind: "appType",
          externalName: "Sheet Blend",
          canonicalName: "Wrong Blend",
          context: "Acme",
        },
      ],
      { exactContext: true },
    );
    expect(saveSpecImportAliases).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          externalName: "Wrong Blend",
          canonicalName: "Correct Blend",
          context: "Acme",
        }),
      ]),
    );
    expect(saveAiCorrections).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "item",
          fromText: "Wrong Blend",
          toText: "Correct Blend",
        }),
      ]),
    );
  });

  it("keeps the old alias when its target is still a live mix", async () => {
    fetchSpecImportAliases.mockResolvedValue([
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Still Live Blend",
        context: "Acme",
      },
    ]);
    fetchMixes.mockResolvedValue([{ name: "Still Live Blend" }]);

    await commitCheeseImport(prepared, [recipe], [
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Correct Blend",
        context: "Acme",
      },
    ]);

    expect(deleteSpecImportAliases).not.toHaveBeenCalled();
    expect(saveSpecImportAliases).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          externalName: "Still Live Blend",
          canonicalName: "Correct Blend",
        }),
      ]),
    );
  });
});