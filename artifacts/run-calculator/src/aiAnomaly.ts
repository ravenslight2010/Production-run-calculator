import type { FormValues, RunMeta, HistoryDay } from "./types";
import {
  buildDaySummaryInput,
  buildWeekSummaryInput,
  type SummaryRunInput,
} from "./aiSummary";
import type { AnomalyRunInput } from "./inventoryShared";

// AI predictive-maintenance / anomaly-check client builder. Reuses the shared
// summary run-shaping (buildShapedRun → SummaryRunInput) so the numbers stay
// consistent with the deterministic recap, then maps to the compact anomaly
// run shape. Kept in lockstep with the mobile context/aiAnomaly.ts so both
// platforms send identically-shaped data (replit.md parity rule).

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
  runs: RunMeta[];
  runValues: (run: RunMeta) => FormValues | undefined;
  history: HistoryDay[];
  runValuesForHistory: (day: HistoryDay, run: RunMeta) => FormValues | undefined;
}): { today: AnomalyRunInput[]; history: AnomalyRunInput[] } {
  const today = buildDaySummaryInput({
    date: args.date,
    nowMs: args.nowMs,
    runs: args.runs,
    runValues: args.runValues,
  })
    .runs.filter((r) => r.finished)
    .map(toAnomalyRun);
  const history = buildWeekSummaryInput({
    date: args.date,
    nowMs: args.nowMs,
    history: args.history,
    runValuesForHistory: args.runValuesForHistory,
  })
    .runs.filter((r) => r.finished)
    .map(toAnomalyRun);
  return { today, history };
}
