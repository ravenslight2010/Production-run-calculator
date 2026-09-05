import { type NamedRecipeKind } from "../namedRecipes";
import { useMasterDataSlice } from "../masterData";
import type { NamedRecipe } from "@workspace/named-recipes";

// Factory-wide dough / sauce recipes, shared by the manager management UI and
// the run form's Dough / Sauce cards (which pick one and hydrate their rows from
// it). Polls in the background so a recipe a manager adds on one device shows up
// for the floor without a manual refresh. Open to everyone signed in (the GET
// endpoint is requireAuth, not manager-gated). Mirrors useCheeseRecipes.
//
export function useNamedRecipes(kind: NamedRecipeKind): {
  items: NamedRecipe[];
  isLoading: boolean;
} {
  const { data, isLoading } = useMasterDataSlice(
    kind === "dough" ? "doughRecipes" : "sauceRecipes",
  );
  return { items: data ?? [], isLoading };
}
