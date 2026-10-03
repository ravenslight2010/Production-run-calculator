import {
  isRunRecipeRefreshEligible,
  deepEqual,
  recipeRowsEqual,
  refreshProfilesFromNamedRecipes,
  type NamedRecipePoolPatch,
} from "./storage";
import type { RunMeta } from "./types";

export type ProfileRecipeRefreshTarget = { brand: string; flavor: string };

export type SharedRecipeRefreshRun = Pick<RunMeta, "id" | "startedAt" | "pausedAt" | "endedAt">;

/**
 * A named-pool edit may refresh a run only while its rows still represent the
 * previous canonical recipe. If that prior signature is unavailable, allow
 * profile-backed runs to rely on profile fan-out, but fail closed for
 * unprofiled runs that may contain intentional row customizations.
 */
export function shouldPropagateNamedRecipeRows(
  currentRows: ReadonlyArray<{ ingredient: string; lbs: number }>,
  previousPoolSignature: string | undefined,
  hasProfileIdentity: boolean,
): boolean {
  if (previousPoolSignature) {
    try {
      const previous = JSON.parse(previousPoolSignature) as {
        rows?: unknown;
      };
      if (
        Array.isArray(previous.rows)
        && previous.rows.every(
          (row) =>
            typeof row === "object"
            && row !== null
            && typeof (row as { ingredient?: unknown }).ingredient === "string"
            && typeof (row as { lbs?: unknown }).lbs === "number",
        )
      ) {
        return recipeRowsEqual(
          currentRows,
          previous.rows as Array<{ ingredient: string; lbs: number }>,
        );
      }
    } catch {
      // Treat malformed/legacy signatures like a missing previous snapshot.
    }
  }
  return hasProfileIdentity;
}

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
 * Apply a targeted shared-refresh patch to a pending run snapshot without
 * replacing unrelated values from a possibly stale profile/form snapshot.
 */
export function mergePendingRunSnapshotUpdates<T extends Record<string, unknown>>(
  run: SharedRecipeRefreshRun | undefined,
  currentValues: T,
  updates: Partial<T>,
): T | undefined {
  if (!isSharedRecipeRefreshEligible(run)) return undefined;
  let next: T | undefined;
  for (const [field, value] of Object.entries(updates)) {
    if (deepEqual(currentValues[field], value)) continue;
    if (!next) next = { ...currentValues };
    (next as Record<string, unknown>)[field] = value;
  }
  return next;
}

/** Build a targeted mix-row patch for the applicator slots linked by name. */
export function buildMixRunSnapshotUpdates(
  currentValues: Record<string, unknown>,
  recipeName: string,
  rows: ReadonlyArray<{ ingredient: string; lbs: number }>,
): Record<string, unknown> {
  const name = recipeName.trim().toLowerCase();
  if (!name || rows.length === 0) return {};
  const updates: Record<string, unknown> = {};
  for (const slot of [1, 2, 3, 4] as const) {
    const nameField = `app${slot}CheeseRecipeName`;
    if (String(currentValues[`app${slot}Type`] ?? "").trim().toLowerCase() !== "mix") continue;
    if (String(currentValues[nameField] ?? "").trim().toLowerCase() !== name) continue;
    updates[`app${slot}CheeseRecipe`] = rows.map((row) => ({
      ingredient: row.ingredient,
      lbs: row.lbs,
    }));
  }
  return updates;
}

/**
 * Shared orchestration for recipe-pool edits. The profile fan-out completes
 * before the open form is considered, matching the existing cheese/mix and
 * dough/sauce behavior while keeping the eligibility contract in one place.
 */
export async function orchestrateSharedRecipeRefresh<T>(
  opts: {
    getCurrentRun: () => SharedRecipeRefreshRun | undefined;
    initiatingRunId?: string;
    refreshProfiles: () => T | PromiseLike<T>;
    refreshOpenForm: () => void | PromiseLike<void>;
  },
): Promise<T> {
  // Some callers must do asynchronous preparation before invoking the
  // orchestrator. Preserve the identity from when that work was initiated,
  // rather than treating whichever run is selected afterward as the owner.
  const refreshStartedForRunId =
    opts.initiatingRunId ?? opts.getCurrentRun()?.id;
  const result = await opts.refreshProfiles();
  const currentRun = opts.getCurrentRun();
  if (currentRun?.id !== refreshStartedForRunId) return result;
  if (isSharedRecipeRefreshEligible(currentRun)) {
    await opts.refreshOpenForm();
  }
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
  onProfileSaved: (brand: string, flavor: string) => void | PromiseLike<void>,
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