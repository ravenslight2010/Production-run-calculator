import { AiRecipeAssistantBody } from "@workspace/api-zod";
import * as z from "zod";

// Bounds for the recipe & ingredient helper, in the same spirit as the other AI
// endpoints: cap how much the model is asked to read and how much it can return
// so a single request can't blow up cost/latency.
export const MAX_QUESTION_CHARS = 1000;
export const MAX_ANSWER_CHARS = 2000;
export const MAX_NOTE_CHARS = 600;
export const MAX_RECIPES = 24;
export const MAX_ROWS_PER_RECIPE = 80;
export const MAX_INGREDIENT_NAMES = 600;

export type RecipeAssistInput = z.infer<typeof AiRecipeAssistantBody>;

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
      lines.push(`  [${r.kind}]${name}`);
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
      '{"answer":string,"note":string}. ' +
      'Put your plain-language reply in "answer". ' +
      'If the data above does not let you answer, set "answer" to a brief honest ' +
      'explanation that you cannot answer from the available data, and put what ' +
      'extra information would be needed in "note". Otherwise leave "note" empty.',
  );

  return { system, user: lines.join("\n") };
}

// The model returns JSON but isn't trustworthy. Parse leniently: prefer a
// well-formed {answer, note}; if parsing fails entirely, fall back to using the
// raw content as the answer so a stray formatting slip never drops a real reply.
export function sanitizeRecipeAnswer(content: string): { answer: string; note?: string } {
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
  });
  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  }
  const answer = clamp(result.data.answer ?? "", MAX_ANSWER_CHARS);
  const note = clamp(result.data.note ?? "", MAX_NOTE_CHARS);
  // If the model produced neither an answer nor a note, fall back to the raw
  // content so we never return an empty reply for a non-empty response.
  if (!answer && !note) return { answer: clamp(raw, MAX_ANSWER_CHARS) };
  return note ? { answer, note } : { answer };
}
