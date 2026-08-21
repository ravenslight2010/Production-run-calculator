import {
  applySubstitutions,
  type IngredientSubstitution,
} from "@workspace/inventory-math";

// Module-level "active substitutions" overlay. The web app has many call sites
// that run the shared calc/consumption engine (calc useMemo, warehouse roll-up,
// consumeRun on every run-finalization path, schedule/history totals). Rather
// than thread today's substitutions through each one, home.tsx mirrors
// dayState.substitutions here and the thin wrappers in utils.ts /
// inventoryShared.ts overlay them onto `vals` BEFORE the shared math runs. This
// guarantees the overlay reaches material totals AND inventory consumption keys
// for ALL of today's runs, in lockstep with the shared (web+mobile) engine.
//
// Overlay only: applySubstitutions returns a clone, so stored run values and the
// editable form arrays are never mutated.
let active: IngredientSubstitution[] = [];

export function setActiveSubstitutions(subs: IngredientSubstitution[] | undefined): void {
  active = subs ?? [];
}

export function getActiveSubstitutions(): IngredientSubstitution[] {
  return active;
}

export function withSubstitutions<T extends Record<string, unknown>>(vals: T): T {
  return active.length ? (applySubstitutions(vals, active) as T) : vals;
}

/** Apply the day-state overlay only to values belonging to today's runs. */
export function withTodaySubstitutions<T extends Record<string, unknown>>(
  vals: T,
  isToday: boolean,
  substitutions: IngredientSubstitution[] | undefined,
): T {
  return isToday ? (applySubstitutions(vals, substitutions ?? []) as T) : vals;
}
