import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeCheeseRecipes, type CheeseRecipe } from "@workspace/cheese-recipes";

vi.mock("./inventoryShared", () => ({ inventoryClientId: () => "revision-test" }));
vi.mock("./ingredients", () => ({ captureIngredientNamesToCatalog: vi.fn(async () => {}) }));
vi.mock("./masterData", () => ({ adoptMasterDataConflict: vi.fn() }));

import { fetchCheeseRecipes, saveCheeseRecipes, StaleCheeseRecipeSnapshotError } from "./cheeseRecipes";
import { adoptMasterDataConflict } from "./masterData";

const recipe: CheeseRecipe = {
  id: "blend", name: "Blend", brand: "", flavors: [],
  shredderSetting: "", cellulose: "", notes: "", enabled: true,
  components: [{ ingredient: "Mozzarella", lbs: 50 }],
  updatedAt: "2026-10-08T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("cheese import revision wire contract", () => {
  it("sends the fetched baseline revision with imported components", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [recipe] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [recipe] })));
    vi.stubGlobal("fetch", fetchMock);
    const { updatedAt: _revision, ...workbook } = recipe;
    const baseline = await fetchCheeseRecipes();
    await saveCheeseRecipes(mergeCheeseRecipes(baseline, [{
      ...workbook, components: [{ ingredient: "Mozzarella", lbs: 75 }],
    }]));
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.items[0].updatedAt).toBe(recipe.updatedAt);
    expect(body.items[0].components[0].lbs).toBe(75);
  });

  it("surfaces a true conflict, adopts canonical data, and never retries the save", async () => {
    const canonical = { ...recipe, updatedAt: "2026-10-08T13:00:00.000Z" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "STALE_RECIPE_SNAPSHOT", rejectedIds: ["blend"], items: [canonical],
    }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveCheeseRecipes([recipe])).rejects.toBeInstanceOf(StaleCheeseRecipeSnapshotError);
    expect(adoptMasterDataConflict).toHaveBeenCalledWith("cheeseRecipes", [canonical]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains a conflict even when an older server omits canonical items", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "STALE_RECIPE_SNAPSHOT" }), { status: 409 },
    )));
    await expect(saveCheeseRecipes([recipe])).rejects.toThrow(/Reopen the import review/);
    expect(adoptMasterDataConflict).not.toHaveBeenCalled();
  });
});
