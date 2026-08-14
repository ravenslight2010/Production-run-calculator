/**
 * @workspace/setup-math-check
 *
 * Pure, platform-agnostic conflict detection for applicator slot math.
 *
 * Each applicator slot stores several related numbers independently:
 *  1. appNOzPerPizza   — total oz per pizza for this applicator
 *  2. appNBatchLbs     — lbs per physical batch (for batch-count math)
 *  3. recipe row .lbs  — oz per pizza for each ingredient (sum should equal #1)
 *
 * Each mix component stores:
 *  1. perPizza         — oz of this ingredient per pizza
 *  2. perBatchLbs      — lbs of this ingredient in one batch (reference)
 *
 * After imports or manual edits these can drift out of agreement. The
 * functions here detect mismatches and compute corrected values for each
 * possible anchor choice, so the UI can let a manager pick which value
 * is authoritative without auto-applying anything.
 */

/** Tolerance in oz/pizza below which two values are considered equal. */
export const DEFAULT_TOLERANCE = 0.05;

/** Minimum shape expected from a recipe row. */
export interface AppRecipeRow {
  ingredient: string;
  /** oz per pizza for this ingredient (used by cheese/mix applicator rows). */
  lbs: number;
}

// ── Applicator slot conflicts ─────────────────────────────────────────────────

/**
 * The sum of recipe row lbs (oz/pizza per ingredient) disagrees with
 * the slot's oz/pizza total field by more than the tolerance.
 */
export interface RowSumConflict {
  kind: "row-sum-vs-total";
  /** Sum of all row lbs values (oz/pizza). */
  rowSum: number;
  /** Value of the appNOzPerPizza field. */
  total: number;
  /** Tolerance used for the comparison. */
  tolerance: number;
}

export type AppSlotConflict = RowSumConflict;

/**
 * Detect conflicts in a single applicator slot.
 *
 * Returns an empty array when values agree within `tolerance` oz/pizza,
 * or when there are no active recipe rows (nothing to compare against).
 */
export function detectAppSlotConflicts(
  rows: AppRecipeRow[],
  ozPerPizza: number,
  tolerance: number = DEFAULT_TOLERANCE,
): AppSlotConflict[] {
  const conflicts: AppSlotConflict[] = [];

  // Only check when rows carry non-zero lbs AND the total is set.
  const hasActiveRows = rows.some((r) => Number(r.lbs) > 0);
  if (!hasActiveRows || !(ozPerPizza > 0)) return conflicts;

  const rowSum = rows.reduce((s, r) => s + (Number(r.lbs) || 0), 0);
  if (Math.abs(rowSum - ozPerPizza) > tolerance) {
    conflicts.push({ kind: "row-sum-vs-total", rowSum, total: ozPerPizza, tolerance });
  }

  return conflicts;
}

/**
 * Resolve by anchoring on the row sum:
 * returns the new oz/pizza total that should be written to appNOzPerPizza.
 * The rows themselves are unchanged.
 */
export function resolveByRowSum(rowSum: number): number {
  return rowSum;
}

/**
 * Resolve by anchoring on the oz/pizza total:
 * scales every row's lbs proportionally so their sum equals `total`.
 * Returns a NEW array — original rows are not mutated.
 */
export function resolveByTotal<R extends AppRecipeRow>(rows: R[], total: number): R[] {
  const rowSum = rows.reduce((s, r) => s + (Number(r.lbs) || 0), 0);
  if (rowSum === 0) return rows;
  const factor = total / rowSum;
  return rows.map((r) => ({
    ...r,
    lbs: Math.round((Number(r.lbs) || 0) * factor * 1000) / 1000,
  }));
}

// ── Mix component conflicts ───────────────────────────────────────────────────

export interface MixComponentInput {
  ingredient: string;
  /** Oz of this ingredient per pizza. */
  perPizza: number;
  /** Lbs of this ingredient in one batch of the mix (optional reference). */
  perBatchLbs?: number;
}

/**
 * A detected mismatch between `perPizza` and `perBatchLbs` on a single
 * mix component, given the mix's total batch size.
 */
