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

// ---------------------------------------------------------------------------
// Recipe & ingredient assistant — shared assist-context builder.
//
// The web (artifacts/run-calculator/src/aiRecipe.ts) and mobile
// (artifacts/run-calculator-mobile/context/aiRecipe.ts) apps both shape the
// current run's recipes, the known ingredient pool, and run context into the
// POST /ai/recipe-assistant wire payload. That shaping is pure and must stay
// byte-for-byte identical across platforms (replit.md parity), so it lives here
// — the same single-source-of-truth treatment Apply/Undo already gets above.
// Each app keeps only its own fetch glue (cookie session vs. bearer token).
// ---------------------------------------------------------------------------

// A single recipe row sent to the assistant. Structurally the same as the
// RecipeRow above; aliased so the assistant types read clearly.
export type RecipeAssistRow = RecipeRow;

export type RecipeAssistRecipe = {
  id?: string;
  kind: string;
  name: string;
  rows: RecipeAssistRow[];
};

// A structured, confirm-first edit returned by the assistant for a SCALE or
// SUBSTITUTE question — the complete resulting rows for one recipe. Advisory:
// nothing changes until the worker taps Apply.
export type RecipeAssistSuggestion = {
  kind: "scale" | "substitute";
  recipeId: string;
  recipeName?: string;
  summary?: string;
  rows: RecipeAssistRow[];
};

// A run the worker can target when applying a suggestion. The label mirrors the
// run pickers used elsewhere in the app. The suggestion itself is run-agnostic
// (it only names a recipe field via recipeId), so the chosen target run is passed
// separately at apply time.
export type RecipeApplyTarget = { id: string; label: string };

export type RecipeAssistContext = {
  brand?: string;
  flavor?: string;
  casesNeeded?: number;
  pizzasPerCase?: number;
  doughballWeightOz?: number;
};

export type RecipeAssistInput = {
  question: string;
  recipes: RecipeAssistRecipe[];
  ingredientNames?: string[];
  context?: RecipeAssistContext;
};

export type RecipeAssistResult = {
  answer: string;
  generatedAt: number;
  note?: string;
  suggestion?: RecipeAssistSuggestion;
};

// The current run's recipe fields. Both platforms store these under the exact
// same keys (dough, four cheese applications, and the frontline = Sauce recipe).
export type RecipeAssistSourceSettings = {
  doughRecipeName?: string;
  doughRecipe?: RecipeAssistRow[];
  app1CheeseRecipeName?: string;
  app1CheeseRecipe?: RecipeAssistRow[];
  app2CheeseRecipeName?: string;
  app2CheeseRecipe?: RecipeAssistRow[];
  app3CheeseRecipeName?: string;
  app3CheeseRecipe?: RecipeAssistRow[];
  app4CheeseRecipeName?: string;
  app4CheeseRecipe?: RecipeAssistRow[];
  frontlineRecipeName?: string;
  frontlineRecipe?: RecipeAssistRow[];
};

// Shape the current run's recipes, the known ingredient pool, and run context
// into the wire payload (minus the question). Only non-empty recipes and
// meaningful (>0 / non-blank) context fields are sent so the model is grounded
// strictly in real data. The "frontline" recipe is the UI's Sauce recipe, so it
// is tagged kind "sauce". Pure + identical on both platforms for parity/testing.
export function buildRecipeAssistContext(
  settings: RecipeAssistSourceSettings,
  ingredientNames: string[],
  context: RecipeAssistContext,
): Omit<RecipeAssistInput, "question"> {
  const recipes: RecipeAssistRecipe[] = [];
  const add = (
    id: RecipeFieldId,
    kind: string,
    name: string | undefined,
    rows: RecipeAssistRow[] | undefined,
  ) => {
    const clean = (rows ?? [])
      .filter((r) => (r.ingredient ?? "").trim())
      .map((r) => ({ ingredient: r.ingredient.trim(), lbs: Number(r.lbs) || 0 }));
    if (clean.length) recipes.push({ id, kind, name: (name ?? "").trim(), rows: clean });
  };
  add("doughRecipe", "dough", settings.doughRecipeName, settings.doughRecipe);
  add("frontlineRecipe", "sauce", settings.frontlineRecipeName, settings.frontlineRecipe);
  add("app1CheeseRecipe", "cheese", settings.app1CheeseRecipeName, settings.app1CheeseRecipe);
  add("app2CheeseRecipe", "cheese", settings.app2CheeseRecipeName, settings.app2CheeseRecipe);
  add("app3CheeseRecipe", "cheese", settings.app3CheeseRecipeName, settings.app3CheeseRecipe);
  add("app4CheeseRecipe", "cheese", settings.app4CheeseRecipeName, settings.app4CheeseRecipe);

  const names = Array.from(
    new Map(
      (ingredientNames ?? []).map((n) => [n.trim().toLowerCase(), n.trim()] as const),
    ).values(),
  ).filter(Boolean);

  const ctx: RecipeAssistContext = {};
  if (context.brand?.trim()) ctx.brand = context.brand.trim();
  if (context.flavor?.trim()) ctx.flavor = context.flavor.trim();
  if (Number.isFinite(context.casesNeeded) && (context.casesNeeded ?? 0) > 0)
    ctx.casesNeeded = context.casesNeeded;
  if (Number.isFinite(context.pizzasPerCase) && (context.pizzasPerCase ?? 0) > 0)
    ctx.pizzasPerCase = context.pizzasPerCase;
  if (Number.isFinite(context.doughballWeightOz) && (context.doughballWeightOz ?? 0) > 0)
    ctx.doughballWeightOz = context.doughballWeightOz;

  return {
    recipes,
    ...(names.length ? { ingredientNames: names } : {}),
    ...(Object.keys(ctx).length ? { context: ctx } : {}),
  };
}
