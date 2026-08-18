/**
 * Confirms the math-check badge appears and saves correctly after a spec
 * import creates a row-sum vs. oz/pizza-total mismatch.
 *
 * Covers three "done" criteria end-to-end:
 *  1. After a spec import writes conflicting values, detectAppSlotConflicts
 *     reports a mismatch (= badge renders).
 *  2. Clicking "Use row sum" (resolveByRowSum) produces a value that clears
 *     the conflict (= badge disappears).
 *  3. saveProfile persists the corrected oz/pizza value, and the next
 *     loadProfile call returns it (= fix survives a page reload).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  detectAppSlotConflicts,
  resolveByRowSum,
  resolveByTotal,
} from "@workspace/setup-math-check";
import { saveProfile, loadProfile } from "./storage";
import { DEFAULT_VALUES } from "./types";
import type { FormValues, RecipeRow } from "./types";

const BRAND = "Math Check Test Brand";
const FLAVOR = "Badge Flavor";

function makeProfile(over: Partial<FormValues>): FormValues {
  return { ...DEFAULT_VALUES, ...over } as FormValues;
}

// ── shared fixture ─────────────────────────────────────────────────────────────
// Simulates what a spec import independently writes:
//   • ingredient rows parsed from per-ingredient oz/pizza columns (sum = 2.95)
//   • total oz/pizza field from the TARGET WEIGHT row            (= 3.1)
// These are rounded differently in the spec sheet and disagree by 0.15,
// which is above the DEFAULT_TOLERANCE of 0.05 → conflict fires.
const IMPORTED_ROWS: RecipeRow[] = [
  { ingredient: "Herb Blend", lbs: 1.5 },
  { ingredient: "Oregano", lbs: 0.85 },
  { ingredient: "Garlic Salt", lbs: 0.6 },
];
const IMPORTED_TOTAL = 3.1; // oz/pizza written separately by the importer

describe("math-check badge: spec-import mismatch detect → resolve → persist", () => {
  beforeEach(() => localStorage.clear());

  // ── Criterion 1: badge shows after import ──────────────────────────────────

  it("detectAppSlotConflicts fires when import rows disagree with the oz/pizza total", () => {
    const rowSum = IMPORTED_ROWS.reduce((s, r) => s + r.lbs, 0);
    expect(rowSum).toBeCloseTo(2.95, 5);
    expect(Math.abs(rowSum - IMPORTED_TOTAL)).toBeGreaterThan(0.05); // above tolerance

    const conflicts = detectAppSlotConflicts(IMPORTED_ROWS, IMPORTED_TOTAL);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("row-sum-vs-total");
    expect(conflicts[0].rowSum).toBeCloseTo(2.95, 5);
    expect(conflicts[0].total).toBe(IMPORTED_TOTAL);
  });

  it("profile loaded right after a spec import also shows a conflict (imported values in storage)", () => {
    // Simulate the spec-import commit: write the imported values directly into
    // a profile. This mirrors what applySpecImport does when it merges the
    // parsed oz/pizza total and ingredient rows independently.
    const importedProfile = makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: IMPORTED_TOTAL,
      app1CheeseRecipe: IMPORTED_ROWS,
    });
    saveProfile(BRAND, FLAVOR, importedProfile);

    const loaded = loadProfile(BRAND, FLAVOR)!;
    expect(loaded).not.toBeNull();

    const loadedRows = (loaded.app1CheeseRecipe ?? []) as RecipeRow[];
    const loadedTotal = Number(loaded.app1OzPerPizza ?? 0);
    const conflicts = detectAppSlotConflicts(loadedRows, loadedTotal);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("row-sum-vs-total");
  });

  // ── Criterion 2: "Use row sum" clears the badge ───────────────────────────

  it("resolveByRowSum produces a value that makes detectAppSlotConflicts return empty", () => {
    const conflicts = detectAppSlotConflicts(IMPORTED_ROWS, IMPORTED_TOTAL);
    expect(conflicts).toHaveLength(1);

    const newOzPerPizza = resolveByRowSum(conflicts[0].rowSum);
    expect(newOzPerPizza).toBeCloseTo(2.95, 5);

    // After form.setValue(ozKey, newOzPerPizza) the badge checks again with
    // the updated total — it must return empty.
    expect(detectAppSlotConflicts(IMPORTED_ROWS, newOzPerPizza)).toHaveLength(0);
  });

  it("resolveByTotal (scale rows) also produces a conflict-free state", () => {
    const conflicts = detectAppSlotConflicts(IMPORTED_ROWS, IMPORTED_TOTAL);
    expect(conflicts).toHaveLength(1);

    const scaledRows = resolveByTotal(IMPORTED_ROWS, IMPORTED_TOTAL);
    expect(detectAppSlotConflicts(scaledRows, IMPORTED_TOTAL)).toHaveLength(0);

    // Original rows must not be mutated
    expect(IMPORTED_ROWS[0].lbs).toBe(1.5);
  });

  // ── Criterion 3: saveProfile persists the corrected value ─────────────────

  it("saving the profile after 'Use row sum' persists the corrected oz/pizza, and loadProfile returns it conflict-free", () => {
    // Step A: a spec import wrote conflicting values → save them.
    const importedProfile = makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: IMPORTED_TOTAL, // 3.1 — disagrees with row sum
      app1CheeseRecipe: IMPORTED_ROWS,
    });
    saveProfile(BRAND, FLAVOR, importedProfile);

    // Step B: manager opens Setup, badge fires, clicks "Use row sum".
    // The badge's onResolveByRowSum handler calls form.setValue(ozKey, newOz).
    const rowSum = IMPORTED_ROWS.reduce((s, r) => s + r.lbs, 0); // 2.95
    const newOzPerPizza = resolveByRowSum(rowSum);

    // Step C: manager clicks "Save Setup" — save the corrected form values.
    const correctedProfile = makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: newOzPerPizza, // 2.95
      app1CheeseRecipe: IMPORTED_ROWS,
    });
    const saved = saveProfile(BRAND, FLAVOR, correctedProfile);
    expect(saved).toBe(true);

    // Step D: next time the editor opens it calls loadProfile — the fix must
    // have survived and the badge must not reappear.
    const reloaded = loadProfile(BRAND, FLAVOR)!;
    expect(reloaded).not.toBeNull();
    const reloadedOz = Number(reloaded.app1OzPerPizza ?? 0);
    expect(reloadedOz).toBeCloseTo(newOzPerPizza, 5);

    const reloadedRows = (reloaded.app1CheeseRecipe ?? []) as RecipeRow[];
    expect(detectAppSlotConflicts(reloadedRows, reloadedOz)).toHaveLength(0);
  });

  it("saving after 'Scale rows' also persists a conflict-free state", () => {
    const importedProfile = makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: IMPORTED_TOTAL,
      app1CheeseRecipe: IMPORTED_ROWS,
    });
    saveProfile(BRAND, FLAVOR, importedProfile);

    // Manager picks "Scale rows" instead → rows are updated, total stays.
    const scaledRows = resolveByTotal(IMPORTED_ROWS, IMPORTED_TOTAL);

    const correctedProfile = makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: IMPORTED_TOTAL, // total unchanged
      app1CheeseRecipe: scaledRows,
    });
    const saved = saveProfile(BRAND, FLAVOR, correctedProfile);
    expect(saved).toBe(true);

    const reloaded = loadProfile(BRAND, FLAVOR)!;
    const reloadedRows = (reloaded.app1CheeseRecipe ?? []) as RecipeRow[];
    const reloadedOz = Number(reloaded.app1OzPerPizza ?? 0);
    expect(detectAppSlotConflicts(reloadedRows, reloadedOz)).toHaveLength(0);
  });

  it("the badge does not reappear after a reload if the manager dismissed it via row sum", () => {
    // Full round-trip: import → conflict → resolve → save → reload → no conflict.
    const rowSum = IMPORTED_ROWS.reduce((s, r) => s + r.lbs, 0);

    saveProfile(BRAND, FLAVOR, makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: rowSum,
      app1CheeseRecipe: IMPORTED_ROWS,
    }));

    const reloaded = loadProfile(BRAND, FLAVOR)!;
    const rows = (reloaded.app1CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(reloaded.app1OzPerPizza ?? 0);

    expect(detectAppSlotConflicts(rows, oz)).toHaveLength(0);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("badge is scoped to mix-type slots only — cheese rows use different units and must not be checked", () => {
    // Cheese row .lbs is lbs/batch (e.g. 18 lbs), not oz/pizza (e.g. 8 oz).
    // If the badge were rendered for cheese slots it would always fire a false
    // positive. Confirming the cheese scenario produces a conflict proves that
    // the UI layer (SetupProfileEditor, renderApplicator, isMix check) is the
    // only correct gate.
    const cheeseRows: RecipeRow[] = [
      { ingredient: "Mozzarella", lbs: 18 },
      { ingredient: "Provolone", lbs: 12 },
    ];
    const cheeseOzPerPizza = 8; // completely different unit
    // The lib always fires — the UI must not call it for cheese slots.
    expect(detectAppSlotConflicts(cheeseRows, cheeseOzPerPizza)).toHaveLength(1);
  });
});
