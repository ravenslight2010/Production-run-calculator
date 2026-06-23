import { AiSpecReconcileBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  type Discrepancy,
  type ReconcileRecipe,
  formatDiscrepanciesForPrompt,
} from "@workspace/spec-reconcile";

// Bounds for the spec-reconcile AI summary, in the same spirit as the other AI
// endpoints: cap how much the model is asked to read and how much it returns so
// a single request can't blow up cost/latency.
export const MAX_CURRENT_RECIPES = 400;
export const MAX_ROWS_PER_RECIPE = 200;
export const MAX_SUMMARY_CHARS = 1500;
export const MAX_DISCREPANCIES_IN_PROMPT = 200;

export type SpecReconcileInput = z.infer<typeof AiSpecReconcileBody>;

export type SpecReconcileValidationResult =
  | { ok: true; data: SpecReconcileInput }
  | { ok: false; status: number; error: string };

// Validate POST /ai/spec-reconcile. The body carries the saved spec-sheet id to
// check against plus the app's current recipe library. Validate the envelope
// with the generated schema, then enforce the cost caps.
export function validateSpecReconcileBody(body: unknown): SpecReconcileValidationResult {
  const parsed = AiSpecReconcileBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  if (!Number.isInteger(parsed.data.specSheetId)) {
    return { ok: false, status: 400, error: "specSheetId is required" };
  }
  if (parsed.data.currentRecipes.length > MAX_CURRENT_RECIPES) {
    return { ok: false, status: 400, error: `Too many recipes (max ${MAX_CURRENT_RECIPES})` };
  }
  for (const r of parsed.data.currentRecipes) {
    if (r.rows.length > MAX_ROWS_PER_RECIPE) {
      return {
        ok: false,
        status: 400,
        error: `A recipe has too many rows (max ${MAX_ROWS_PER_RECIPE})`,
      };
    }
  }
  return { ok: true, data: parsed.data };
}

// Map the generated body's recipes (which allow extra fields) down to the pure
// lib's ReconcileRecipe shape. The lib's own toReconcileRecipes covers loose
// input, but here the zod schema has already guaranteed kind/name/rows, so a
// direct map keeps it simple.
export function toCurrentReconcileRecipes(input: SpecReconcileInput): ReconcileRecipe[] {
  return input.currentRecipes.map((r) => ({
    kind: r.kind,
    name: r.name,
    rows: r.rows.map((row) => ({ ingredient: row.ingredient, lbs: row.lbs })),
  }));
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

// Shape the deterministic discrepancy list into a compact, model-friendly prompt
// for a plain-language summary. The diff is already done in code; the AI only
// narrates it, so it can never invent or miss a discrepancy.
export function buildSpecReconcilePrompt(
  label: string,
  discrepancies: ReadonlyArray<Discrepancy>,
): { system: string; user: string } {
  const system =
    "You are a helpful assistant for floor staff at a frozen-pizza factory. " +
    "A saved spec sheet has been compared, in code, against the factory's " +
    "current saved recipes. You are given the EXACT list of discrepancies that " +
    "comparison found. Write a short, plain-language summary for a worker: say " +
    "whether the current recipes match the spec sheet, and if not, group and " +
    "explain the differences clearly (missing recipes, missing or extra " +
    "ingredients, and pound mismatches). Be concrete and quantitative using ONLY " +
    "the discrepancies listed — never invent, guess, or add a discrepancy that " +
    "isn't in the list, and never claim something matches when a discrepancy is " +
    "listed for it. You are ADVISORY ONLY: never claim to have changed, fixed, " +
    "or applied anything — you only explain what differs so the worker can " +
    "decide what to do.";

  const lines: string[] = [];
  lines.push(`SPEC SHEET: "${label}"`);
  lines.push("");
  if (discrepancies.length === 0) {
    lines.push(
      "DISCREPANCIES: none. Every recipe on this spec sheet matches the current " +
        "saved recipes exactly (same ingredients, same pounds).",
    );
    lines.push("");
    lines.push(
      "Confirm to the worker, in one or two short sentences, that the current " +
        "recipes fully match this spec sheet.",
    );
  } else {
    lines.push(`DISCREPANCIES (${discrepancies.length} found — the only facts you may use):`);
    lines.push(formatDiscrepanciesForPrompt(discrepancies.slice(0, MAX_DISCREPANCIES_IN_PROMPT)));
    lines.push("");
    lines.push(
      'Return ONLY JSON of the exact shape {"summary":string}. Put a short, ' +
        "clearly-grouped plain-language explanation of these discrepancies in " +
        '"summary".',
    );
  }
  return { system, user: lines.join("\n") };
}

// The model returns JSON but isn't trustworthy. Parse leniently: prefer a
// well-formed {summary}; if parsing fails entirely, fall back to using the raw
// content so a stray formatting slip never drops a real summary.
export function sanitizeSpecReconcileSummary(content: string): string {
  const raw = (content ?? "").trim();
  if (!raw) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return clamp(raw, MAX_SUMMARY_CHARS);
  }
  const Schema = z.object({ summary: z.coerce.string().optional() });
  const result = Schema.safeParse(parsed);
  if (!result.success) return clamp(raw, MAX_SUMMARY_CHARS);
  const summary = clamp(result.data.summary ?? "", MAX_SUMMARY_CHARS);
  return summary || clamp(raw, MAX_SUMMARY_CHARS);
}
