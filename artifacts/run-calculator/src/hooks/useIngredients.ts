import { useMasterDataSlice } from "../masterData";
import type { Ingredient } from "@workspace/ingredient-catalog";

// Factory-wide ingredient catalog, shared by every recipe surface and the
// Manage Lists ingredient pickers. Polls in the background so a rename/merge/
// delete a manager makes on one device shows up for the floor without a manual
// refresh. Open to everyone signed in (the GET endpoint is requireAuth, not
// manager-gated) because every app needs it to resolve recipe rows and build
// pickers.
//
export function useIngredients(): {
  items: Ingredient[];
  isLoading: boolean;
} {
  const { data, isLoading } = useMasterDataSlice("ingredients");
  return { items: data ?? [], isLoading };
}
