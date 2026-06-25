import { AiSummaryBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  aggregateDaySummary,
  buildSummaryPromptBlock,
  type DaySummaryInput,
  type DaySummaryStats,
} from "@workspace/day-summary";

// AI end-of-day / weekly production recap. Given a day's (or rolling week's)
// runs, the server computes the numeric stats deterministically (shared
// @workspace/day-summary lib) and the model only NARRATES them into a short,
// plain-language recap. Mirrors the other /ai/* endpoints' posture: heavy shaping
// is deterministic and server-side, the model output is untrusted and length-
// clamped, and the feature is fail-safe — if the AI is unavailable or returns
// nothing usable, a deterministic fallback summary (also from the lib) is used so
// the caller always gets a usable recap. Read-only; never writes run data.

export type SummaryInput = z.infer<typeof AiSummaryBody>;

// Bound how many runs one request can carry so a single call can't blow up cost
// or latency. Mirrors the other AI endpoint guards.
export const SUMMARY_MAX_RUNS = 600;
// Upper bound on the narrated recap length (defensive clamp on model output).
export const SUMMARY_MAX_CHARS = 1200;

export type SummaryValidationResult =
  | { ok: true; data: SummaryInput }
  | { ok: false; status: number; error: string };

export function validateSummaryBody(body: unknown): SummaryValidationResult {
  const parsed = AiSummaryBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid summary input" };
  }
  if ((parsed.data.runs?.length ?? 0) > SUMMARY_MAX_RUNS) {
    return {
      ok: false,
      status: 400,
      error: `Too many runs (max ${SUMMARY_MAX_RUNS})`,
    };
  }
  return { ok: true, data: parsed.data };
}

/** Map the validated wire input to the shared lib's aggregation input. */
export function toSummaryAggInput(input: SummaryInput): DaySummaryInput {
  return {
    scope: input.scope === "week" ? "week" : "day",
    date: input.date,
    runs: (input.runs ?? []).map((r) => ({
      brand: r.brand,
      flavor: r.flavor,
      casesPlanned: r.casesPlanned,
      casesProduced: r.casesProduced,
      finished: r.finished,
      downtimeMinutes: r.downtimeMinutes,
      stoppageCount: r.stoppageCount,
    })),
    incidentCount: input.incidentCount,
    wasteFlaggedCount: input.wasteFlaggedCount,
  };
}

export function buildSummaryPrompt(stats: DaySummaryStats): {
  system: string;
  user: string;
} {
  const scopeWord = stats.scope === "week" ? "week" : "day";
  const system =
    "You are a production-floor assistant for a frozen-pizza factory. " +
    `Write a short, plain-language recap of this production ${scopeWord} for ` +
    "floor staff and managers. You are given a block of FACTS computed from the " +
    "day's runs. Narrate ONLY those facts in 2–4 short sentences: how much was " +
    "planned vs. produced, how the line ran (downtime/stoppages), anything that " +
    "did not finish, and any reported issues. Lead with the most important point. " +
    "Never invent numbers, products, causes, or recommendations the facts do not " +
    "support, and do not suggest formula or recipe changes. Be factual and calm; " +
    "this is an informational recap only. Respond with a JSON object of the form " +
    '{"summary": "<your recap>"}.';

  const user =
    "FACTS:\n" +
    buildSummaryPromptBlock(stats) +
    '\n\nReturn JSON: {"summary": "<2-4 sentence plain-language recap>"}';

  return { system, user };
}

const ResponseSchema = z.object({ summary: z.string() });

/**
 * Pull a clean, length-clamped recap string out of the (untrusted) model JSON.
 * Returns null when the output is unusable so the caller can fall back to the
 * deterministic summary.
 */
export function sanitizeSummary(raw: unknown): string | null {
  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const text = parsed.data.summary.trim();
  if (!text) return null;
  return text.length > SUMMARY_MAX_CHARS
    ? text.slice(0, SUMMARY_MAX_CHARS).trimEnd()
    : text;
}
