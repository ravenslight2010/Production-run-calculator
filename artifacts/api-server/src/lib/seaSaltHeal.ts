// Pure logic for the one-time "Sea Salt is not Salt" heal (db-free for unit
// tests). On 2026-07-16 an import confirm learned "SEA SALT" → "SALT" as a
// factory-wide ingredient alias (spec_import_aliases kind doughIngredient +
// mirrored ai_corrections domain ingredient), and every import since silently
// renamed Sea Salt rows to Salt in the recipe pools. Sea Salt and Salt are
// DIFFERENT ingredients.
//
// The rename-back below is deterministic, grounded in the customer's source
// workbooks (attached_assets/source-library): only recipes whose SOURCE sheet
// lists "Sea Salt" — and lists NO plain "Salt" row at all — are healed, and
// only when the stored amount matches one of the sheet's own column values (or
// is a 0-amount stub row, as spec-import stubs mint). Recipes whose sheets
// genuinely call for plain Salt (CRB Dough, Lucia Pizza Sauce, Spinach Mix, …)
// are never touched.

/** Loose key: lowercase, non-alphanumerics dropped. */
export function seaSaltLooseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type SeaSaltTarget = {
  /** Matches a pool recipe name (loose key) whose source sheet says Sea Salt. */
  matchRecipe: (recipeLooseKey: string) => boolean;
  /**
   * Amounts the source sheet lists for its Sea Salt row (any bag/batch
   * column). A stored amount of 0 (import stub) is always accepted.
   */
  sheetAmounts: ReadonlyArray<number>;
};

// Source-of-truth rows, from the source-library workbooks (2026-07-18 corpus):
//   dough/Malted_Barley_Dough…      SEA SALT 0.5 / 1 / 1.25   (2/4/5 bag)
//   dough/Modified_Malted_Barley…   SEA SALT 1.3
//   dough/Masa_Dough…               SEA SALT 2.5
//   dough/Masa_Dough,_Natural…      SEA SALT 2.5
//   sauce/Aldo_Pizza_Sauce…         Sea Salt 1
//   premix "Lowes Grilled Vegetable" Sea Salt 0.03 oz/pizza (1.242 lbs/batch)
// None of these sheets contains a plain "Salt" row.
export const SEA_SALT_DOUGH_TARGETS: SeaSaltTarget[] = [
  {
    // "Modified Malted Barley Dough" — check BEFORE the plain malted-barley
    // matcher (its key contains the plain key).
    matchRecipe: (k) => k.includes("modifiedmaltedbarley"),
    sheetAmounts: [1.3],
  },
  {
    matchRecipe: (k) => k.includes("maltedbarley") && !k.includes("modified"),
    sheetAmounts: [0.5, 1, 1.25],
  },
  {
    // Both Masa variants ("Masa Dough", "Masa Dough, Natural, (Lowe's)").
    matchRecipe: (k) => k.includes("masa"),
    sheetAmounts: [2.5],
  },
];

export const SEA_SALT_SAUCE_TARGETS: SeaSaltTarget[] = [
  { matchRecipe: (k) => k.includes("aldo"), sheetAmounts: [1] },
];

export const SEA_SALT_MIX_TARGETS: SeaSaltTarget[] = [
  { matchRecipe: (k) => k.includes("grilledvegetable"), sheetAmounts: [0.03, 1.242] },
];

function isPlainSalt(name: string): boolean {
  return seaSaltLooseKey(name) === "salt";
}

function isSeaSalt(name: string): boolean {
  return seaSaltLooseKey(name) === "seasalt";
}

/**
 * Rename poisoned "Salt" rows back to "Sea Salt" in one recipe's components.
 * `amountOf` reads the row's stored amount (lbs for dough/sauce, perPizza for
 * mixes); `rename` returns the healed row. Rules:
 *  - only when the recipe matches a known Sea Salt target;
 *  - only rows named exactly "Salt" (loose), with amount 0 (stub) or equal to
 *    one of the sheet's column values;
 *  - skipped entirely if the recipe already has a Sea Salt row (nothing to
 *    heal / avoid duplicates).
 * Returns null when nothing changed. Idempotent: healed output has no plain
 * Salt row left to match.
 */
export function healSeaSaltComponents<T extends { ingredient: string }>(
  recipeName: string,
  components: ReadonlyArray<T>,
  targets: ReadonlyArray<SeaSaltTarget>,
  amountOf: (c: T) => number,
): T[] | null {
  const key = seaSaltLooseKey(recipeName);
  const target = targets.find((t) => t.matchRecipe(key));
  if (!target) return null;
  if (components.some((c) => isSeaSalt(c.ingredient))) return null;

  let changed = false;
  const out = components.map((c) => {
    if (!isPlainSalt(c.ingredient)) return c;
    const amt = amountOf(c);
    const amountOk = amt === 0 || target.sheetAmounts.some((a) => Math.abs(a - amt) < 1e-9);
    if (!amountOk) return c;
    changed = true;
    return { ...c, ingredient: "Sea Salt" };
  });
  return changed ? out : null;
}
