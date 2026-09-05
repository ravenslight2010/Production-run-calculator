import type { FormValues, RunMeta, HistoryDay } from "./types";
import { buildOptimizeRun, type OptimizeScheduledRun } from "./aiOptimize";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";
import type { AiStatus } from "./aiStatus";

// AI demand-forecast client (raw fetch, matches aiOptimize.ts). Shapes recent
// FINISHED history grouped by day plus any scheduled future runs, sends them to
// /ai/forecast, and renders the suggested plan. Kept in lockstep with the mobile
// context/aiForecast.ts so both platforms send identically-shaped data and show
// the same card (replit.md parity rule).

// ── Types (mirror the OpenAPI /ai/forecast contract) ─────────────────────────
export type ForecastConfidence = "high" | "medium" | "low";

export type ForecastHistoryRun = {
  brand: string;
  flavor: string;
  dieType: string;
  cases: number;
  netRunMin: number;
};

export type ForecastHistoryDay = {
  date: string;
  runs: ForecastHistoryRun[];
};

export type ForecastInput = {
  targetDate: string;
  horizonDays?: number;
  nowMs: number;
  history: ForecastHistoryDay[];
  scheduledRuns: OptimizeScheduledRun[];
};

export type ForecastRun = {
  brand: string;
  flavor: string;
  dieType: string;
  casesNeeded: number;
  rationale: string;
};

export type ForecastPlan = {
  targetDate: string;
  confidence: ForecastConfidence;
  summary: string;
  runs: ForecastRun[];
};

export type ForecastResult = {
  forecast: ForecastPlan | null;
  forecasts?: ForecastPlan[];
  generatedAt: number;
  note?: string;
  aiStatus?: AiStatus;
};

export type ForecastScheduledDayInput = {
  date: string;
  runs: { brand: string; flavor: string; casesNeeded: number; dieType?: string }[];
};

// ── Forecast-accuracy types (mirror the OpenAPI /ai/forecast-accuracy contract) ─
export type ForecastAccuracyProductStatus = "hit" | "over" | "under" | "missed" | "unexpected";

export type ForecastAccuracyProduct = {
  label: string;
  predictedCases: number;
  actualCases: number;
  status: ForecastAccuracyProductStatus;
};

export type ForecastAccuracyReview = {
  date: string;
  confidence: ForecastConfidence;
  predictedTotalCases: number;
  actualTotalCases: number;
  caseAccuracyPct: number;
  products: ForecastAccuracyProduct[];
};

export type ForecastAccuracyTrendProduct = {
  label: string;
  daysOver: number;
  daysUnder: number;
  daysScored: number;
};

export type ForecastAccuracyTrend = {
  daysScored: number;
  averageCaseAccuracyPct: number;
  chronicOver: ForecastAccuracyTrendProduct[];
  chronicUnder: ForecastAccuracyTrendProduct[];
};

export type ForecastAccuracyInput = {
  nowMs: number;
  history: ForecastHistoryDay[];
};

export type ForecastAccuracyResult = {
  reviews: ForecastAccuracyReview[];
  trend: ForecastAccuracyTrend;
  generatedAt: number;
  note?: string;
  aiStatus?: AiStatus;
};

// Shape only the FINISHED history into the compact forecast-history shape — the
// single mapping shared by both the forecast input and the accuracy input so the
// two features can never disagree about what "actual" history is.
function buildForecastHistory(args: {
  nowMs: number;
  history: HistoryDay[];
  runValuesForHistory: (day: HistoryDay, run: RunMeta) => FormValues | undefined;
}): ForecastHistoryDay[] {
  const history: ForecastHistoryDay[] = [];
  for (const day of args.history) {
    const runs: ForecastHistoryRun[] = [];
    for (const run of day.runs) {
      const vals = args.runValuesForHistory(day, run);
      if (!vals) continue;
      const o = buildOptimizeRun(run, vals, args.nowMs);
      if (o.status !== "finished") continue;
      runs.push({
        brand: o.brand,
        flavor: o.flavor,
        dieType: o.dieType,
        cases: o.casesMade,
        netRunMin: Math.round(o.netElapsedSec / 60),
      });
    }
    if (runs.length) history.push({ date: day.date, runs });
  }
  return history;
}

// Build the wire input. Only FINISHED runs carry usable demand signal, so each
// history run is shaped through the shared buildOptimizeRun (keeping cases/net
// minutes consistent with the optimize/ask features) and the finished ones are
// mapped to the compact forecast history shape.
export function buildForecastInput(args: {
  targetDate: string;
  horizonDays?: number;
  nowMs: number;
  history: HistoryDay[];
  runValuesForHistory: (day: HistoryDay, run: RunMeta) => FormValues | undefined;
  scheduledDays: ForecastScheduledDayInput[];
}): ForecastInput {
  const history = buildForecastHistory(args);

  const scheduledRuns: OptimizeScheduledRun[] = [];
  for (const day of args.scheduledDays) {
    for (const r of day.runs) {
      scheduledRuns.push({
        date: day.date,
        brand: r.brand,
        flavor: r.flavor,
        dieType: r.dieType ?? "",
        casesNeeded: r.casesNeeded,
      });
    }
  }

  return {
    targetDate: args.targetDate,
    ...(args.horizonDays != null ? { horizonDays: args.horizonDays } : {}),
    nowMs: args.nowMs,
    history,
    scheduledRuns,
  };
}

// ── API client (raw fetch, matches inventoryShared) ──────────────────────────
export async function requestForecast(input: ForecastInput): Promise<ForecastResult> {
  const res = await fetch("/api/ai/forecast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSec =
      retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
    let serverMessage: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON error body; ignore
    }
    throw new InventoryApiError(
      res.status,
      `Forecast request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as ForecastResult;
}

// Build the accuracy wire input — just the FINISHED actual history (the server
// reads the recorded forecasts itself). Reuses the same history mapping as the
// forecast input so "actual" means exactly the same thing in both features.
export function buildForecastAccuracyInput(args: {
  nowMs: number;
  history: HistoryDay[];
  runValuesForHistory: (day: HistoryDay, run: RunMeta) => FormValues | undefined;
}): ForecastAccuracyInput {
  return { nowMs: args.nowMs, history: buildForecastHistory(args) };
}

export async function requestForecastAccuracy(
  input: ForecastAccuracyInput,
): Promise<ForecastAccuracyResult> {
  const res = await fetch("/api/ai/forecast-accuracy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSec =
      retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
    let serverMessage: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON error body; ignore
    }
    throw new InventoryApiError(
      res.status,
      `Accuracy request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as ForecastAccuracyResult;
}

// Reuse the photo endpoint's friendly 429/413 messaging for parity.
export const forecastErrorMessage = photoErrorMessage;
