// commitPremixImport freezer-pull contract:
// - pull settings apply AFTER the mixes commit, through buildFreezerPullUpserts
// - a freezer-pull save failure is best-effort: mixes stay applied, the result
//   carries a plain-language warning instead of throwing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PremixImportPrepared } from "./premixImport";

const fetchMixes = vi.fn(async () => []);
const saveMixes = vi.fn(async () => {});
const fetchCheeseRecipes = vi.fn(async () => []);
const fetchSpecImportAliases = vi.fn(async () => []);
const saveSpecImportAliases = vi.fn(async () => {});
const deleteSpecImportAliases = vi.fn(async () => {});
const saveAiCorrections = vi.fn(async () => {});
const fetchFreezerPullItems = vi.fn(async () => [] as unknown[]);
const saveFreezerPullItems = vi.fn(async () => {});

vi.mock("./mixes", () => ({
  fetchMixes: (...a: unknown[]) => fetchMixes(...(a as [])),
  saveMixes: (...a: unknown[]) => saveMixes(...(a as [])),
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: (...a: unknown[]) => fetchCheeseRecipes(...(a as [])),
}));
vi.mock("./freezerPull", () => ({
  fetchFreezerPullItems: (...a: unknown[]) => fetchFreezerPullItems(...(a as [])),
  saveFreezerPullItems: (...a: unknown[]) => saveFreezerPullItems(...(a as [])),
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: (...a: unknown[]) => fetchSpecImportAliases(...(a as [])),
  saveSpecImportAliases: (...a: unknown[]) => saveSpecImportAliases(...(a as [])),
  deleteSpecImportAliases: (...a: unknown[]) => deleteSpecImportAliases(...(a as [])),
}));
vi.mock("./savedPremixSheets", () => ({
  savePremixSheet: async () => {},
  buildPremixSheetLabel: () => "",
  deriveSourceKey: () => "",
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: (...a: unknown[]) => saveAiCorrections(...(a as [])),
}));
vi.mock("./premixMatch", () => ({ requestMatchPremix: async () => ({ matches: [] }) }));
vi.mock("./storage", () => ({ loadSpecImportKnown: async () => null }));
vi.mock("./specImport", () => ({ readWorkbookGrids: async () => [] }));

import { commitPremixImport } from "./premixImport";

const prepared: PremixImportPrepared = {
  mixes: [],
  candidates: [],
  summary: { newCount: 0, updateCount: 0, names: [] } as never,
  newAliases: [],
  brands: [],
  flavorsByBrand: {},
  existingIds: [],
  freezerPulls: {},
  prepItems: [],
};

const mix = {
  id: "premix-bobos-breakfast-",
  name: "Bobo's Breakfast Mix",
  brand: "Bobos",
  flavor: "Breakfast",
  batchSize: 10,
  daysEarly: 3,
  notes: "",
  amountAlreadyMade: 0,
  components: [{ ingredient: "Scrambled Egg", perPizza: 1 }],
  enabled: true,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMixes.mockResolvedValue([]);
  fetchCheeseRecipes.mockResolvedValue([]);
  fetchSpecImportAliases.mockResolvedValue([]);
  fetchFreezerPullItems.mockResolvedValue([]);
});

describe("commitPremixImport freezer-pull application", () => {
  it("saves the suggested pull settings after the mixes and counts them", async () => {
    const result = await commitPremixImport(prepared, [mix], [
      { ingredient: "Scrambled Egg", daysEarly: 3 },
    ]);
    expect(saveMixes).toHaveBeenCalledTimes(1);
    expect(saveFreezerPullItems).toHaveBeenCalledTimes(1);
    const items = saveFreezerPullItems.mock.calls[0][0] as {
      ingredient: string;
      daysEarly: number;
    }[];
    expect(items).toHaveLength(1);
    expect(items[0].ingredient).toBe("Scrambled Egg");
    expect(items[0].daysEarly).toBe(3);
    expect(result.freezerPullCount).toBe(1);
    expect(result.warning).toBeUndefined();
  });

  it("keeps the mixes applied and returns a warning when the pull save fails", async () => {
    saveFreezerPullItems.mockRejectedValueOnce(new Error("network down"));
    const result = await commitPremixImport(prepared, [mix], [
      { ingredient: "Scrambled Egg", daysEarly: 3 },
    ]);
    expect(saveMixes).toHaveBeenCalledTimes(1);
    expect(result.freezerPullCount).toBe(0);
    expect(result.warning).toMatch(/freezer-pull/i);
  });

  it("skips the freezer-pull read/write entirely when no pulls were selected", async () => {
    const result = await commitPremixImport(prepared, [mix], []);
    expect(saveMixes).toHaveBeenCalledTimes(1);
    expect(fetchFreezerPullItems).not.toHaveBeenCalled();
    expect(saveFreezerPullItems).not.toHaveBeenCalled();
    expect(result.freezerPullCount).toBe(0);
  });

  it("persists pull reminders from a prep-only sheet even with zero mixes", async () => {
    // A sheet that is entirely prep/pull-early rows produces no mixes, but its
    // pull notes must still be saved (they used to be dropped by an early return).
    const result = await commitPremixImport(prepared, [], [
      { ingredient: "Fresh Spinach", daysEarly: 2 },
    ]);
    expect(saveMixes).not.toHaveBeenCalled();
    expect(saveFreezerPullItems).toHaveBeenCalledTimes(1);
    const items = saveFreezerPullItems.mock.calls[0][0] as {
      ingredient: string;
      daysEarly: number;
    }[];
    expect(items[0].ingredient).toBe("Fresh Spinach");
    expect(result.freezerPullCount).toBe(1);
  });

  it("does nothing when there are neither mixes nor pulls", async () => {
    const result = await commitPremixImport(prepared, [], []);
    expect(saveMixes).not.toHaveBeenCalled();
    expect(fetchFreezerPullItems).not.toHaveBeenCalled();
    expect(saveFreezerPullItems).not.toHaveBeenCalled();
    expect(result.freezerPullCount).toBe(0);
  });

  it("removes a non-live stale redirect and learns the reverse correction", async () => {
    fetchSpecImportAliases.mockResolvedValue([
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Wrong Blend",
        context: null,
      },
    ]);

    await commitPremixImport(prepared, [mix], [], [
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Correct Blend",
        context: null,
      },
    ]);

    expect(deleteSpecImportAliases).toHaveBeenCalledWith(
      [
        {
          kind: "appType",
          externalName: "Sheet Blend",
          canonicalName: "Wrong Blend",
          context: null,
        },
      ],
      { exactContext: true },
    );
    expect(saveSpecImportAliases).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          externalName: "Wrong Blend",
          canonicalName: "Correct Blend",
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
        context: null,
      },
    ]);
    fetchMixes.mockResolvedValue([{ ...mix, name: "Still Live Blend" }]);

    await commitPremixImport(prepared, [mix], [], [
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Correct Blend",
        context: null,
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

  it("keeps the old alias when its target is still a live cheese recipe", async () => {
    fetchSpecImportAliases.mockResolvedValue([
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Still Live Cheese",
        context: null,
      },
    ]);
    fetchCheeseRecipes.mockResolvedValue([{ name: "Still Live Cheese" }]);

    await commitPremixImport(prepared, [mix], [], [
      {
        kind: "appType",
        externalName: "Sheet Blend",
        canonicalName: "Correct Blend",
        context: null,
      },
    ]);

    expect(deleteSpecImportAliases).not.toHaveBeenCalled();
  });
});
