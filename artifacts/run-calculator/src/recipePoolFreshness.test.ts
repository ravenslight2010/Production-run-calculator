import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { saveCheeseRecipes, StaleCheeseRecipeSnapshotError } from "./cheeseRecipes";
import { saveMixes, StaleMixSnapshotError } from "./mixes";
import { saveNamedRecipes, StaleNamedRecipeSnapshotError } from "./namedRecipes";
import {
  MASTER_DATA_QUERY_KEY,
  registerMasterDataQueryClient,
  type MasterDataBootstrap,
} from "./masterData";

function conflictResponse(items: unknown[], rejectedIds: string[]): Response {
  return new Response(JSON.stringify({ error: "STALE_RECIPE_SNAPSHOT", items, rejectedIds }), {
    status: 409,
    headers: { "content-type": "application/json" },
  });
}

function seedQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  const bootstrap: MasterDataBootstrap = {
    ingredients: [],
    doughRecipes: [],
    sauceRecipes: [],
    cheeseRecipes: [],
    mixes: [],
  };
  queryClient.setQueryData(MASTER_DATA_QUERY_KEY, bootstrap);
  registerMasterDataQueryClient(queryClient);
  return queryClient;
}

describe("recipe-pool freshness conflicts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("adopts the authoritative mix pool and never retries a stale write", async () => {
    const queryClient = seedQueryClient();
    const fetchMock = vi.fn().mockResolvedValue(
      conflictResponse(
        [
          {
            id: "mix-1",
            name: "Canonical Mix",
            brand: "Aldo's",
            flavor: "Fajita",
            batchSize: 10,
            daysEarly: 0,
            amountAlreadyMade: 0,
            components: [{ ingredient: "Cheese", perPizza: 1 }],
            enabled: true,
            updatedAt: "2026-09-09T12:00:00.000Z",
          },
        ],
        ["mix-1"],
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveMixes([
        {
          id: "mix-1",
          name: "Stale Mix",
          brand: "Aldo's",
          flavor: "Fajita",
          batchSize: 10,
          daysEarly: 0,
          amountAlreadyMade: 0,
          components: [{ ingredient: "Cheese", perPizza: 2 }],
          enabled: true,
          updatedAt: "2026-09-09T11:00:00.000Z",
        },
      ]),
    ).rejects.toBeInstanceOf(StaleMixSnapshotError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<MasterDataBootstrap>(MASTER_DATA_QUERY_KEY)?.mixes).toEqual([
      {
        id: "mix-1",
        name: "Canonical Mix",
        brand: "Aldo's",
        flavor: "Fajita",
        batchSize: 10,
        daysEarly: 0,
        amountAlreadyMade: 0,
        components: [{ ingredient: "Cheese", perPizza: 1 }],
        enabled: true,
        updatedAt: "2026-09-09T12:00:00.000Z",
      },
    ]);
  });

  it("adopts the authoritative cheese pool on conflict", async () => {
    const queryClient = seedQueryClient();
    const fetchMock = vi.fn().mockResolvedValue(
      conflictResponse(
        [
          {
            id: "cheese-1",
            name: "Canonical Cheese",
            brand: "",
            flavors: [],
            shredderSetting: "3",
            cellulose: "",
            notes: "",
            components: [{ ingredient: "Mozzarella", lbs: 10 }],
            enabled: true,
            updatedAt: "2026-09-09T12:00:00.000Z",
          },
        ],
        ["cheese-1"],
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveCheeseRecipes([
        {
          id: "cheese-1",
          name: "Stale Cheese",
          brand: "",
          flavors: [],
          shredderSetting: "3",
          cellulose: "",
          notes: "",
          components: [{ ingredient: "Mozzarella", lbs: 5 }],
          enabled: true,
          updatedAt: "2026-09-09T11:00:00.000Z",
        },
      ]),
    ).rejects.toBeInstanceOf(StaleCheeseRecipeSnapshotError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<MasterDataBootstrap>(MASTER_DATA_QUERY_KEY)?.cheeseRecipes).toEqual([
      {
        id: "cheese-1",
        name: "Canonical Cheese",
        brand: "",
        flavors: [],
        shredderSetting: "3",
        cellulose: "",
        notes: "",
        components: [{ ingredient: "Mozzarella", lbs: 10 }],
        enabled: true,
        updatedAt: "2026-09-09T12:00:00.000Z",
      },
    ]);
  });

  it.each(["dough", "sauce"] as const)(
    "adopts the authoritative %s pool and never retries a stale write",
    async (kind) => {
      const queryClient = seedQueryClient();
      const canonicalItems = [
        {
          id: `${kind}-1`,
          name: `Canonical ${kind}`,
          notes: "",
          components: [{ ingredient: "Flour", lbs: 10 }],
          enabled: true,
          brand: "",
          flavors: [],
          updatedAt: "2026-09-09T12:00:00.000Z",
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue(conflictResponse(canonicalItems, [`${kind}-1`]));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        saveNamedRecipes(kind, [
          {
            id: `${kind}-1`,
            name: `Stale ${kind}`,
            notes: "",
            components: [{ ingredient: "Flour", lbs: 5 }],
            enabled: true,
            brand: "",
            flavors: [],
            updatedAt: "2026-09-09T11:00:00.000Z",
          },
        ]),
      ).rejects.toBeInstanceOf(StaleNamedRecipeSnapshotError);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        queryClient.getQueryData<MasterDataBootstrap>(MASTER_DATA_QUERY_KEY)?.[
          kind === "dough" ? "doughRecipes" : "sauceRecipes"
        ],
      ).toEqual(canonicalItems);
    },
  );
});