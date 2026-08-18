/**
 * Tests for @workspace/setup-math-check
 *
 * Key invariant under test: the badge and detection logic must ONLY be used
 * for MIX-type applicator slots. Cheese applicator row .lbs values are
 * lbs/batch (blend component pounds), not oz/pizza — comparing them to the
 * oz/pizza total would be a unit mismatch. These tests document that contract
 * and verify the detection and resolution functions are correct for mix rows.
 */
import { describe, it, expect } from "vitest";
import {
  detectAppSlotConflicts,
  resolveByRowSum,
  resolveByTotal,
  detectMixComponentConflicts,
  resolveMixByPerPizza,
  resolveMixByPerBatchLbs,
  DEFAULT_TOLERANCE,
} from "./index";

// ── detectAppSlotConflicts ────────────────────────────────────────────────────

describe("detectAppSlotConflicts", () => {
  it("returns empty when no active rows exist", () => {
    const rows = [{ ingredient: "Mozzarella", lbs: 0 }];
    expect(detectAppSlotConflicts(rows, 3.0)).toEqual([]);
  });

  it("returns empty when ozPerPizza is 0", () => {
    const rows = [{ ingredient: "Herb Blend", lbs: 2.0 }];
    expect(detectAppSlotConflicts(rows, 0)).toEqual([]);
  });

  it("returns empty when row sum matches ozPerPizza within tolerance", () => {
    const rows = [
      { ingredient: "Basil", lbs: 1.5 },
      { ingredient: "Oregano", lbs: 1.5 },
    ];
    // sum = 3.0, total = 3.0 — exact match
    expect(detectAppSlotConflicts(rows, 3.0)).toEqual([]);
  });

  it("returns empty when difference is within default tolerance", () => {
    const rows = [
      { ingredient: "Basil", lbs: 1.5 },
      { ingredient: "Oregano", lbs: 1.53 },
    ];
    // sum = 3.03, total = 3.0, diff = 0.03 < 0.05
    expect(detectAppSlotConflicts(rows, 3.0)).toEqual([]);
  });

  it("detects row-sum-vs-total conflict for mix-style rows", () => {
    const rows = [
      { ingredient: "Basil", lbs: 1.5 },
      { ingredient: "Oregano", lbs: 1.85 },
    ];
    // sum = 3.35, total = 3.1, diff = 0.25 > 0.05
    const conflicts = detectAppSlotConflicts(rows, 3.1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("row-sum-vs-total");
    expect(conflicts[0].rowSum).toBeCloseTo(3.35, 5);
    expect(conflicts[0].total).toBe(3.1);
  });

  it("uses custom tolerance when provided", () => {
    const rows = [{ ingredient: "Garlic", lbs: 2.1 }];
    // diff = 0.1, default tolerance = 0.05 → conflict
    expect(detectAppSlotConflicts(rows, 2.0)).toHaveLength(1);
    // with tight tolerance = 0.05 still conflict
    expect(detectAppSlotConflicts(rows, 2.0, 0.05)).toHaveLength(1);
    // with loose tolerance = 0.2 → no conflict
    expect(detectAppSlotConflicts(rows, 2.0, 0.2)).toHaveLength(0);
  });

  /**
   * THIS IS THE CRITICAL TEST:
   * Cheese-type applicators store row.lbs as lbs/batch (e.g. 18 lbs of
   * mozzarella in a 40-lb cheese batch), while ozPerPizza is ~8 oz/pizza.
   * Comparing these would always produce a spurious conflict and corrupt
   * data if the manager "resolves" it.
   *
   * The badge/detector must ONLY be rendered for mix-type slots. This test
   * documents the unit semantics that make cheese slots incompatible.
   */
  it("would falsely flag a normal cheese slot — confirming badge must be mix-only", () => {
    // Realistic cheese blend: 18 lbs mozz + 12 lbs provolone + 10 lbs blend
    // total batch weight = 40 lbs. ozPerPizza = 8 oz/pizza.
    const cheeseRows = [
      { ingredient: "Mozzarella", lbs: 18 },
      { ingredient: "Provolone", lbs: 12 },
      { ingredient: "Blend", lbs: 10 },
    ];
    const cheeseOzPerPizza = 8;

    // Row sum = 40 (lbs/batch), total = 8 (oz/pizza) — completely different
    // units. The detector will report a conflict because 40 ≠ 8, but this
    // "conflict" is meaningless and resolving it would corrupt the setup.
    const conflicts = detectAppSlotConflicts(cheeseRows, cheeseOzPerPizza);
    expect(conflicts).toHaveLength(1); // confirms the false positive would fire

    // This test exists to document that the CALLER (the UI) is responsible for
    // only mounting the badge for mix-type slots, not cheese-type slots.
    // The lib itself cannot distinguish slot types — that's UI-layer knowledge.
  });
});

// ── resolveByRowSum ───────────────────────────────────────────────────────────

describe("resolveByRowSum", () => {
  it("returns the rowSum as the new ozPerPizza", () => {
    expect(resolveByRowSum(3.35)).toBe(3.35);
    expect(resolveByRowSum(0)).toBe(0);
  });
});

// ── resolveByTotal ────────────────────────────────────────────────────────────

describe("resolveByTotal", () => {
  it("scales rows so their sum equals the target total", () => {
    const rows = [
      { ingredient: "Basil", lbs: 1.5 },
      { ingredient: "Oregano", lbs: 1.85 },
    ];
    const total = 3.1;
    const scaled = resolveByTotal(rows, total);
    const newSum = scaled.reduce((s, r) => s + r.lbs, 0);
    expect(newSum).toBeCloseTo(total, 2);
  });

  it("preserves the original proportions between rows", () => {
    const rows = [
      { ingredient: "A", lbs: 1 },
      { ingredient: "B", lbs: 3 },
    ];
    const scaled = resolveByTotal(rows, 2);
    // A was 25% of sum, B was 75% — should stay that way
    expect(scaled[0].lbs / scaled[1].lbs).toBeCloseTo(1 / 3, 5);
  });

  it("returns rows unchanged when all lbs are 0", () => {
    const rows = [{ ingredient: "X", lbs: 0 }];
    expect(resolveByTotal(rows, 3.0)).toEqual(rows);
  });

  it("does not mutate the original rows", () => {
    const rows = [{ ingredient: "Basil", lbs: 1.5 }];
    const original = rows[0].lbs;
    resolveByTotal(rows, 2.0);
    expect(rows[0].lbs).toBe(original);
  });

  it("preserves extra fields on row objects", () => {
    const rows = [{ ingredient: "Garlic", lbs: 2.0, extra: "keep" }] as any[];
    const scaled = resolveByTotal(rows, 4.0);
    expect(scaled[0].extra).toBe("keep");
  });
});

// ── detectMixComponentConflicts ───────────────────────────────────────────────

describe("detectMixComponentConflicts", () => {
  it("returns empty when batchSize is 0 or negative", () => {
    const components = [{ ingredient: "Salt", perPizza: 0.5, perBatchLbs: 1.0 }];
    expect(detectMixComponentConflicts(components, 0)).toEqual([]);
    expect(detectMixComponentConflicts(components, -1)).toEqual([]);
  });

  it("returns empty when no component has both values set", () => {
    const components = [
      { ingredient: "Salt", perPizza: 0.5 }, // no perBatchLbs
      { ingredient: "Pepper", perPizza: 0, perBatchLbs: 1.0 }, // perPizza = 0
    ];
    expect(detectMixComponentConflicts(components, 5)).toEqual([]);
  });

  it("returns empty when all components agree within tolerance", () => {
    // batchSize = 5 lbs, total perPizza = 1.0 oz
    // Salt: 0.6 oz/pizza → 0.6/1.0 × 5 = 3.0 lbs/batch
    // Pepper: 0.4 oz/pizza → 0.4/1.0 × 5 = 2.0 lbs/batch
    const components = [
      { ingredient: "Salt", perPizza: 0.6, perBatchLbs: 3.0 },
      { ingredient: "Pepper", perPizza: 0.4, perBatchLbs: 2.0 },
    ];
    expect(detectMixComponentConflicts(components, 5)).toEqual([]);
  });

  it("detects conflict when perBatchLbs does not match perPizza share", () => {
    // batchSize = 5 lbs, total perPizza = 1.0
    // Salt: 0.6 oz/pizza → expected 3.0 lbs/batch, but entered 4.0
    const components = [
      { ingredient: "Salt", perPizza: 0.6, perBatchLbs: 4.0 }, // conflict
      { ingredient: "Pepper", perPizza: 0.4, perBatchLbs: 2.0 },
    ];
    const conflicts = detectMixComponentConflicts(components, 5);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].componentIdx).toBe(0);
    expect(conflicts[0].ingredient).toBe("Salt");
    expect(conflicts[0].perPizza).toBe(0.6);
    expect(conflicts[0].perBatchLbs).toBe(4.0);
    expect(conflicts[0].expectedPerBatchLbs).toBeCloseTo(3.0, 5);
  });

  it("skips components with perPizza = 0 or perBatchLbs = 0", () => {
    // A is skipped (perBatchLbs=0). B is skipped (perPizza=0).
    // Only C is checked. totalPerPizza = 0 + 0 + 0.5 = 0.5.
    // C's expectedPerBatchLbs = (0.5 / 0.5) × 5 = 5.0 → exact match → no conflict.
    const components = [
      { ingredient: "A", perPizza: 0, perBatchLbs: 0 },     // both zero → skip
      { ingredient: "B", perPizza: 0, perBatchLbs: 1.0 },   // perPizza=0 → skip
      { ingredient: "C", perPizza: 0.5, perBatchLbs: 5.0 }, // 5.0/5 = 1.0, matches 0.5/0.5 × 5 = 5.0
    ];
    expect(detectMixComponentConflicts(components, 5)).toEqual([]);
  });
});

