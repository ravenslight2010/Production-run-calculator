import {
  buildDaySummaryInput,
  buildWeekSummaryInput,
  type SummaryRunInput,
} from "./aiSummary";
import type { AnomalyRunInput } from "./inventoryShared";
import type { HistoryDay, RunState } from "./RunContext";

// AI predictive-maintenance / anomaly-check client builder. EXACT mirror of the
// web src/aiAnomaly.ts: reuses the shared summary run-shaping (buildOptimizeRun →
// SummaryRunInput) so the numbers stay consistent with the recap/forecast
// features, then maps to the compact anomaly run shape. Kept in lockstep with the
// web builder so both platforms send identically-shaped data (replit.md parity).

function toAnomalyRun(r: SummaryRunInput): AnomalyRunInput {
  return {
    brand: r.brand,
    flavor: r.flavor,
    casesPlanned: r.casesPlanned,
    casesProduced: r.casesProduced,
    downtimeMinutes: r.downtimeMinutes,
    stoppageCount: r.stoppageCount,
  };
}

// Build the anomaly-check input: today's FINISHED runs vs. all recent FINISHED
// history runs as the baseline. Only finished runs are compared so in-progress
// runs (which have a low produced count) don't read as false anomalies.
export function buildAnomalyInput(args: {
  date: string;
  nowMs: number;
  runs: RunState[];
  history: HistoryDay[];
}): { today: AnomalyRunInput[]; history: AnomalyRunInput[] } {
  const today = buildDaySummaryInput({
    date: args.date,
    nowMs: args.nowMs,
    runs: args.runs,
  })
    .runs.filter((r) => r.finished)
    .map(toAnomalyRun);
  const history = buildWeekSummaryInput({
    date: args.date,
    nowMs: args.nowMs,
    history: args.history,
  })
    .runs.filter((r) => r.finished)
    .map(toAnomalyRun);
  return { today, history };
}
