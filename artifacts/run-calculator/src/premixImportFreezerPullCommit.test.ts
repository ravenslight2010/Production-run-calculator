// commitPremixImport freezer-pull contract:
// - pull settings apply AFTER the mixes commit, through buildFreezerPullUpserts
// - a freezer-pull save failure is best-effort: mixes stay applied, the result
//   carries a plain-language warning instead of throwing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PremixImportPrepared } from "./premixImport";

const fetchMixes = vi.fn(async () => []);
const saveMixes = vi.fn(async () => {});
const fetchFreezerPullItems = vi.fn(async () => [] as unknown[]);
const saveFreezerPullItems = vi.fn(async () => {});

vi.mock("./mixes", () => ({
  fetchMixes: (...a: unknown[]) => fetchMixes(...(a as [])),
  saveMixes: (...a: unknown[]) => saveMixes(...(a as [])),
}));
vi.mock("./freezerPull", () => ({
  fetchFreezerPullItems: (...a: unknown[]) => fetchFreezerPullItems(...(a as [])),
  saveFreezerPullItems: (...a: unknown[]) => saveFreezerPullItems(...(a as [])),
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
}));
vi.mock("./savedPremixSheets", () => ({
  savePremixSheet: async () => {},
  buildPremixSheetLabel: () => "",
  deriveSourceKey: () => "",
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
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
});
