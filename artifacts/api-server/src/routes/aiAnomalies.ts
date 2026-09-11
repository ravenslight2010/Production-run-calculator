import { OperationsAnomalyDetectionBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  detectAnomalies,
  type AnomalyInput as LibAnomalyInput,
} from "@workspace/anomaly";

// Deterministic predictive-maintenance / anomaly detection. Given today's finished runs
// plus recent finished-run history, the server DETERMINISTICALLY flags runs that
// drifted from a per-product baseline (downtime/yield/stoppages, shared
// @workspace/anomaly lib). Read-only and advisory; never writes run data.

export type AnomalyInput = z.infer<typeof OperationsAnomalyDetectionBody>;

// Bound how many runs one request can carry so a single call can't blow up cost
// or latency. Mirrors the other AI endpoint guards.
export const ANOMALY_MAX_RUNS = 1500;

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

export { detectAnomalies };
