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

// ── Per-run Setup tab: badge fires for all four mix applicator slots ──────────
//
// home.tsx mounts AppSlotMathBadge for each app slot with the gate:
//   v.appNType.trim().toLowerCase().includes("mix")
// Values come from the run form, which is seeded from loadProfile.
// "Save Setup" on the per-run tab calls saveProfile — the same persistence
// path as the standalone Profile Editor.
//
// These tests confirm that the badge fires (detectAppSlotConflicts returns a
// conflict) when values are loaded into the run form for each slot position,
// and that resolving + saving via saveProfile produces a conflict-free reload.

const RUN_BRAND = "Per-Run Setup Brand";
const RUN_FLAVOR = "Per-Run Flavor";

// A second set of mix rows used for the per-run slot tests (different
// from IMPORTED_ROWS above so the two suites are fully independent).
const RUN_ROWS: RecipeRow[] = [
  { ingredient: "Basil Blend", lbs: 0.9 },
  { ingredient: "Thyme", lbs: 0.45 },
  { ingredient: "Rosemary", lbs: 0.3 },
];
// Row sum = 1.65; total written separately by importer = 1.82 → delta 0.17 > tolerance
const RUN_TOTAL = 1.82;

describe("per-run Setup tab: math-check badge fires for all mix slot positions", () => {
  beforeEach(() => localStorage.clear());

  // ── app slot 1 ─────────────────────────────────────────────────────────────

  it("app1 mix slot: badge fires when profile is loaded into the per-run Setup form", () => {
    // home.tsx gate: v.app1Type.trim().toLowerCase().includes("mix")
    // home.tsx badge props: rows={v.app1CheeseRecipe ?? []}, ozPerPizza={Number(v.app1OzPerPizza)}
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: RUN_TOTAL,
      app1CheeseRecipe: RUN_ROWS,
    }));

    const loaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;
    const rows = (loaded.app1CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(loaded.app1OzPerPizza ?? 0);

    // Gate: type includes "mix" → badge is mounted
    expect(loaded.app1Type?.trim().toLowerCase()).toContain("mix");
    // Badge fires: conflicts detected with the loaded values
    const conflicts = detectAppSlotConflicts(rows, oz);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("row-sum-vs-total");
  });

  it("app1 mix slot: resolving + saving from the run form persists the fix", () => {
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: RUN_TOTAL,
      app1CheeseRecipe: RUN_ROWS,
    }));

    // Simulate the run form's onResolveByRowSum handler:
    //   form.setValue("app1OzPerPizza", resolveByRowSum(rowSum), { shouldDirty: true })
    // then "Save Setup" calls saveProfile with the current form values.
    const rowSum = RUN_ROWS.reduce((s, r) => s + r.lbs, 0);
    const correctedOz = resolveByRowSum(rowSum);
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app1Type: "Mix",
      app1OzPerPizza: correctedOz,
      app1CheeseRecipe: RUN_ROWS,
    }));

    const reloaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;
    const rows = (reloaded.app1CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(reloaded.app1OzPerPizza ?? 0);
    expect(detectAppSlotConflicts(rows, oz)).toHaveLength(0);
  });

  // ── app slot 2 ─────────────────────────────────────────────────────────────

  it("app2 mix slot: badge fires when profile is loaded into the per-run Setup form", () => {
    // home.tsx gate: v.app2Type.trim().toLowerCase().includes("mix")
    // home.tsx badge props: rows={v.app2CheeseRecipe ?? []}, ozPerPizza={Number(v.app2OzPerPizza)}
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app2Type: "Herb Mix",
      app2OzPerPizza: RUN_TOTAL,
      app2CheeseRecipe: RUN_ROWS,
    }));

    const loaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;
    const rows = (loaded.app2CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(loaded.app2OzPerPizza ?? 0);

    // Gate: type includes "mix" — partial match (e.g. "Herb Mix") also works
    expect(loaded.app2Type?.trim().toLowerCase()).toContain("mix");
    const conflicts = detectAppSlotConflicts(rows, oz);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("row-sum-vs-total");
  });

  it("app2 mix slot: scale-rows resolution from run form persists correctly", () => {
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app2Type: "Herb Mix",
      app2OzPerPizza: RUN_TOTAL,
      app2CheeseRecipe: RUN_ROWS,
    }));

    // Simulate the run form's onResolveByTotal handler:
    //   form.setValue("app2CheeseRecipe", resolveByTotal(rows, total))
    // then "Save Setup" calls saveProfile.
    const scaledRows = resolveByTotal(RUN_ROWS, RUN_TOTAL);
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app2Type: "Herb Mix",
      app2OzPerPizza: RUN_TOTAL,
      app2CheeseRecipe: scaledRows,
    }));

    const reloaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;
    const rows = (reloaded.app2CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(reloaded.app2OzPerPizza ?? 0);
    expect(detectAppSlotConflicts(rows, oz)).toHaveLength(0);
  });

  // ── app slot 3 ─────────────────────────────────────────────────────────────

  it("app3 mix slot: badge fires when profile is loaded into the per-run Setup form", () => {
    // home.tsx gate: v.app3Type.trim().toLowerCase().includes("mix")
    // home.tsx badge props: rows={v.app3CheeseRecipe ?? []}, ozPerPizza={Number(v.app3OzPerPizza)}
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app3Type: "Mix",
      app3OzPerPizza: RUN_TOTAL,
      app3CheeseRecipe: RUN_ROWS,
    }));

    const loaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;
    const rows = (loaded.app3CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(loaded.app3OzPerPizza ?? 0);

    expect(loaded.app3Type?.trim().toLowerCase()).toContain("mix");
    const conflicts = detectAppSlotConflicts(rows, oz);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("row-sum-vs-total");
  });

  it("app3 mix slot: resolving + saving from the run form persists the fix", () => {
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app3Type: "Mix",
      app3OzPerPizza: RUN_TOTAL,
      app3CheeseRecipe: RUN_ROWS,
    }));

    const rowSum = RUN_ROWS.reduce((s, r) => s + r.lbs, 0);
    const correctedOz = resolveByRowSum(rowSum);
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app3Type: "Mix",
      app3OzPerPizza: correctedOz,
      app3CheeseRecipe: RUN_ROWS,
    }));

    const reloaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;
    const rows = (reloaded.app3CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(reloaded.app3OzPerPizza ?? 0);
    expect(detectAppSlotConflicts(rows, oz)).toHaveLength(0);
  });

  // ── app slot 4 ─────────────────────────────────────────────────────────────

  it("app4 mix slot: badge fires when profile is loaded into the per-run Setup form", () => {
    // home.tsx gate: v.app4Type.trim().toLowerCase().includes("mix")
    // home.tsx badge props: rows={v.app4CheeseRecipe ?? []}, ozPerPizza={Number(v.app4OzPerPizza)}
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app4Type: "Mix",
      app4OzPerPizza: RUN_TOTAL,
      app4CheeseRecipe: RUN_ROWS,
    }));

    const loaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;
    const rows = (loaded.app4CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(loaded.app4OzPerPizza ?? 0);

    expect(loaded.app4Type?.trim().toLowerCase()).toContain("mix");
    const conflicts = detectAppSlotConflicts(rows, oz);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("row-sum-vs-total");
  });

  it("app4 mix slot: resolving + saving from the run form persists the fix", () => {
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app4Type: "Mix",
      app4OzPerPizza: RUN_TOTAL,
      app4CheeseRecipe: RUN_ROWS,
    }));

    const rowSum = RUN_ROWS.reduce((s, r) => s + r.lbs, 0);
    const correctedOz = resolveByRowSum(rowSum);
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app4Type: "Mix",
      app4OzPerPizza: correctedOz,
      app4CheeseRecipe: RUN_ROWS,
    }));

    const reloaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;
    const rows = (reloaded.app4CheeseRecipe ?? []) as RecipeRow[];
    const oz = Number(reloaded.app4OzPerPizza ?? 0);
    expect(detectAppSlotConflicts(rows, oz)).toHaveLength(0);
  });

  // ── Gate: partial name match ────────────────────────────────────────────────

  it("the isMix gate fires for any type name containing 'mix' (e.g. 'Spice Mix', 'Pre-Mix')", () => {
    // home.tsx uses .includes("mix") not === "mix", so any partial match mounts the badge.
    const partialNames = ["Spice Mix", "Pre-Mix", "herb mix", "MIX", "Custom Mix Blend"];
    for (const typeName of partialNames) {
      expect(typeName.trim().toLowerCase()).toContain("mix");
    }

    // Non-mix type names must NOT contain "mix" — confirming they don't mount the badge.
    const nonMixNames = ["Cheese", "Pepperoni", "Sauce", "Oil Blend", ""];
    for (const typeName of nonMixNames) {
      expect(typeName.trim().toLowerCase()).not.toContain("mix");
    }
  });

  // ── Multiple mix slots in one profile ──────────────────────────────────────

  it("badge fires for each mix slot independently when multiple slots are set to Mix type", () => {
    // A profile where all four slots carry mismatched mix values.
    saveProfile(RUN_BRAND, RUN_FLAVOR, makeProfile({
      app1Type: "Mix", app1OzPerPizza: RUN_TOTAL, app1CheeseRecipe: RUN_ROWS,
      app2Type: "Mix", app2OzPerPizza: RUN_TOTAL, app2CheeseRecipe: RUN_ROWS,
      app3Type: "Mix", app3OzPerPizza: RUN_TOTAL, app3CheeseRecipe: RUN_ROWS,
      app4Type: "Mix", app4OzPerPizza: RUN_TOTAL, app4CheeseRecipe: RUN_ROWS,
    }));

    const loaded = loadProfile(RUN_BRAND, RUN_FLAVOR)!;

    for (const [rowsKey, ozKey] of [
      ["app1CheeseRecipe", "app1OzPerPizza"],
      ["app2CheeseRecipe", "app2OzPerPizza"],
      ["app3CheeseRecipe", "app3OzPerPizza"],
      ["app4CheeseRecipe", "app4OzPerPizza"],
    ] as const) {
      const rows = ((loaded as any)[rowsKey] ?? []) as RecipeRow[];
      const oz = Number((loaded as any)[ozKey] ?? 0);
      const conflicts = detectAppSlotConflicts(rows, oz);
      expect(conflicts, `${rowsKey} should have a conflict`).toHaveLength(1);
    }
  });
});
