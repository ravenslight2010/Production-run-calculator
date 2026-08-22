/**
 * Pure safeguards for replacing imported recipe formulas.
 *
 * The importer owns the decision to replace a formula. This package only
 * compares two versions and describes the risk, so the same rules can be used
 * by spec, cheese, and premix import reviews without mixing batch pounds and
 * per-pizza ounces.
 */

export type FormulaUnit = "batch" | "perPizza";
export type FormulaKind = "dough" | "sauce" | "cheese" | "mix";
export type FormulaChangeType =
  | "added"
  | "removed"
  | "renamed"
  | "quantity-changed";

export type FormulaRow = {
  ingredient: string;
  amount: number;
};

export type FormulaRecipe = {
  kind: FormulaKind;
  name: string;
  unit: FormulaUnit;
  rows: ReadonlyArray<FormulaRow>;
};

export type FormulaChange = {
  kind: FormulaKind;
  unit: FormulaUnit;
  recipeName: string;
  previousRecipeName?: string;
  type: FormulaChangeType;
  ingredient?: string;
  previousAmount?: number;
  nextAmount?: number;
  /** Absolute amount in the recipe's own unit. */
  delta?: number;
  /** Relative change from the previous amount or total. */
  percent?: number;
  /** Emptying or a large change needs an explicit manager acknowledgement. */
  requiresConfirmation: boolean;
};

export type FormulaChangeSummary = {
  changes: FormulaChange[];
  requiresConfirmation: boolean;
  emptying: number;
  large: number;
};

export const FORMULA_GUARD_LIMITS = {
  /** A component amount change at or above this fraction is large. */
  componentPercent: 0.25,
  /** A recipe total change at or above this fraction is large. */
  totalPercent: 0.25,
} as const;

function cleanName(value: unknown): string {
  return String(value ?? "").trim();
}

