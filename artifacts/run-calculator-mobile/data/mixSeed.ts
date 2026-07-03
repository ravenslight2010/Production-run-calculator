import type { RecipeRow } from "@/context/RunContext";

export type MixProfile = {
  brand: string;
  flavor: string;
  recipeName: string;
  recipe: RecipeRow[];
};

// Factory mix seed data intentionally EMPTIED (2026-07-03 full data purge):
// the app ships with no built-in brands/flavors/mix data; the user imports
// their own spec sheets. Export shape kept so consumers still compile.
export const MIX_SEED: {
  brands: string[];
  brandFlavors: Record<string, string[]>;
  frontlineRecipeNames: string[];
  frontlineIngredients: string[];
  frontlineRecipePresets: Record<string, RecipeRow[]>;
  mixRecipeNames: string[];
  profiles: MixProfile[];
} = {
  brands: [],
  brandFlavors: {},
  frontlineRecipeNames: [],
  frontlineIngredients: [],
  frontlineRecipePresets: {},
  mixRecipeNames: [],
  profiles: [],
};
