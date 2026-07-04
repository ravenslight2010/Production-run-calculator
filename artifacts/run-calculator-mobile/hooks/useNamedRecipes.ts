import { useQuery } from "@tanstack/react-query";
import type { NamedRecipe } from "@workspace/named-recipes";
import { fetchNamedRecipes, type NamedRecipeKind } from "../context/namedRecipes";

// Factory-wide dough / sauce recipes, shared by the manager management UI and the
// run form's Dough / Sauce cards (which pick one and hydrate their rows from it).
// Mirrors the web hook (replit.md parity). Open to everyone signed in (the GET
// endpoint is requireAuth, not manager-gated) because every app needs the pool to
// pick from. Polls in the background so a recipe a manager adds on one device
// shows up for the floor without a manual refresh.
export function useNamedRecipes(kind: NamedRecipeKind): {
  items: NamedRecipe[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: [kind === "dough" ? "doughRecipes" : "sauceRecipes"],
    queryFn: () => fetchNamedRecipes(kind),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { items: data ?? [], isLoading };
}
