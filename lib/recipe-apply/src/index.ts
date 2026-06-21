// Recipe-suggestion Apply/Undo — pure decision logic.
//
// This is the single source of truth shared by the web app
// (artifacts/run-calculator) and the mobile app
// (artifacts/run-calculator-mobile) so both platforms validate, sanitize, and
// apply a confirm-first recipe suggestion (a scaled recipe or substitution) the
// EXACT same way and build the EXACT same Undo (replit.md parity rule). Each app
// keeps only its own platform write glue: how a target run is resolved, how the
// previous rows are read, and how rows are written back.
//
// The suggestion only names a recipe field (recipeId); the run it applies to is
// passed separately. Nothing is written until the worker taps Apply, so the
// caller invokes this only after that confirmation. The returned `undo` restores
// the chosen run's previous rows by replaying the SAME write path.

export type RecipeRow = { ingredient: string; lbs: number };

// The stable settings-field keys for a run's recipes, in the order the assistant
// sends them. These double as the suggestion `recipeId`, so an applied suggestion
// routes straight back to the right recipe field. This is the single source of
// truth both apps re-export (so the valid-recipe set can never drift).
export const RECIPE_FIELD_IDS = [
  "doughRecipe",
  "frontlineRecipe",
  "app1CheeseRecipe",
  "app2CheeseRecipe",
  "app3CheeseRecipe",
  "app4CheeseRecipe",
] as const;
export type RecipeFieldId = (typeof RECIPE_FIELD_IDS)[number];

// The subset of a recipe suggestion this logic depends on. The apps' richer
// RecipeAssistSuggestion type is structurally compatible.
export type RecipeSuggestionLike = {
  kind: "scale" | "substitute";
  recipeId: string;
  rows: RecipeRow[];
};

export type ApplyRecipeSuggestionResult = {
  ok: boolean;
  message: string;
  undo?: () => void;
};

// The platform write glue. All three are pure boundaries the shared logic drives:
//  - resolveTargetId: apply the `runId ?? currentRun` fallback and validate the
//    run still exists; return the validated id, or null if it does not.
//  - readPrevRows: read the run's CURRENT raw stored value for the recipe field
//    (any shape — it is normalized here), so Undo can restore it.
//  - write: replace the recipe field's rows on the target run (and persist /
//    schedule sync as the platform requires). Called once to apply, and again
//    by `undo` to restore.
export type ApplyRecipeSuggestionDeps = {
  resolveTargetId: (runId?: string) => string | null;
  readPrevRows: (targetId: string, recipeId: RecipeFieldId) => unknown;
  write: (targetId: string, recipeId: RecipeFieldId, rows: RecipeRow[]) => void;
};

// Trim ingredient names, coerce weights to a finite number (>=0), and drop blank
// rows. Identical on both platforms so the applied rows never differ.
export function sanitizeRecipeRows(rows: RecipeRow[] | undefined): RecipeRow[] {
  return (rows ?? [])
    .map((r) => ({ ingredient: (r.ingredient ?? "").trim(), lbs: Number(r.lbs) || 0 }))
    .filter((r) => r.ingredient);
}

// Normalize a raw stored recipe value (which may be anything) into clean rows,
// preserving the original ingredient/lbs values so Undo restores them exactly.
function normalizePrevRows(prevRaw: unknown): RecipeRow[] {
  const arr = Array.isArray(prevRaw) ? (prevRaw as RecipeRow[]) : [];
  return arr.map((r) => ({ ingredient: r.ingredient, lbs: r.lbs }));
}

// Apply a confirm-first recipe suggestion to a chosen run's matching recipe rows.
// Validates the recipe field and target run, sanitizes the proposed rows, writes
// them through the platform `write` glue, and returns an Undo that restores the
// run's previous rows. Pure aside from the injected glue — one test locks the
// behavior for both web and mobile.
export function applyRecipeSuggestion(
  s: RecipeSuggestionLike,
  runId: string | undefined,
  deps: ApplyRecipeSuggestionDeps,
): ApplyRecipeSuggestionResult {
  if (!(RECIPE_FIELD_IDS as readonly string[]).includes(s.recipeId)) {
    return { ok: false, message: "Unknown recipe" };
  }
  const targetId = deps.resolveTargetId(runId);
  if (!targetId) return { ok: false, message: "Run no longer exists" };

  const rows = sanitizeRecipeRows(s.rows);
  if (rows.length === 0) return { ok: false, message: "Nothing to apply" };

  const recipeId = s.recipeId as RecipeFieldId;
  const prevRows = normalizePrevRows(deps.readPrevRows(targetId, recipeId));

  deps.write(targetId, recipeId, rows);
  return {
    ok: true,
    message: s.kind === "scale" ? "Recipe scaled" : "Substitution applied",
    undo: () => deps.write(targetId, recipeId, prevRows),
  };
}
