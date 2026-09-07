import { OperationsScheduleOrderingBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  optimizeSchedule,
  buildSchedulePromptBlock,
  type ScheduleRun,
  type ScheduleOptimizeResult as LibScheduleOptimizeResult,
} from "@workspace/schedule-optimize";
import type { ProductionRule } from "@workspace/production-rules";

// Operations Insights schedule ordering. Given the runs planned for one day,
// the server deterministically proposes an ordering (allergen runs end-of-day,
// same brand/die grouped to minimize changeovers, and factory sequence rules
// honored). Read-only and advisory; never writes the schedule.

export type ScheduleOptimizeInput = z.infer<typeof OperationsScheduleOrderingBody>;

// Bound how many runs one request can carry so a single call can't blow up cost
// or latency. Mirrors the other AI endpoint guards.
export const SCHEDULE_MAX_RUNS = 500;
// Upper bound on the narrated summary length (defensive clamp on model output).
export const SCHEDULE_MAX_CHARS = 1200;

export type ScheduleValidationResult =
  | { ok: true; data: ScheduleOptimizeInput }
  | { ok: false; status: number; error: string };

export function validateScheduleBody(body: unknown): ScheduleValidationResult {
  const parsed = OperationsScheduleOrderingBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid schedule input" };
  }
  if ((parsed.data.runs?.length ?? 0) > SCHEDULE_MAX_RUNS) {
    return {
      ok: false,
      status: 400,
      error: `Too many runs (max ${SCHEDULE_MAX_RUNS})`,
    };
  }
  return { ok: true, data: parsed.data };
}

/** Map the validated wire input to the shared lib's run shape. */
export function toScheduleRuns(input: ScheduleOptimizeInput): ScheduleRun[] {
  return (input.runs ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    brand: r.brand,
    flavor: r.flavor,
    allergen: r.allergen,
    dieType: r.dieType,
  }));
}

/** Map the validated wire input to the shared production-rules shape. */
export function toScheduleRules(input: ScheduleOptimizeInput): ProductionRule[] {
  return ((input.rules ?? []) as unknown[]).map((r) => r as ProductionRule);
}

export function buildSchedulePrompt(result: LibScheduleOptimizeResult): {
  system: string;
  user: string;
} {
  const system =
    "You are a production-floor assistant for a frozen-pizza factory. " +
    "You are given a block of FACTS: a deterministic SUGGESTED run order for " +
    "one day that schedules allergen runs at the end of the day, groups similar " +
    "brand/die runs together to cut line changeovers, and honors factory " +
    "sequence rules, along with the before/after issue counts. Narrate ONLY " +
    "those facts in 2–4 short sentences for floor staff and managers: explain " +
    "why the suggested order is better (fewer changeovers, allergen runs last, " +
    "fewer rule issues), referring to runs by their labels. Never invent " +
    "numbers, products, or reasons the facts do not support, and never suggest " +
    "formula or recipe changes. This is an advisory suggestion the manager can " +
    "choose to apply. " +
    'Respond with a JSON object of the form {"summary": "<your narration>"}.';

  const user =
    "FACTS:\n" +
    buildSchedulePromptBlock(result) +
    '\n\nReturn JSON: {"summary": "<2-4 sentence plain-language explanation>"}';

  return { system, user };
}

const ResponseSchema = z.object({ summary: z.string() });

/**
 * Pull a clean, length-clamped narration string out of the (untrusted) model
 * JSON. Returns null when the output is unusable so the caller can fall back to
 * an empty narration (the deterministic suggested order still stands on its own).
 */
export function sanitizeScheduleSummary(raw: unknown): string | null {
  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const text = parsed.data.summary.trim();
  if (!text) return null;
  return text.length > SCHEDULE_MAX_CHARS
    ? text.slice(0, SCHEDULE_MAX_CHARS).trimEnd()
    : text;
}

export { optimizeSchedule };
