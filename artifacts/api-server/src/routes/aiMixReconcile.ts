import { OperationsMixReconciliationBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  type MixDiscrepancy,
  formatMixDiscrepanciesForPrompt,
} from "@workspace/mix-reconcile";

// Bounds for the mix-reconcile AI summary, in the same spirit as the other AI
// endpoints: cap how much the model is asked to read and how much it returns so
// a single request can't blow up cost/latency.
export const MAX_SUMMARY_CHARS = 1500;
export const MAX_DISCREPANCIES_IN_PROMPT = 300;
export const MAX_DISCREPANCIES = 600;
export const MAX_LABEL_CHARS = 200;

export type MixReconcileInput = z.infer<typeof OperationsMixReconciliationBody>;

export type MixReconcileValidationResult =
  | { ok: true; data: MixReconcileInput }
  | { ok: false; status: number; error: string };

// Validate POST /ai/mix-reconcile. Unlike spec-reconcile (which loads a saved
// sheet and diffs server-side), the deterministic mix diff already ran on the
// client — the body carries the EXACT discrepancy list and the AI only narrates
// it. Validate the envelope with the generated schema, then enforce the cost cap.
export function validateMixReconcileBody(body: unknown): MixReconcileValidationResult {
  const parsed = OperationsMixReconciliationBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  if (parsed.data.discrepancies.length > MAX_DISCREPANCIES) {
    return {
      ok: false,
      status: 400,
      error: `Too many discrepancies (max ${MAX_DISCREPANCIES})`,
    };
  }
  return { ok: true, data: parsed.data };
}

// Map the generated body's discrepancies down to the pure lib's MixDiscrepancy
// shape. The zod schema has already guaranteed the fields, so a direct map keeps
// it simple and lets the lib's formatter do the prompt shaping.
export function toMixDiscrepancies(input: MixReconcileInput): MixDiscrepancy[] {
  return input.discrepancies.map((d) => ({
    source: d.source,
    type: d.type,
    brand: d.brand,
    flavor: d.flavor,
    mixName: d.mixName,
    ...(d.ingredient != null ? { ingredient: d.ingredient } : {}),
    ...(d.sheetPerPizza != null ? { sheetPerPizza: d.sheetPerPizza } : {}),
    ...(d.mixPerPizza != null ? { mixPerPizza: d.mixPerPizza } : {}),
    message: d.message,
  }));
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

// Shape the deterministic discrepancy list into a compact, model-friendly prompt
// for a plain-language summary. The diff is already done in code; the AI only
// narrates it, so it can never invent or miss a discrepancy.
export function buildMixReconcilePrompt(
  label: string,
  discrepancies: ReadonlyArray<MixDiscrepancy>,
): { system: string; user: string } {
  const system =
    "You are a helpful assistant for floor staff at a frozen-pizza factory. " +
    "The factory's current mixes (manager-defined ingredient blends) have been " +
    "compared, in code, against the imported premix sheets and spec sheets. You " +
    "are given the EXACT list of discrepancies that comparison found. Write a " +
    "short, plain-language summary for a worker: say whether the current mixes " +
    "match the sheets, and if not, group and explain the differences clearly " +
    "(products that need a NEW mix, missing or extra ingredients in a mix, and " +
    "amount mismatches). Be concrete and quantitative using ONLY the " +
    "discrepancies listed — never invent, guess, or add a discrepancy that isn't " +
    "in the list, and never claim something matches when a discrepancy is listed " +
    "for it. You are ADVISORY ONLY: never claim to have changed, fixed, or " +
    "applied anything — you only explain what differs so the worker can decide " +
    "what to do.";

  const lines: string[] = [];
  const safeLabel = clamp(label, MAX_LABEL_CHARS) || "imported sheets";
  lines.push(`COMPARED AGAINST: "${safeLabel}"`);
  lines.push("");
  if (discrepancies.length === 0) {
    lines.push(
      "DISCREPANCIES: none. Every current mix matches the imported sheets " +
        "exactly (same ingredients, same amounts), and no product is missing a mix.",
    );
    lines.push("");
    lines.push(
      "Confirm to the worker, in one or two short sentences, that the current " +
        "mixes fully match the imported sheets.",
    );
  } else {
    lines.push(
      `DISCREPANCIES (${discrepancies.length} found — the only facts you may use):`,
    );
    lines.push(
      formatMixDiscrepanciesForPrompt(
        discrepancies.slice(0, MAX_DISCREPANCIES_IN_PROMPT) as MixDiscrepancy[],
      ),
    );
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
export function sanitizeMixReconcileSummary(content: string): string {
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
