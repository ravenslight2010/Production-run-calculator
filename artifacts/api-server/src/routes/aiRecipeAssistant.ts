import { AiRecipeAssistantBody } from "@workspace/api-zod";
import * as z from "zod";

// Bounds for the recipe & ingredient helper, in the same spirit as the other AI
// endpoints: cap how much the model is asked to read and how much it can return
// so a single request can't blow up cost/latency.
export const MAX_QUESTION_CHARS = 1000;
export const MAX_ANSWER_CHARS = 2000;
export const MAX_NOTE_CHARS = 600;
export const MAX_SUMMARY_CHARS = 200;
export const MAX_NAME_CHARS = 200;
export const MAX_RECIPES = 24;
export const MAX_ROWS_PER_RECIPE = 80;
export const MAX_INGREDIENT_NAMES = 600;

export type RecipeAssistInput = z.infer<typeof AiRecipeAssistantBody>;

// A structured, confirm-first edit the worker can apply in one tap: the exact
// resulting rows of a scaled or substituted recipe, targeted at one of the
// recipes we sent (by its stable id). Advisory only — the client still requires
// an explicit confirm before anything is written.
export type RecipeSuggestion = {
  kind: "scale" | "substitute";
  recipeId: string;
  recipeName: string;
  summary: string;
  rows: { ingredient: string; lbs: number }[];
};

export type RecipeAssistValidationResult =
  | { ok: true; data: RecipeAssistInput }
  | { ok: false; status: number; error: string };

