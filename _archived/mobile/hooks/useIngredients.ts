import { useQuery } from "@tanstack/react-query";
import type { Ingredient } from "@workspace/ingredient-catalog";
import { fetchIngredients } from "../context/ingredients";

// Factory-wide ingredient catalog (Task #102), shared by every recipe surface
// and the Manage Lists ingredient pickers. Mirrors the web hook (replit.md
// parity). Open to everyone signed in (the GET endpoint is requireAuth, not
// manager-gated) because every app needs it to resolve recipe rows and build
// pickers.
export function useIngredients(): {
  items: Ingredient[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ["ingredients"],
    queryFn: fetchIngredients,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { items: data ?? [], isLoading };
}