export interface MixComponentConflict {
  /** Index in the components array. */
  componentIdx: number;
  ingredient: string;
  /** oz/pizza from the component. */
  perPizza: number;
  /** lbs/batch from the component. */
  perBatchLbs: number;
  /**
   * Expected lbs/batch computed from this component's share of the mix's
   * total perPizza × batchSize.
   */
  expectedPerBatchLbs: number;
}

/**
 * Detect conflicts between `perPizza` and `perBatchLbs` for mix components.
 *
 * Requires `batchSize > 0` (the mix's total lbs-per-batch) and at least one
 * component with both perPizza and perBatchLbs set to a positive value.
 *
 * The expected relationship:
 *   component.perBatchLbs = (component.perPizza / totalPerPizza) × batchSize
 */
export function detectMixComponentConflicts(
  components: MixComponentInput[],
  batchSize: number,
  tolerance: number = DEFAULT_TOLERANCE,
): MixComponentConflict[] {
  if (!(batchSize > 0)) return [];

  const totalPerPizza = components.reduce((s, c) => s + (Number(c.perPizza) || 0), 0);
  if (!(totalPerPizza > 0)) return [];

  const result: MixComponentConflict[] = [];
  components.forEach((c, idx) => {
    const perPizza = Number(c.perPizza) || 0;
    const perBatchLbs = Number(c.perBatchLbs) || 0;
    if (!(perPizza > 0) || !(perBatchLbs > 0)) return; // skip unset
    const expectedPerBatchLbs = (perPizza / totalPerPizza) * batchSize;
    if (Math.abs(perBatchLbs - expectedPerBatchLbs) > tolerance) {
      result.push({
        componentIdx: idx,
        ingredient: c.ingredient,
        perPizza,
        perBatchLbs,
        expectedPerBatchLbs,
      });
    }
  });
  return result;
}

/**
 * Resolve mix component conflicts by anchoring on the oz/pizza values:
 * recalculates each component's `perBatchLbs` so it matches its share
 * of `batchSize`. Returns a NEW array — originals are not mutated.
 */
export function resolveMixByPerPizza(
  components: MixComponentInput[],
  batchSize: number,
): Array<MixComponentInput & { perBatchLbs: number }> {
  const totalPerPizza = components.reduce((s, c) => s + (Number(c.perPizza) || 0), 0);
  if (!(totalPerPizza > 0)) {
    return components.map((c) => ({ ...c, perBatchLbs: Number(c.perBatchLbs) || 0 }));
  }
  return components.map((c) => ({
    ...c,
    perBatchLbs: Math.round(((Number(c.perPizza) || 0) / totalPerPizza) * batchSize * 1000) / 1000,
  }));
}

/**
 * Resolve mix component conflicts by anchoring on the lbs/batch values.
 *
 * The entered `perBatchLbs` values are treated as authoritative. Because the
 * sum of component lbs may differ from the existing `batchSize`, the correct
 * resolution is to:
 *   1. Set the authoritative batch size = sum(perBatchLbs).
 *   2. Redistribute each component's `perPizza` proportionally to its share
 *      of that new batch total, preserving the total oz/pizza across the mix.
 *
 * The returned `batchSize` MUST be written back to the mix alongside the
 * updated components, otherwise the conflict detector will still find
 * mismatches. Returns a new object — originals are not mutated.
 */
export function resolveMixByPerBatchLbs(
  components: MixComponentInput[],
  _batchSize: number,
): { components: Array<MixComponentInput & { perBatchLbs: number }>; batchSize: number } {
  const newBatchSize = components.reduce((s, c) => s + (Number(c.perBatchLbs) || 0), 0);
  const totalPerPizza = components.reduce((s, c) => s + (Number(c.perPizza) || 0), 0);

  if (!(newBatchSize > 0)) {
    return {
      components: components.map((c) => ({ ...c, perBatchLbs: Number(c.perBatchLbs) || 0 })),
      batchSize: _batchSize,
    };
  }

  return {
    components: components.map((c) => ({
      ...c,
      // Each component's perPizza = its share of the new batch total × total oz/pizza
      perPizza: Math.round(
        ((Number(c.perBatchLbs) || 0) / newBatchSize) * totalPerPizza * 1000,
      ) / 1000,
      perBatchLbs: Number(c.perBatchLbs) || 0,
    })),
    batchSize: Math.round(newBatchSize * 1000) / 1000,
  };
}
