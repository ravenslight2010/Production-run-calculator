import { useQuery } from "@tanstack/react-query";
import { fetchCheeseRecipes } from "../cheeseRecipes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";

// Factory-wide cheese recipes, shared by the manager management UI and the run
// applicator "Cheese" cards (which pick one and hydrate their rows from it).
// Polls in the background so a recipe a manager adds on one device shows up for
// the floor without a manual refresh. Open to everyone signed in (the GET
// endpoint is requireAuth, not manager-gated) because every app needs the pool
// to pick from. Mirrors useMixes.
export function useCheeseRecipes(): {
  items: CheeseRecipe[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ["cheeseRecipes"],
    queryFn: fetchCheeseRecipes,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { items: data ?? [], isLoading };
}