function key(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function rowsByIngredient(rows: ReadonlyArray<FormulaRow>): Map<string, FormulaRow> {
  const out = new Map<string, FormulaRow>();
  for (const row of rows ?? []) {
    const ingredient = cleanName(row?.ingredient);
    const amount = Number(row?.amount);
    if (!ingredient || !Number.isFinite(amount) || amount < 0) continue;
    const k = key(ingredient);
    const previous = out.get(k);
    if (previous) previous.amount += amount;
    else out.set(k, { ingredient, amount });
  }
  return out;
}

function total(rows: Map<string, FormulaRow>): number {
  let result = 0;
  for (const row of rows.values()) result += row.amount;
  return result;
}

function relativeChange(previous: number, next: number): number {
  if (previous === 0) return next === 0 ? 0 : 1;
  return Math.abs(next - previous) / Math.abs(previous);
}

function sameFormula(a: Map<string, FormulaRow>, b: Map<string, FormulaRow>): boolean {
  if (a.size !== b.size) return false;
  for (const [ingredient, row] of a) {
    const other = b.get(ingredient);
    if (!other || Math.abs(other.amount - row.amount) > 0.000001) return false;
  }
  return true;
}

/**
 * Compare a current recipe pool to an imported replacement.
 *
 * Exact names are matched first. Unmatched recipes with identical formulas are
 * paired as renames, which prevents a harmless source rename from being shown
 * as a destructive remove + add. Formula changes are then reported per
 * ingredient. The `unit` is mandatory so a 2 oz/pizza mix is never compared
 * to 2 batch pounds as if they were the same measure.
 */
export function classifyFormulaChanges(
  current: ReadonlyArray<FormulaRecipe>,
  incoming: ReadonlyArray<FormulaRecipe>,
): FormulaChangeSummary {
  const currentByKey = new Map<string, FormulaRecipe>();
  const incomingByKey = new Map<string, FormulaRecipe>();
  for (const recipe of current) {
    const name = cleanName(recipe.name);
    if (name) currentByKey.set(`${recipe.kind}\u0000${recipe.unit}\u0000${key(name)}`, { ...recipe, name });
  }
  for (const recipe of incoming) {
    const name = cleanName(recipe.name);
    if (name) incomingByKey.set(`${recipe.kind}\u0000${recipe.unit}\u0000${key(name)}`, { ...recipe, name });
  }

  const changes: FormulaChange[] = [];
  const matchedCurrent = new Set<string>();
  const matchedIncoming = new Set<string>();

  for (const [recipeKey, next] of incomingByKey) {
    const previous = currentByKey.get(recipeKey);
    if (!previous) continue;
    matchedCurrent.add(recipeKey);
    matchedIncoming.add(recipeKey);
    const before = rowsByIngredient(previous.rows);
    const after = rowsByIngredient(next.rows);
    const beforeTotal = total(before);
    const afterTotal = total(after);
    for (const [ingredientKey, row] of after) {
      const old = before.get(ingredientKey);
      if (!old) {
        changes.push({
          kind: next.kind, unit: next.unit, recipeName: next.name,
          type: "added", ingredient: row.ingredient, nextAmount: row.amount,
          requiresConfirmation: beforeTotal === 0 || relativeChange(beforeTotal, afterTotal) >= FORMULA_GUARD_LIMITS.totalPercent,
        });
      } else if (Math.abs(old.amount - row.amount) > 0.000001) {
        const percent = relativeChange(old.amount, row.amount);
        changes.push({
          kind: next.kind, unit: next.unit, recipeName: next.name,
          type: "quantity-changed", ingredient: row.ingredient,
          previousAmount: old.amount, nextAmount: row.amount,
          delta: row.amount - old.amount, percent,
          requiresConfirmation: percent >= FORMULA_GUARD_LIMITS.componentPercent ||
            relativeChange(beforeTotal, afterTotal) >= FORMULA_GUARD_LIMITS.totalPercent,
        });
      }
    }
    for (const [ingredientKey, row] of before) {
      if (after.has(ingredientKey)) continue;
      changes.push({
        kind: next.kind, unit: next.unit, recipeName: next.name,
        type: "removed", ingredient: row.ingredient, previousAmount: row.amount,
        delta: -row.amount,
        requiresConfirmation: true,
      });
    }
  }

  const unmatchedCurrent = [...currentByKey.entries()].filter(([k]) => !matchedCurrent.has(k));
  const unmatchedIncoming = [...incomingByKey.entries()].filter(([k]) => !matchedIncoming.has(k));
  const renamedCurrent = new Set<string>();
  const renamedIncoming = new Set<string>();
  for (const [oldKey, previous] of unmatchedCurrent) {
    const before = rowsByIngredient(previous.rows);
    const candidate = unmatchedIncoming.find(([, next]) =>
      next.kind === previous.kind && next.unit === previous.unit &&
      sameFormula(before, rowsByIngredient(next.rows)),
    );
    if (!candidate) continue;
    const [newKey, next] = candidate;
    renamedCurrent.add(oldKey);
    renamedIncoming.add(newKey);
    changes.push({
      kind: next.kind, unit: next.unit, recipeName: next.name,
      previousRecipeName: previous.name, type: "renamed",
      requiresConfirmation: false,
    });
  }

  for (const [recipeKey, previous] of unmatchedCurrent) {
    if (renamedCurrent.has(recipeKey)) continue;
    const before = rowsByIngredient(previous.rows);
    changes.push({
      kind: previous.kind, unit: previous.unit, recipeName: previous.name,
      type: "removed", requiresConfirmation: true,
      percent: total(before) > 0 ? 1 : 0,
    });
  }
  for (const [recipeKey, next] of unmatchedIncoming) {
    if (renamedIncoming.has(recipeKey)) continue;
    const after = rowsByIngredient(next.rows);
    changes.push({
      kind: next.kind, unit: next.unit, recipeName: next.name,
      type: "added", requiresConfirmation: false,
      percent: total(after) > 0 ? 1 : 0,
    });
  }

  return {
    changes,
    requiresConfirmation: changes.some((change) => change.requiresConfirmation),
    emptying: changes.filter((change) => change.type === "removed" && change.previousAmount != null).length,
    large: changes.filter((change) => change.requiresConfirmation && change.type !== "removed").length,
  };
}