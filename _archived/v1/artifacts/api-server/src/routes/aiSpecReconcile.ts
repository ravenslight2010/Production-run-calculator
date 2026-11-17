import { OperationsSpecReconciliationBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  type Discrepancy,
  type ProfileDiscrepancy,
  type ReconcileRecipe,
  type ReconcileProfile,
  formatDiscrepanciesForPrompt,
  formatProfileDiscrepanciesForPrompt,
} from "@workspace/spec-reconcile";

// Bounds for the deterministic spec reconciliation request.
export const MAX_CURRENT_RECIPES = 400;
export const MAX_ROWS_PER_RECIPE = 200;
export const MAX_CURRENT_PROFILES = 400;
export const MAX_SUMMARY_CHARS = 1500;
export const MAX_DISCREPANCIES_IN_PROMPT = 200;

export type SpecReconcileInput = z.infer<typeof OperationsSpecReconciliationBody>;

export type SpecReconcileValidationResult =
  | { ok: true; data: SpecReconcileInput }
  | { ok: false; status: number; error: string };

// Validate POST /operations-insights/spec-reconciliation. The body carries the
// saved spec-sheet id plus the app's current recipe library.
export function validateSpecReconcileBody(body: unknown): SpecReconcileValidationResult {
  const parsed = OperationsSpecReconciliationBody.safeParse(body);
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
  if ((parsed.data.currentProfiles?.length ?? 0) > MAX_CURRENT_PROFILES) {
    return { ok: false, status: 400, error: `Too many profiles (max ${MAX_CURRENT_PROFILES})` };
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

// Map the generated body's optional profiles down to the pure lib's
// ReconcileProfile shape. Absent (older clients) → empty list, so the profile
// diff simply reports nothing and only recipes are compared.
export function toCurrentReconcileProfiles(input: SpecReconcileInput): ReconcileProfile[] {
  return (input.currentProfiles ?? []).map((p) => ({
    brand: p.brand,
    flavor: p.flavor,
    dieType: p.dieType,
    sauceOzPerPizza: p.sauceOzPerPizza,
    applicators: (p.applicators ?? []).map((a) => ({ type: a.type, ozPerPizza: a.ozPerPizza })),
    pepperonis: (p.pepperonis ?? []).map((pp) => ({
      type: pp.type,
      sticks: pp.sticks,
      ozPerPizza: pp.ozPerPizza,
    })),
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
  profileDiscrepancies: ReadonlyArray<ProfileDiscrepancy> = [],
): { system: string; user: string } {
  const system =
    "You are a helpful assistant for floor staff at a frozen-pizza factory. " +
    "A saved spec sheet has been compared, in code, against the factory's " +
    "current saved recipes AND profiles (die type, sauce oz/pizza, applicator " +
    "and pepperoni settings). You are given the EXACT list of discrepancies that " +
    "comparison found. Write a short, plain-language summary for a worker: say " +
    "whether the current setup matches the spec sheet, and if not, group and " +
    "explain the differences clearly (missing recipes, missing or extra " +
    "ingredients, pound mismatches, and profile differences like die type, sauce, " +
    "applicators, and pepperonis). Be concrete and quantitative using ONLY " +
    "the discrepancies listed — never invent, guess, or add a discrepancy that " +
    "isn't in the list, and never claim something matches when a discrepancy is " +
    "listed for it. You are ADVISORY ONLY: never claim to have changed, fixed, " +
    "or applied anything — you only explain what differs so the worker can " +
    "decide what to do.";

  const total = discrepancies.length + profileDiscrepancies.length;
  const lines: string[] = [];
  lines.push(`SPEC SHEET: "${label}"`);
  lines.push("");
  if (total === 0) {
    lines.push(
      "DISCREPANCIES: none. Every recipe and profile on this spec sheet matches " +
        "the current saved recipes and profiles exactly.",
    );
    lines.push("");
    lines.push(
      "Confirm to the worker, in one or two short sentences, that the current " +
        "recipes and profiles fully match this spec sheet.",
    );
  } else {
    lines.push(`DISCREPANCIES (${total} found — the only facts you may use):`);
    // One shared budget across recipe + profile lines so a paid AI route can't be
    // pushed to ~2× the intended cap by having both lists near the limit.
    const recipeSlice = discrepancies.slice(0, MAX_DISCREPANCIES_IN_PROMPT);
    const profileBudget = Math.max(0, MAX_DISCREPANCIES_IN_PROMPT - recipeSlice.length);
    const recipeLines = formatDiscrepanciesForPrompt(recipeSlice);
    if (recipeLines) lines.push(recipeLines);
    const profileLines = formatProfileDiscrepanciesForPrompt(
      profileDiscrepancies.slice(0, profileBudget),
    );
    if (profileLines) lines.push(profileLines);
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