// Validate POST /ai/recipe-assistant. The body carries a question plus the
// current run's recipe rows, the known ingredient pool, and optional run
// context. Validate the envelope with the generated schema, then enforce the
// cost caps so a pathological payload can't blow up a single AI call.
export function validateRecipeAssistBody(body: unknown): RecipeAssistValidationResult {
  const parsed = AiRecipeAssistantBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const question = parsed.data.question.trim();
  if (!question) {
    return { ok: false, status: 400, error: "Question is required" };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Question too long (max ${MAX_QUESTION_CHARS} characters)`,
    };
  }
  if (parsed.data.recipes.length > MAX_RECIPES) {
    return { ok: false, status: 400, error: `Too many recipes (max ${MAX_RECIPES})` };
  }
  for (const r of parsed.data.recipes) {
    if (r.rows.length > MAX_ROWS_PER_RECIPE) {
      return {
        ok: false,
        status: 400,
        error: `A recipe has too many rows (max ${MAX_ROWS_PER_RECIPE})`,
      };
    }
  }
  if ((parsed.data.ingredientNames?.length ?? 0) > MAX_INGREDIENT_NAMES) {
    return {
      ok: false,
      status: 400,
      error: `Too many ingredient names (max ${MAX_INGREDIENT_NAMES})`,
    };
  }
  return { ok: true, data: { ...parsed.data, question } };
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function fmtRows(rows: RecipeAssistInput["recipes"][number]["rows"]): string {
  const real = rows.filter((r) => r.ingredient.trim());
  if (real.length === 0) return "(no ingredients)";
  const total = real.reduce((acc, r) => acc + (Number.isFinite(r.lbs) ? r.lbs : 0), 0);
  const lines = real.map((r) => `    - ${r.ingredient.trim()}: ${r.lbs} lbs`);
  lines.push(`    (total batch: ${Math.round(total * 1000) / 1000} lbs)`);
  return lines.join("\n");
}

// Shape the validated input into a compact, model-friendly prompt. The recipe
// context block lists the real ingredient rows and totals so the model can do
// honest, app-consistent scaling math; the instructions are tuned for the three
// supported jobs (scale, substitute, explain) and for refusing to invent data.
export function buildRecipeAssistPrompt(input: RecipeAssistInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a helpful assistant for floor staff at a frozen-pizza factory. " +
    "A worker will ask a plain-language question about the current run's recipes " +
    "and ingredients. You do exactly three kinds of jobs: (1) SCALE a recipe up " +
    "or down (scale every ingredient by the same factor so the proportions stay " +
    "identical, and show the new pounds per ingredient and the new batch total); " +
    "(2) suggest an ingredient SUBSTITUTION (prefer names from the KNOWN " +
    "INGREDIENTS list when one fits); (3) EXPLAIN a recipe or formula in plain " +
    "language. Answer ONLY from the real data provided below (the recipe rows, " +
    "the known ingredients, the run context, the facility memory, and the name " +
    "corrections). Be concrete and quantitative when the data supports it, and " +
    "keep the answer short and clear. NEVER invent, guess, or assume ingredients " +
    "or quantities that aren't given. If the data is insufficient to answer, say " +
    "so plainly and explain what's missing rather than making something up. You " +
    "are ADVISORY ONLY: never claim to have changed, saved, or applied anything " +
    "— you only give the worker the numbers and explanation to act on themselves.";

  const lines: string[] = [];
  lines.push("RECIPE DATA (the only facts you may use):");

  const ctx = input.context;
  if (ctx && (ctx.brand || ctx.flavor || ctx.casesNeeded != null || ctx.pizzasPerCase != null || ctx.doughballWeightOz != null)) {
    const parts: string[] = [];
    const product = `${(ctx.brand ?? "").trim()} ${(ctx.flavor ?? "").trim()}`.trim();
    if (product) parts.push(`product="${product}"`);
    if (ctx.casesNeeded != null) parts.push(`casesNeeded=${ctx.casesNeeded}`);
    if (ctx.pizzasPerCase != null) parts.push(`pizzasPerCase=${ctx.pizzasPerCase}`);
    if (ctx.doughballWeightOz != null) parts.push(`doughballWeightOz=${ctx.doughballWeightOz}`);
    if (parts.length) {
      lines.push("RUN CONTEXT:");
      lines.push(`  ${parts.join(" ")}`);
      lines.push("");
    }
  }

  lines.push("RECIPES:");
  if (input.recipes.length === 0) {
    lines.push("  (none — no recipe has been configured for this run yet)");
  } else {
    for (const r of input.recipes) {
      const name = r.name.trim() ? ` "${r.name.trim()}"` : "";
      const idTag = r.id?.trim() ? `id=${r.id.trim()} ` : "";
      lines.push(`  [${idTag}${r.kind}]${name}`);
      lines.push(fmtRows(r.rows));
    }
  }

  const names = (input.ingredientNames ?? []).map((n) => n.trim()).filter(Boolean);
  if (names.length) {
    lines.push("");
    lines.push("KNOWN INGREDIENTS (use these names for substitutions):");
    lines.push(names.join(", "));
  }

  lines.push("");
  lines.push(`QUESTION: ${input.question}`);
  lines.push("");
  lines.push(
    "Return ONLY JSON of the exact shape: " +
      '{"answer":string,"note":string,"suggestion":object|null}. ' +
      'Put your plain-language reply in "answer". ' +
      'If the data above does not let you answer, set "answer" to a brief honest ' +
      'explanation that you cannot answer from the available data, and put what ' +
      'extra information would be needed in "note". Otherwise leave "note" empty.',
  );
  lines.push(
    "When the question asks to SCALE a recipe or SUBSTITUTE an ingredient AND " +
      "the data lets you produce the exact resulting ingredient rows, ALSO fill " +
      '"suggestion" so the worker can apply it in one tap (they still confirm): ' +
      '{"kind":"scale"|"substitute","recipeId":string,"recipeName":string,' +
      '"summary":string,"rows":[{"ingredient":string,"lbs":number}]}. ' +
      'Set "recipeId" to the id of the changed recipe, copied EXACTLY from its ' +
      "[id=...] tag above. " +
      'Set "summary" to a short button label (e.g. "Apply scaled dough 1.5x" or ' +
      '"Replace Flour with Bread Flour"). ' +
      'Set "rows" to the COMPLETE new set of ingredient rows for that recipe ' +
      "after the change — include EVERY row, not just the ones that changed. " +
      'For an EXPLAIN question, or if you are not certain of the exact rows or ' +
      'the recipe id, set "suggestion" to null. Never include a suggestion you ' +
      "are unsure about.",
  );

  return { system, user: lines.join("\n") };
}

// The model returns JSON but isn't trustworthy. Parse leniently: prefer a
// well-formed {answer, note}; if parsing fails entirely, fall back to using the
// raw content as the answer so a stray formatting slip never drops a real reply.
export function sanitizeRecipeAnswer(
  content: string,
  knownRecipeIds?: ReadonlySet<string>,
): { answer: string; note?: string; suggestion?: RecipeSuggestion } {
  const raw = (content ?? "").trim();
  if (!raw) return { answer: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  }

  const ResponseSchema = z.object({
    answer: z.coerce.string().optional(),
    note: z.coerce.string().optional(),
    suggestion: z.unknown().optional(),
  });
  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  }
  const answer = clamp(result.data.answer ?? "", MAX_ANSWER_CHARS);
  const note = clamp(result.data.note ?? "", MAX_NOTE_CHARS);
  const suggestion = sanitizeSuggestion(result.data.suggestion, knownRecipeIds);
  // If the model produced neither an answer nor a note, fall back to the raw
  // content so we never return an empty reply for a non-empty response.
  if (!answer && !note && !suggestion) return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  return {
    answer,
    ...(note ? { note } : {}),
    ...(suggestion ? { suggestion } : {}),
  };
}

// Validate a model-proposed structured suggestion. The model is untrusted, so be
// strict: only "scale"/"substitute", the recipeId must name a recipe we actually
// sent (when the caller supplies the known ids), and the rows must be real
// (non-blank ingredient, finite non-negative pounds). Anything off → drop the
// whole suggestion so the worker only ever sees an applyable, on-target edit.
function sanitizeSuggestion(
  value: unknown,
  knownRecipeIds?: ReadonlySet<string>,
): RecipeSuggestion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const Schema = z.object({
    kind: z.coerce.string().optional(),
    recipeId: z.coerce.string().optional(),
    recipeName: z.coerce.string().optional(),
    summary: z.coerce.string().optional(),
    rows: z
      .array(z.object({ ingredient: z.coerce.string(), lbs: z.coerce.number() }))
      .optional(),
  });
  const parsed = Schema.safeParse(value);
  if (!parsed.success) return undefined;

  const kind = parsed.data.kind?.trim().toLowerCase();
  if (kind !== "scale" && kind !== "substitute") return undefined;

  const recipeId = parsed.data.recipeId?.trim();
  if (!recipeId) return undefined;
  if (knownRecipeIds && !knownRecipeIds.has(recipeId)) return undefined;

  const rows = (parsed.data.rows ?? [])
    .map((r) => ({ ingredient: r.ingredient.trim(), lbs: r.lbs }))
    .filter((r) => r.ingredient && Number.isFinite(r.lbs) && r.lbs >= 0)
    .slice(0, MAX_ROWS_PER_RECIPE);
  if (rows.length === 0) return undefined;

  return {
    kind,
    recipeId,
    recipeName: clamp(parsed.data.recipeName ?? "", MAX_NAME_CHARS),
    summary: clamp(parsed.data.summary ?? "", MAX_SUMMARY_CHARS),
    rows,
  };
}
