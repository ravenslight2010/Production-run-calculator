import { normalizeIngredient, type Ingredient } from "@workspace/ingredient-catalog";
import { normalizeNamedRecipes, type NamedRecipe } from "@workspace/named-recipes";
import { normalizeCheeseRecipes, type CheeseRecipe } from "@workspace/cheese-recipes";
import { normalizeMixes, type Mix } from "@workspace/mixes";
import { inventoryClientId } from "./inventoryShared";

export type MasterDataBootstrap = {
  ingredients: Ingredient[];
  doughRecipes: NamedRecipe[];
  sauceRecipes: NamedRecipe[];
  cheeseRecipes: CheeseRecipe[];
  mixes: Mix[];
};

function normalizeList<T>(items: unknown, normalize: (item: unknown) => T | null): T[] {
  return Array.isArray(items)
    ? items.map(normalize).filter((item): item is T => item !== null)
    : [];
}

let inFlight: Promise<MasterDataBootstrap> | null = null;

export function fetchMasterDataBootstrap(): Promise<MasterDataBootstrap> {
  if (inFlight) return inFlight;
  inFlight = fetch("/api/master-data/bootstrap", {
    headers: { "x-client-id": inventoryClientId() },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Load master data failed (${res.status})`);
    const data = await res.json() as Record<string, unknown>;
    return {
      ingredients: normalizeList(data.ingredients, normalizeIngredient),
      doughRecipes: normalizeNamedRecipes(data.doughRecipes),
      sauceRecipes: normalizeNamedRecipes(data.sauceRecipes),
      cheeseRecipes: normalizeCheeseRecipes(data.cheeseRecipes),
      mixes: normalizeMixes(data.mixes),
    };
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}