// ── resolveMixByPerPizza ──────────────────────────────────────────────────────

describe("resolveMixByPerPizza", () => {
  it("recalculates perBatchLbs for each component from its perPizza share", () => {
    const components = [
      { ingredient: "Salt", perPizza: 0.6, perBatchLbs: 4.0 }, // wrong
      { ingredient: "Pepper", perPizza: 0.4, perBatchLbs: 2.0 }, // correct
    ];
    const resolved = resolveMixByPerPizza(components, 5);
    // Salt: 0.6/1.0 × 5 = 3.0
    expect(resolved[0].perBatchLbs).toBeCloseTo(3.0, 2);
    // Pepper: 0.4/1.0 × 5 = 2.0
    expect(resolved[1].perBatchLbs).toBeCloseTo(2.0, 2);
    // perPizza values unchanged
    expect(resolved[0].perPizza).toBe(0.6);
    expect(resolved[1].perPizza).toBe(0.4);
  });

  it("does not mutate the original components", () => {
    const components = [{ ingredient: "X", perPizza: 1.0, perBatchLbs: 99 }];
    const original = components[0].perBatchLbs;
    resolveMixByPerPizza(components, 5);
    expect(components[0].perBatchLbs).toBe(original);
  });

  it("handles zero total perPizza gracefully", () => {
    const components = [{ ingredient: "X", perPizza: 0, perBatchLbs: 1.0 }];
    const resolved = resolveMixByPerPizza(components, 5);
    // Falls back: perBatchLbs unchanged
    expect(resolved[0].perBatchLbs).toBe(1.0);
  });
});

