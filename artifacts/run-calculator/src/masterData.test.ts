import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMasterDataBootstrap } from "./masterData";

describe("master-data bootstrap loading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shares one request across all startup collection consumers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ingredients: [{ id: "i1", name: "Flour", categories: ["dough"], enabled: true }],
        doughRecipes: [{ id: "d1", name: "Dough", components: [], enabled: true }],
        sauceRecipes: [{ id: "s1", name: "Sauce", components: [], enabled: true }],
        cheeseRecipes: [{ id: "c1", name: "Cheese", components: [], enabled: true }],
        mixes: [{ id: "m1", name: "Mix", components: [], enabled: true }],
      })),
    );

    const [first, second, third] = await Promise.all([
      fetchMasterDataBootstrap(),
      fetchMasterDataBootstrap(),
      fetchMasterDataBootstrap(),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.ingredients).toHaveLength(1);
    expect(second.doughRecipes[0]?.name).toBe("Dough");
    expect(third.mixes[0]?.name).toBe("Mix");
  });

  it("allows a later startup attempt after a failed request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ingredients: [], doughRecipes: [], sauceRecipes: [], cheeseRecipes: [], mixes: [],
      })));

    await expect(fetchMasterDataBootstrap()).rejects.toThrow("offline");
    await expect(fetchMasterDataBootstrap()).resolves.toMatchObject({ ingredients: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});