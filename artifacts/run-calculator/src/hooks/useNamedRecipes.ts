import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type NamedRecipeKind } from "../namedRecipes";
import {
  fetchMasterDataBootstrap,
  MASTER_DATA_QUERY_KEY,
  MASTER_DATA_STALE_TIME_MS,
  useMasterDataSlice,
} from "../masterData";
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
  hasData: boolean;
  isStale: boolean;
  ensureLoaded: () => Promise<NamedRecipe[]>;
} {
  const queryClient = useQueryClient();
  const { data, isPending, isStale } = useMasterDataSlice(
    kind === "dough" ? "doughRecipes" : "sauceRecipes",
  );
  const ensureLoaded = useCallback(async () => {
    const bootstrap = await queryClient.fetchQuery({
      queryKey: MASTER_DATA_QUERY_KEY,
      queryFn: fetchMasterDataBootstrap,
      staleTime: MASTER_DATA_STALE_TIME_MS,
      retry: false,
    });
    return kind === "dough" ? bootstrap.doughRecipes : bootstrap.sauceRecipes;
  }, [kind, queryClient]);
  return {
    items: data ?? [],
    isLoading: isPending,
    hasData: data !== undefined,
    isStale,
    ensureLoaded,
  };
}