// ── resolveMixByPerBatchLbs ───────────────────────────────────────────────────

describe("resolveMixByPerBatchLbs", () => {
  it("redistributes perPizza proportionally from perBatchLbs share", () => {
    // Original: Salt 0.3 oz/pizza, Pepper 0.7 oz/pizza (total = 1.0)
    // Entered:  Salt 2.0 lbs/batch, Pepper 3.0 lbs/batch (sum = 5.0 = batchSize)
    // Salt share by lbs: 2/5 = 40% → new perPizza = 0.4
    // Pepper share by lbs: 3/5 = 60% → new perPizza = 0.6
    const components = [
      { ingredient: "Salt", perPizza: 0.3, perBatchLbs: 2.0 },
      { ingredient: "Pepper", perPizza: 0.7, perBatchLbs: 3.0 },
    ];
    const { components: resolved, batchSize: newBatchSize } = resolveMixByPerBatchLbs(components, 5);
    expect(resolved[0].perPizza).toBeCloseTo(0.4, 5);
    expect(resolved[1].perPizza).toBeCloseTo(0.6, 5);
    // perBatchLbs unchanged
    expect(resolved[0].perBatchLbs).toBe(2.0);
    expect(resolved[1].perBatchLbs).toBe(3.0);
    // batchSize updated to sum of entered perBatchLbs
    expect(newBatchSize).toBeCloseTo(5.0, 5);
  });

  it("sets batchSize = sum(perBatchLbs) when component lbs do not match batchSize", () => {
    // Entered 4 + 2 = 6 lbs/batch for components, but batchSize was 5.
    // Resolution should adopt 6 as the new batch size.
    const components = [
      { ingredient: "Salt", perPizza: 0.6, perBatchLbs: 4.0 },
      { ingredient: "Pepper", perPizza: 0.4, perBatchLbs: 2.0 },
    ];
    const { batchSize: newBatchSize } = resolveMixByPerBatchLbs(components, 5);
    expect(newBatchSize).toBeCloseTo(6.0, 5);
  });

  it("after lbs/batch resolution, detectMixComponentConflicts returns empty (sum != batchSize case)", () => {
    // Conflict: batchSize=5, but components sum to 6 lbs/batch, and perPizza doesn't match.
    const components = [
      { ingredient: "Salt", perPizza: 0.6, perBatchLbs: 4.0 },
      { ingredient: "Pepper", perPizza: 0.4, perBatchLbs: 2.0 },
    ];
    const batchSize = 5;
    // Verify conflict exists (Salt: expected 0.6/1.0×5=3.0, entered 4.0 → conflict)
    expect(detectMixComponentConflicts(components, batchSize)).toHaveLength(1);
    // Resolve by lbs/batch — MUST apply both components and new batchSize
    const { components: resolved, batchSize: newBatchSize } = resolveMixByPerBatchLbs(components, batchSize);
    expect(detectMixComponentConflicts(resolved, newBatchSize)).toHaveLength(0);
  });

  it("after perPizza resolution, detectMixComponentConflicts returns empty", () => {
    const components = [
      { ingredient: "Salt", perPizza: 0.6, perBatchLbs: 4.0 },
      { ingredient: "Pepper", perPizza: 0.4, perBatchLbs: 2.0 },
    ];
    const batchSize = 5;
    // Verify conflict exists first
    expect(detectMixComponentConflicts(components, batchSize)).toHaveLength(1);
    // Resolve by perPizza — batchSize stays the same
    const resolved = resolveMixByPerPizza(components, batchSize);
    expect(detectMixComponentConflicts(resolved, batchSize)).toHaveLength(0);
  });

  it("does not mutate the original components", () => {
    const components = [{ ingredient: "X", perPizza: 1.0, perBatchLbs: 99 }];
    const original = components[0].perBatchLbs;
    resolveMixByPerBatchLbs(components, 5);
    expect(components[0].perBatchLbs).toBe(original);
  });

  it("handles zero total perBatchLbs gracefully — returns original batchSize unchanged", () => {
    const components = [{ ingredient: "X", perPizza: 1.0, perBatchLbs: 0 }];
    const { components: resolved, batchSize: newBatchSize } = resolveMixByPerBatchLbs(components, 5);
    // Falls back: perBatchLbs and batchSize unchanged
    expect(resolved[0].perBatchLbs).toBe(0);
    expect(newBatchSize).toBe(5);
  });
});

