import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadWorkbook: vi.fn(),
  fetchMixes: vi.fn(),
}));

vi.mock("./specExportWorkbook", () => ({ downloadWorkbook: mocks.downloadWorkbook }));
vi.mock("./mixes", () => ({ fetchMixes: mocks.fetchMixes }));
vi.mock("./storage", () => ({
  loadBrandFlavors: () => ({ Acme: ["Pepperoni"] }),
  loadProfile: () => ({
    dieType: "12 inch",
    sauceOzPerPizza: 4,
    app1Type: "Cheese Blend",
    app1OzPerPizza: 3.5,
    pep1Type: "Pepperoni",
    pep1Sticks: 2,
    pep1OzPerPizza: 1.5,
    doughRecipeName: "Standard Dough",
    targetDoughballWeight: 12,
    doughballsPerTray: 24,
    frontlineRecipeName: "Pizza Sauce",
    app1CheeseRecipeName: "Cheese Blend",
    doughRecipe: [{ ingredient: "Flour", lbs: 50 }],
    frontlineRecipe: [{ ingredient: "Tomato", lbs: 20 }],
    app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 40 }],
  }),
  loadDoughRecipePresets: () => ({
    "Standard Dough": { rows: [{ ingredient: "Flour", lbs: 50 }] },
  }),
  loadFrontlineRecipePresets: () => ({
    "Pizza Sauce": [{ ingredient: "Tomato", lbs: 20 }],
  }),
  loadCheeseRecipePresets: () => ({
    "Cheese Blend": [{ ingredient: "Mozzarella", lbs: 40 }],
  }),
}));

import { exportSpecRecipes } from "./specExport";

describe("exportSpecRecipes", () => {
  beforeEach(() => {
    mocks.downloadWorkbook.mockReset();
    mocks.fetchMixes.mockReset();
    mocks.fetchMixes.mockResolvedValue([{
      id: "mix",
      name: "Acme Mix",
      brand: "Acme",
      flavor: "Pepperoni",
      batchSize: 10,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [{ ingredient: "Onion", perPizza: 0.5 }],
      enabled: true,
    }]);
  });

  it("attempts all five downloads when one workbook fails", async () => {
    mocks.downloadWorkbook.mockImplementationOnce(() => {
      throw new Error("blocked download");
    });
    const result = await exportSpecRecipes(
      { specs: true, dough: true, sauce: true, cheese: true, mixes: true },
      "2026-09-06",
    );
    expect(mocks.downloadWorkbook).toHaveBeenCalledTimes(5);
    expect(mocks.downloadWorkbook.mock.calls.map((call) => call[1])).toEqual([
      "specs-2026-09-06.xlsx",
      "dough-recipes-2026-09-06.xlsx",
      "sauce-recipes-2026-09-06.xlsx",
      "cheese-recipes-2026-09-06.xlsx",
      "mixes-2026-09-06.xlsx",
    ]);
    expect(result.failed).toEqual(["specs"]);
    expect(result.downloaded).toEqual({ dough: 1, sauce: 1, cheese: 1, mixes: 1 });
  });
});