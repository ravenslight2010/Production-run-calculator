import { useMasterDataSlice } from "../masterData";
import type { CheeseRecipe } from "@workspace/cheese-recipes";

// Factory-wide cheese recipes, shared by the manager management UI and the run
// applicator "Cheese" cards (which pick one and hydrate their rows from it).
// Polls in the background so a recipe a manager adds on one device shows up for
// the floor without a manual refresh. Open to everyone signed in (the GET
// endpoint is requireAuth, not manager-gated). Mirrors useMixes.
//
export function useCheeseRecipes(): {
  items: CheeseRecipe[];
  isLoading: boolean;
} {
  const { data, isLoading } = useMasterDataSlice("cheeseRecipes");
  return { items: data ?? [], isLoading };
}
