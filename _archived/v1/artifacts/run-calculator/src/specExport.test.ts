import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadWorkbook: vi.fn(),
  fetchBrandProfilesSnapshot: vi.fn(),
  fetchNamedRecipes: vi.fn(),
  fetchCheeseRecipes: vi.fn(),
  fetchMixes: vi.fn(),
}));

vi.mock("./specExportWorkbook", () => ({ downloadWorkbook: mocks.downloadWorkbook }));
vi.mock("./profileServerSync", () => ({
  fetchBrandProfilesSnapshot: mocks.fetchBrandProfilesSnapshot,
}));
vi.mock("./namedRecipes", () => ({ fetchNamedRecipes: mocks.fetchNamedRecipes }));
vi.mock("./cheeseRecipes", () => ({ fetchCheeseRecipes: mocks.fetchCheeseRecipes }));
vi.mock("./mixes", () => ({ fetchMixes: mocks.fetchMixes }));

import { exportSpecRecipes } from "./specExport";

describe("exportSpecRecipes", () => {
  beforeEach(() => {
    mocks.downloadWorkbook.mockReset();
    mocks.fetchBrandProfilesSnapshot.mockReset();
    mocks.fetchNamedRecipes.mockReset();
    mocks.fetchCheeseRecipes.mockReset();
    mocks.fetchMixes.mockReset();
    mocks.fetchBrandProfilesSnapshot.mockResolvedValue([{
      key: "acme__pepperoni",
      brand: "Acme",
      flavor: "Pepperoni",
      values: {
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
      },
      crustValues: {},
      updatedAt: 1,
    }]);
    mocks.fetchNamedRecipes.mockImplementation(async (kind: string) =>
      kind === "dough"
        ? [{ name: "Standard Dough", components: [{ ingredient: "Flour", lbs: 50 }] }]
        : [{ name: "Pizza Sauce", components: [{ ingredient: "Tomato", lbs: 20 }] }],
    );
    mocks.fetchCheeseRecipes.mockResolvedValue([{
      name: "Cheese Blend",
      components: [{ ingredient: "Mozzarella", lbs: 40 }],
    }]);
    mocks.fetchMixes.mockResolvedValue([{
      id: "mix",
      name: "Acme Mix",
      brand: "Acme",
      flavor: "Pepperoni",
      batchSize: 10,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [{ ingredient: "Onion", perPizza: 0.5, perBatchLbs: 2 }],
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
    expect(mocks.fetchBrandProfilesSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.fetchNamedRecipes).toHaveBeenNthCalledWith(1, "dough", { cache: "no-store" });
    expect(mocks.fetchNamedRecipes).toHaveBeenNthCalledWith(2, "sauce", { cache: "no-store" });
    expect(mocks.fetchCheeseRecipes).toHaveBeenCalledWith({ cache: "no-store" });
    expect(mocks.fetchMixes).toHaveBeenCalledWith({ cache: "no-store" });
  });

  it("reports fresh-source failures instead of exporting stale local data", async () => {
    mocks.fetchNamedRecipes.mockRejectedValueOnce(new Error("server unavailable"));
    const result = await exportSpecRecipes(
      { specs: true, dough: true, sauce: true, cheese: true, mixes: true },
      "2026-10-18",
    );
    expect(result.failed).toEqual(["specs", "dough", "sauce", "cheese"]);
    expect(result.downloaded).toEqual({ mixes: 1 });
    expect(mocks.downloadWorkbook).toHaveBeenCalledTimes(1);
  });

  it("exports the server profile and recipe values rather than local cached values", async () => {
    await exportSpecRecipes(
      { specs: true, dough: true, sauce: true, cheese: true, mixes: false },
      "2026-10-18",
    );
    const specCall = mocks.downloadWorkbook.mock.calls.find(
      (call) => call[1] === "specs-2026-10-18.xlsx",
    );
    expect(specCall?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Acme",
        rows: expect.arrayContaining([
          expect.arrayContaining(["Acme", "Pepperoni"]),
        ]),
      }),
    ]));
    const sauceCall = mocks.downloadWorkbook.mock.calls.find(
      (call) => call[1] === "sauce-recipes-2026-10-18.xlsx",
    );
    expect(sauceCall?.[0][0].rows).toContainEqual(["Recipe: Pizza Sauce"]);
  });

  it("keeps Mix slot links in Specs without exporting profile-inline rows as Cheese", async () => {
    mocks.fetchBrandProfilesSnapshot.mockResolvedValue([{
      key: "sample-food__veggie",
      brand: "Sample Food",
      flavor: "Veggie",
      values: {
        app1Type: "Whole Mozzarella",
        app1OzPerPizza: 1,
        app1CheeseRecipeName: "Garden Mix",
        app1CheeseRecipe: [{ ingredient: "Onion", lbs: 0.5 }],
      },
      crustValues: {},
      updatedAt: 1,
    }]);
    mocks.fetchCheeseRecipes.mockResolvedValue([]);
    mocks.fetchMixes.mockResolvedValue([{
      id: "garden-mix",
      name: "Garden Mix",
      brand: "Sample Food",
      flavor: "Veggie",
      batchSize: 10,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [{ ingredient: "Onion", perPizza: 0.5, perBatchLbs: 2 }],
      enabled: true,
    }]);

    await exportSpecRecipes(
      { specs: true, dough: false, sauce: false, cheese: true, mixes: true },
      "2026-10-18",
    );

    const specCall = mocks.downloadWorkbook.mock.calls.find(
      (call) => call[1] === "specs-2026-10-18.xlsx",
    );
    const mixCall = mocks.downloadWorkbook.mock.calls.find(
      (call) => call[1] === "mixes-2026-10-18.xlsx",
    );
    const cheeseCall = mocks.downloadWorkbook.mock.calls.find(
      (call) => call[1] === "cheese-recipes-2026-10-18.xlsx",
    );
    const specCells = specCall?.[0].flatMap((grid) => grid.rows).flat() ?? [];
    const mixCells = mixCall?.[0].flatMap((grid) => grid.rows).flat() ?? [];

    expect(specCells).toContain("Garden Mix");
    expect(specCells).toContain("Whole Mozzarella");
    expect(mixCells).toContain("Garden Mix");
    expect(cheeseCall).toBeUndefined();
  });

  it("fails selected recipe exports when the Mix pool cannot classify shared slot links", async () => {
    mocks.fetchMixes.mockRejectedValueOnce(new Error("mix pool unavailable"));

    const result = await exportSpecRecipes(
      { specs: false, dough: false, sauce: false, cheese: true, mixes: false },
      "2026-10-18",
    );

    expect(result.failed).toEqual(["cheese"]);
    expect(mocks.downloadWorkbook).not.toHaveBeenCalled();
  });
});