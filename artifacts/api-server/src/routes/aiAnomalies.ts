import { OperationsAnomalyDetectionBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  detectAnomalies,
  buildAnomalyPromptBlock,
  type AnomalyInput as LibAnomalyInput,
  type AnomalyResult as LibAnomalyResult,
} from "@workspace/anomaly";

// AI predictive-maintenance / anomaly narration. Given today's finished runs
// plus recent finished-run history, the server DETERMINISTICALLY flags runs that
// drifted from a per-product baseline (downtime/yield/stoppages, shared
// @workspace/anomaly lib). The model is only asked to NARRATE the flagged
// anomalies into a short plain-language summary — and only when at least one
// anomaly is flagged (no flags → no AI call), mirroring the waste-insight
// posture. Read-only and advisory; never writes run data. Fail-safe: if the AI
// is unavailable or returns nothing usable, the deterministic anomaly list is
// still returned with an empty narration.

export type AnomalyInput = z.infer<typeof OperationsAnomalyDetectionBody>;

// Bound how many runs one request can carry so a single call can't blow up cost
// or latency. Mirrors the other AI endpoint guards.
export const ANOMALY_MAX_RUNS = 1500;
// Upper bound on the narrated summary length (defensive clamp on model output).
export const ANOMALY_MAX_CHARS = 1200;

export type AnomalyValidationResult =
  | { ok: true; data: AnomalyInput }
  | { ok: false; status: number; error: string };

export function validateAnomalyBody(body: unknown): AnomalyValidationResult {
  const parsed = OperationsAnomalyDetectionBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid anomaly input" };
  }
  const total = (parsed.data.today?.length ?? 0) + (parsed.data.history?.length ?? 0);
  if (total > ANOMALY_MAX_RUNS) {
    return {
      ok: false,
      status: 400,
      error: `Too many runs (max ${ANOMALY_MAX_RUNS})`,
    };
  }
  return { ok: true, data: parsed.data };
}

/** Map the validated wire input to the shared lib's detection input. */
export function toAnomalyDetectInput(input: AnomalyInput): LibAnomalyInput {
  const map = (r: AnomalyInput["today"][number]) => ({
    brand: r.brand,
    flavor: r.flavor,
    casesPlanned: r.casesPlanned,
    casesProduced: r.casesProduced,
    downtimeMinutes: r.downtimeMinutes,
    stoppageCount: r.stoppageCount,
  });
  return {
    today: (input.today ?? []).map(map),
    history: (input.history ?? []).map(map),
  };
}

export function buildAnomalyPrompt(result: LibAnomalyResult): {
  system: string;
  user: string;
} {
  const system =
    "You are a production-floor assistant for a frozen-pizza factory. " +
    "You are given a block of FACTS: a deterministic list of production runs " +
    "today that drifted from their historical norm (more downtime, lower yield, " +
    "or more stoppages than usual). Narrate ONLY those facts in 2–4 short " +
    "sentences for floor staff and managers: which runs look off and on which " +
    "measure, leading with the most severe. You may suggest a calm, generic " +
    "next step like checking the line or equipment, but never invent numbers, " +
    "products, or causes the facts do not support, and never suggest formula or " +
    "recipe changes. Be factual and calm; this is an advisory heads-up only. " +
    'Respond with a JSON object of the form {"summary": "<your narration>"}.';

  const user =
    "FACTS:\n" +
    buildAnomalyPromptBlock(result) +
    '\n\nReturn JSON: {"summary": "<2-4 sentence plain-language heads-up>"}';

  return { system, user };
}

const ResponseSchema = z.object({ summary: z.string() });

/**
 * Pull a clean, length-clamped narration string out of the (untrusted) model
 * JSON. Returns null when the output is unusable so the caller can fall back to
 * an empty narration (the deterministic anomaly list still stands on its own).
 */
export function sanitizeAnomalySummary(raw: unknown): string | null {
  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const text = parsed.data.summary.trim();
  if (!text) return null;
  return text.length > ANOMALY_MAX_CHARS
    ? text.slice(0, ANOMALY_MAX_CHARS).trimEnd()
    : text;
}

export { detectAnomalies };