// ── Spec-import mismatch scenario ─────────────────────────────────────────────
//
// A spec import can independently write:
//   • the appNOzPerPizza total (from the TARGET WEIGHT row in the spec sheet)
//   • recipe row lbs values (from per-ingredient oz/pizza rows)
//
// These often disagree because the spec sheet column is rounded differently from
// the sum of the ingredient rows. This describe block verifies the full
// detect → badge-shows → resolve → no-more-conflict → persist round-trip at
// the pure-logic layer. UI wiring and saveProfile persistence are covered
// separately in mathCheckBadgeSaveLoad.test.ts.

describe("spec-import mismatch scenario", () => {
  // Simulates what a real spec import writes: ingredient rows parsed from one
  // block of the sheet, and a total oz/pizza parsed from a different row.
  // These are independently rounded and routinely disagree by more than 0.05.
  const importedRows = [
    { ingredient: "Herb Blend", lbs: 1.5 },
    { ingredient: "Oregano", lbs: 0.85 },
    { ingredient: "Garlic Salt", lbs: 0.6 },
  ];
  // sum = 2.95; import separately wrote 3.1 for the total field
  const importedTotal = 3.1;

  it("import-created disagreement is detected as a row-sum-vs-total conflict", () => {
    const conflicts = detectAppSlotConflicts(importedRows, importedTotal);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("row-sum-vs-total");
    expect(conflicts[0].rowSum).toBeCloseTo(2.95, 5);
    expect(conflicts[0].total).toBe(importedTotal);
  });

  it("resolving by row sum produces a value that clears the conflict", () => {
    const conflicts = detectAppSlotConflicts(importedRows, importedTotal);
    expect(conflicts).toHaveLength(1);

    const conflict = conflicts[0];
    // "Use row sum" button path: new oz/pizza = the row sum
    const newOzPerPizza = resolveByRowSum(conflict.rowSum);
    expect(newOzPerPizza).toBeCloseTo(2.95, 5);

    // After the field is updated to the row sum the badge must disappear
    expect(detectAppSlotConflicts(importedRows, newOzPerPizza)).toHaveLength(0);
  });

  it("resolving by total (scaling rows) also clears the conflict", () => {
    const conflicts = detectAppSlotConflicts(importedRows, importedTotal);
    expect(conflicts).toHaveLength(1);

    const scaledRows = resolveByTotal(importedRows, importedTotal);
    // Scaled rows must now sum to the total within tolerance
    expect(detectAppSlotConflicts(scaledRows, importedTotal)).toHaveLength(0);
    // Ingredient proportions are preserved
    const origSum = importedRows.reduce((s, r) => s + r.lbs, 0);
    const newSum = scaledRows.reduce((s, r) => s + r.lbs, 0);
    expect(newSum).toBeCloseTo(importedTotal, 2);
    // resolveByTotal rounds to 3 decimal places, so use precision 2 here.
    expect(scaledRows[0].lbs / scaledRows[1].lbs).toBeCloseTo(
      importedRows[0].lbs / importedRows[1].lbs,
      2,
    );
    // originals not mutated
    expect(importedRows.reduce((s, r) => s + r.lbs, 0)).toBeCloseTo(origSum, 5);
  });

  it("a second import that fixes the total also clears the conflict (re-import idempotency)", () => {
    // Simulate a re-import where the spec sheet's total was corrected to match
    // the row sum exactly.
    const correctedTotal = importedRows.reduce((s, r) => s + r.lbs, 0); // 2.95
    expect(detectAppSlotConflicts(importedRows, correctedTotal)).toHaveLength(0);
  });

  it("badge does not fire when import rows are absent (no rows to compare)", () => {
    // A spec import that wrote only the total but no ingredient rows must not
    // show a badge — there is nothing to disagree with.
    expect(detectAppSlotConflicts([], importedTotal)).toHaveLength(0);
  });

  it("badge does not fire when total was not imported (zero)", () => {
    // A spec import that wrote rows but left the total field at 0 must not
    // show a badge — no authoritative total to compare against.
    expect(detectAppSlotConflicts(importedRows, 0)).toHaveLength(0);
  });
});
