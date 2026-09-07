import {
  refreshProfilesFromNamedRecipes,
  type NamedRecipePoolPatch,
} from "./storage";

export type ProfileRecipeRefreshTarget = { brand: string; flavor: string };

/**
 * Refresh linked dough/sauce profiles and immediately fan each distinct
 * profile into pending run snapshots. Keeping both operations behind one
 * function prevents the initial pool hydration path from updating profiles
 * while leaving already-scheduled runs stale.
 */
export function refreshNamedRecipeProfilesAndPropagate(
  kind: "dough" | "sauce",
  patches: ReadonlyArray<NamedRecipePoolPatch>,
  opts: { emptyRowsOnly?: boolean } | undefined,
  onProfileSaved: (brand: string, flavor: string) => void,
): ProfileRecipeRefreshTarget[] {
  const touched = refreshProfilesFromNamedRecipes(kind, patches, opts);
  const seen = new Set<string>();
  for (const profile of touched) {
    const key = `${profile.brand.trim().toLowerCase()}__${profile.flavor.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    onProfileSaved(profile.brand, profile.flavor);
  }
  return touched;
}