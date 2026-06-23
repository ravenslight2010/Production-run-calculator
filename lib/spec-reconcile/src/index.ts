// @workspace/spec-reconcile — pure, platform-agnostic logic that cross-references
// a SAVED spec sheet against the CURRENT recipe library and reports where they
// disagree ("does the recipe still match the spec?").
//
// No platform IO (no fetch, no storage, no AI). Web, mobile, and the server all
// feed two recipe lists through `reconcileSpecWithRecipes` so the discrepancy
// math is identical everywhere (replit.md parity). The server additionally hands
// the result to an AI for a plain-language summary, but the discrepancies
// themselves are deterministic and reliable on their own.
//
// Names are already canonicalized at import time, so recipes are matched by
// kind+name (case-insensitive) and ingredients by name (case-insensitive); the
// only fuzzy dimension is the pound tolerance.

export type ReconcileKind = "dough" | "sauce" | "cheese";

export type ReconcileRow = { ingredient: string; lbs: number };

export type ReconcileRecipe = {
  kind: ReconcileKind;
  name: string;
  rows: ReconcileRow[];
};

export type DiscrepancyType =
  // The spec sheet defines this recipe but the current library has no recipe of
  // the same kind+name.
  | "missing-recipe"
  // A matched recipe is missing an ingredient the spec sheet lists.
  | "missing-ingredient"
  // A matched recipe has an ingredient the spec sheet does not list.
  | "extra-ingredient"
  // A matched recipe + ingredient where the pounds differ beyond tolerance.
  | "amount-mismatch";

export type Discrepancy = {
  kind: ReconcileKind;
  recipeName: string;
  type: DiscrepancyType;
  /** Present for ingredient-level discrepancies. */
  ingredient?: string;
  /** Pounds the spec sheet calls for (missing-ingredient / amount-mismatch). */
  specLbs?: number;
  /** Pounds in the current recipe (extra-ingredient / amount-mismatch). */
  currentLbs?: number;
  /** Plain-language, app-consistent description of the discrepancy. */
  message: string;
};

export type SpecReconcileInput = {
  /** Recipes from the saved spec sheet. */
  specRecipes: ReconcileRecipe[];
  /** Recipes currently in the app's library. */
  currentRecipes: ReconcileRecipe[];
  /**
   * Absolute pound difference at or below which an amount is treated as a match.
   * Defaults to 0.001 so floating-point noise never registers as a discrepancy.
   */
  lbsTolerance?: number;
};

const KINDS: ReadonlySet<string> = new Set<ReconcileKind>(["dough", "sauce", "cheese"]);

function recipeKey(kind: string, name: string): string {
  return `${kind}\u0000${name.trim().toLowerCase()}`;
}

/** Format pounds compactly: up to 3 decimals, trailing zeros stripped. */
export function fmtLbs(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

/**
 * Collapse a recipe's rows into a name→{ingredient,lbs} map, summing duplicate
 * ingredient rows and dropping blank-named rows. Non-finite pounds count as 0.
 * The first-seen display spelling of an ingredient is kept.
 */
function aggregateRows(rows: ReadonlyArray<ReconcileRow>): Map<string, ReconcileRow> {
  const out = new Map<string, ReconcileRow>();
  for (const row of rows) {
    const ingredient = (row?.ingredient ?? "").trim();
    if (!ingredient) continue;
    const lbs = Number.isFinite(row.lbs) ? row.lbs : 0;
    const key = ingredient.toLowerCase();
    const prior = out.get(key);
    if (prior) prior.lbs += lbs;
    else out.set(key, { ingredient, lbs });
  }
  return out;
}

/**
 * Normalize a loosely-typed recipe list (e.g. a saved spec sheet's `recipes`,
 * which carries extra fields) into the minimal ReconcileRecipe shape. Drops
 * malformed entries; never throws. Shared so server and clients normalize the
 * same way.
 */
export function toReconcileRecipes(raw: unknown): ReconcileRecipe[] {
  if (!Array.isArray(raw)) return [];
  const out: ReconcileRecipe[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const kind = String(o.kind ?? "").trim().toLowerCase();
    if (!KINDS.has(kind)) continue;
    const name = String(o.name ?? "").trim();
    if (!name) continue;
    const rawRows = Array.isArray(o.rows) ? o.rows : [];
    const rows: ReconcileRow[] = [];
    for (const row of rawRows) {
      if (!row || typeof row !== "object") continue;
      const ro = row as Record<string, unknown>;
      const ingredient = String(ro.ingredient ?? "").trim();
      if (!ingredient) continue;
      const lbs = Number(ro.lbs);
      rows.push({ ingredient, lbs: Number.isFinite(lbs) ? lbs : 0 });
    }
    out.push({ kind: kind as ReconcileKind, name, rows });
  }
  return out;
}

/**
 * Cross-reference the saved spec sheet's recipes against the current recipe
 * library and return every discrepancy. Only recipes that appear ON the spec
 * sheet are checked (a current recipe with no spec-sheet counterpart is simply
 * "not on this spec sheet", not a discrepancy). Deterministic and pure.
 */
export function reconcileSpecWithRecipes(input: SpecReconcileInput): Discrepancy[] {
  const tol = input.lbsTolerance != null && input.lbsTolerance >= 0 ? input.lbsTolerance : 0.001;
  const out: Discrepancy[] = [];

  const currentByKey = new Map<string, ReconcileRecipe>();
  for (const r of input.currentRecipes) currentByKey.set(recipeKey(r.kind, r.name), r);

  for (const spec of input.specRecipes) {
    const name = spec.name.trim();
    const current = currentByKey.get(recipeKey(spec.kind, spec.name));
    if (!current) {
      out.push({
        kind: spec.kind,
        recipeName: name,
        type: "missing-recipe",
        message: `The ${spec.kind} recipe "${name}" is on the spec sheet but isn't in your current recipes.`,
      });
      continue;
    }

    const specRows = aggregateRows(spec.rows);
    const curRows = aggregateRows(current.rows);

    for (const [key, s] of specRows) {
      const c = curRows.get(key);
      if (!c) {
        out.push({
          kind: spec.kind,
          recipeName: name,
          type: "missing-ingredient",
          ingredient: s.ingredient,
          specLbs: s.lbs,
          message: `"${name}" is missing "${s.ingredient}" — the spec sheet calls for ${fmtLbs(s.lbs)} lbs.`,
        });
      } else if (Math.abs(c.lbs - s.lbs) > tol) {
        out.push({
          kind: spec.kind,
          recipeName: name,
          type: "amount-mismatch",
          ingredient: s.ingredient,
          specLbs: s.lbs,
          currentLbs: c.lbs,
          message: `"${name}" — "${s.ingredient}" is ${fmtLbs(c.lbs)} lbs but the spec sheet calls for ${fmtLbs(s.lbs)} lbs.`,
        });
      }
    }

    for (const [key, c] of curRows) {
      if (!specRows.has(key)) {
        out.push({
          kind: spec.kind,
          recipeName: name,
          type: "extra-ingredient",
          ingredient: c.ingredient,
          currentLbs: c.lbs,
          message: `"${name}" has "${c.ingredient}" (${fmtLbs(c.lbs)} lbs) that isn't on the spec sheet.`,
        });
      }
    }
  }

  return out;
}

/**
 * Compact one-line-per-discrepancy text block for grounding an AI summary. Pure;
 * bounded by the caller. Returns "" when there are no discrepancies.
 */
export function formatDiscrepanciesForPrompt(discrepancies: ReadonlyArray<Discrepancy>): string {
  return discrepancies.map((d) => `- [${d.kind}] ${d.message}`).join("\n");
}
