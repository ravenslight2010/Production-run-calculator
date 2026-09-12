import {
  isRunRecipeRefreshEligible,
  refreshProfilesFromNamedRecipes,
  type NamedRecipePoolPatch,
} from "./storage";
import type { RunMeta } from "./types";

export type ProfileRecipeRefreshTarget = { brand: string; flavor: string };

export type SharedRecipeRefreshRun = Pick<RunMeta, "id" | "startedAt" | "pausedAt" | "endedAt">;

/** One eligibility contract for pending-run and open-form shared edits. */
export function isSharedRecipeRefreshEligible(
  run: SharedRecipeRefreshRun | undefined,
): boolean {
  return isRunRecipeRefreshEligible(run);
}

/**
 * The shared-recipe snapshot boundary. Every recipe-family refresh must use
 * this guard before touching the open form: a pending run may adopt the
 * shared recipe, while a started, paused, or finished run keeps its snapshot.
 *
 * Profile fan-out is intentionally separate from this helper. Profiles and
 * future pending runs continue to receive shared edits; this only protects
 * the production form currently being viewed.
 */
export function runSharedRecipeRefresh<T>(
  run: SharedRecipeRefreshRun | undefined,
  refreshOpenForm: () => T,
): T | undefined {
  if (!isSharedRecipeRefreshEligible(run)) return undefined;
  return refreshOpenForm();
}

/**
 * Shared orchestration for recipe-pool edits. The profile fan-out completes
 * before the open form is considered, matching the existing cheese/mix and
 * dough/sauce behavior while keeping the eligibility contract in one place.
 */
export async function orchestrateSharedRecipeRefresh<T>(
  opts: {
    getCurrentRun: () => SharedRecipeRefreshRun | undefined;
    refreshProfiles: () => T | PromiseLike<T>;
    refreshOpenForm: () => void;
  },
): Promise<T> {
  const refreshStartedForRunId = opts.getCurrentRun()?.id;
  const result = await opts.refreshProfiles();
  const currentRun = opts.getCurrentRun();
  if (currentRun?.id !== refreshStartedForRunId) return result;
  runSharedRecipeRefresh(currentRun, opts.refreshOpenForm);
  return result;
}

/**
 * Refresh linked dough/sauce profiles and immediately fan each distinct
 * profile into pending run snapshots. Keeping both operations behind one
 * function prevents the initial pool hydration path from updating profiles
 * while leaving already-scheduled runs stale.
 */
export async function refreshNamedRecipeProfilesAndPropagate(
  kind: "dough" | "sauce",
  patches: ReadonlyArray<NamedRecipePoolPatch>,
  opts: { emptyRowsOnly?: boolean } | undefined,
  onProfileSaved: (brand: string, flavor: string) => void | Promise<void>,
): Promise<ProfileRecipeRefreshTarget[]> {
  const touched = refreshProfilesFromNamedRecipes(kind, patches, opts);
  const seen = new Set<string>();
  for (const profile of touched) {
    const key = `${profile.brand.trim().toLowerCase()}__${profile.flavor.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await onProfileSaved(profile.brand, profile.flavor);
  }
  return touched;
}