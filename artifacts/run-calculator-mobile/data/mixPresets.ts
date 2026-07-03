import type { RecipeRow } from "@/context/RunContext";

export type MixPreset = {
  name: string;
  ingredients: RecipeRow[];
};

// Factory mix presets intentionally EMPTIED (2026-07-03 full data purge):
// the app ships with no built-in mixes; the user imports their own spec
// sheets. Export shapes kept so consumers still compile.
export const MIX_PRESETS: Record<string, MixPreset[]> = {};

export const SEED_MIX_PRESET_NAMES: string[] = [];

/** Return the mix presets for the given brand+flavor, or [] if no match. */
export function findMixPresets(brand: string, flavor: string): MixPreset[] {
  if (!brand && !flavor) return [];
  const query = norm(norm(brand) + " " + flavor);
  if (!query.trim()) return [];
  for (const [tabName, presets] of Object.entries(MIX_PRESETS)) {
    const tabNorm = norm(tabName);
    if (tabNorm === query || tabNorm.startsWith(query + " ")) {
      return presets;
    }
  }
  return [];
}

// Normalize helper: strip apostrophes/special chars, lowercase, collapse spaces
function norm(s: string): string {
  return s.toLowerCase().replace(/[\u2019'&]/g, "").replace(/\s+/g, " ").trim();
}
