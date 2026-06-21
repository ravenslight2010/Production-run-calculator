import type { ReviewVerdict } from "@workspace/ai-review";
import type { FormValues, RunMeta, HistoryDay } from "./types";
import { computeSummaryStats, runLabel } from "./utils";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";

// ── Types (mirror the OpenAPI /ai/optimize contract) ─────────────────────────
export type OptimizeCategory = "run" | "break" | "efficiency";
export type OptimizeImpact = "high" | "medium" | "low";
export type RunStatus = "running" | "upcoming" | "finished";

export type OptimizeStoppage = { reason: string; durationSec: number; open: boolean };

export type OptimizeRun = {
  id: string;
  label: string;
  brand: string;
  flavor: string;
  dieType: string;
  status: RunStatus;
  casesNeeded: number;
  casesMade: number;
  casesLeft: number;
  plannedPpm: number;
  actualPpm: number | null;
  minutesRemaining: number | null;
  netElapsedSec: number;
  downtimeSec: number;
  stoppages: OptimizeStoppage[];
};

export type OptimizeScheduledRun = {
  date: string;
  brand: string;
  flavor: string;
  dieType: string;
  casesNeeded: number;
};

export type OptimizeInput = {
  date: string;
  nowMs: number;
  runToTime: string;
  todayPpm: number;
  benchmarkPpm: number | null;
  runs: OptimizeRun[];
  scheduledRuns: OptimizeScheduledRun[];
  historyRuns: OptimizeRun[];
};

export type OptimizeActionKind = "set_target_time" | "set_run_target" | "reorder_run";

export type OptimizeAction = {
  kind: OptimizeActionKind;
  label: string;
  time?: string;
  runId?: string;
  casesNeeded?: number;
  beforeRunId?: string | null;
};

export type OptimizeRecommendation = {
  category: OptimizeCategory;
  title: string;
  detail: string;
  impact: OptimizeImpact;
  appliesTo: string | null;
  action?: OptimizeAction | null;
  /** Reviewer-AI "second set of eyes" verdict (advisory; absent if unavailable). */
  review?: ReviewVerdict;
};

export type OptimizeResult = {
  recommendations: OptimizeRecommendation[];
  generatedAt: number;
  note?: string;
};

// ── Per-run shaping ──────────────────────────────────────────────────────────
// Mirrors buildRunCsvRow (downtime = stoppages with an end time that aren't
// pauses) and the live calc's planned PPM (crustsPerCycle * cycleSpeed *
// speedAdjustment). Kept in lockstep with the mobile builder so both platforms
// send the model identically-shaped data.
function plannedPpmOf(vals: FormValues): number {
  return Math.max(0, vals.crustsPerCycle * vals.cycleSpeed * vals.speedAdjustment);
}

function statusOf(run: RunMeta): RunStatus {
  if (run.endedAt) return "finished";
  if (run.startedAt) return "running";
  return "upcoming";
}

export function buildOptimizeRun(run: RunMeta, vals: FormValues, nowMs: number): OptimizeRun {
  const s = computeSummaryStats(vals);
  const status = statusOf(run);
  const ppc = vals.pizzasPerCase;

  const downtimeSec = (run.stoppages ?? [])
    .filter((st) => st.endedAt && st.type !== "pause")
    .reduce((acc, st) => acc + (st.endedAt! - st.startedAt) / 1000, 0);

  const endRef = run.endedAt ?? (run.startedAt ? nowMs : undefined);
  const grossDurSec = run.startedAt && endRef ? (endRef - run.startedAt) / 1000 : 0;
  const netElapsedSec = Math.max(0, grossDurSec - downtimeSec);

  const casesNeeded = vals.casesNeeded;
  const liveCasesMade = vals.skidsCompleted * vals.casesPerSkid + vals.casesOnCurrentSkid;
  const casesMade =
    status === "finished"
      ? run.actualCases ?? s.totalCases
      : status === "running"
        ? Math.max(0, liveCasesMade)
        : 0;
  const casesLeft = Math.max(0, casesNeeded - casesMade);

  const plannedPpm = Math.round(plannedPpmOf(vals));
  const actualPpm =
    netElapsedSec > 0 && casesMade > 0 && ppc > 0
      ? Math.round((casesMade * ppc) / (netElapsedSec / 60))
      : null;
  const minutesRemaining =
    status === "running" && casesLeft > 0 && plannedPpm > 0 && ppc > 0
      ? Math.round((casesLeft * ppc) / plannedPpm)
      : null;

  const stoppages: OptimizeStoppage[] = (run.stoppages ?? [])
    .filter((st) => st.type !== "pause")
    .map((st) => ({
      reason: st.reason || "Stoppage",
      durationSec: (st.endedAt ? st.endedAt - st.startedAt : nowMs - st.startedAt) / 1000,
      open: !st.endedAt,
    }));

  return {
    id: run.id,
    label: runLabel(run),
    brand: run.brand,
    flavor: run.flavor,
    dieType: vals.dieType ?? "",
    status,
    casesNeeded,
    casesMade,
    casesLeft,
    plannedPpm,
    actualPpm,
    minutesRemaining,
    netElapsedSec: Math.round(netElapsedSec),
    downtimeSec: Math.round(downtimeSec),
    stoppages,
  };
}

// Historical benchmark PPM mirrors the mobile historicalBenchmarkPpm: average
// per-run net PPM across finished history runs with >=60s net run time.
function benchmarkPpmOf(historyRuns: OptimizeRun[]): number | null {
  const ppms = historyRuns
    .filter((r) => r.status === "finished" && r.netElapsedSec >= 60 && r.actualPpm != null)
    .map((r) => r.actualPpm as number);
  if (ppms.length === 0) return null;
  return Math.round(ppms.reduce((a, b) => a + b, 0) / ppms.length);
}

export type ScheduledDayInput = {
  date: string;
  runs: { brand: string; flavor: string; casesNeeded: number; dieType?: string }[];
};

export function buildOptimizeInput(args: {
  date: string;
  nowMs: number;
  runToTime: string;
  runs: RunMeta[];
  runValuesFor: (id: string) => FormValues;
  history: HistoryDay[];
  scheduledDays: ScheduledDayInput[];
}): OptimizeInput {
  const runs = args.runs.map((r) => buildOptimizeRun(r, args.runValuesFor(r.id), args.nowMs));

  const historyRuns: OptimizeRun[] = [];
  for (const day of args.history) {
    for (const run of day.runs) {
      const vals = day.runValues[run.id];
      if (!vals) continue;
      historyRuns.push(buildOptimizeRun(run, vals, args.nowMs));
    }
  }

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

  // Today PPM: total pizzas made / total net run minutes across producing runs.
  let pizzas = 0;
  let netSec = 0;
  for (const r of args.runs) {
    const vals = args.runValuesFor(r.id);
    const o = runs.find((x) => x.id === r.id);
    if (!o) continue;
    pizzas += o.casesMade * vals.pizzasPerCase;
    netSec += o.netElapsedSec;
  }
  const todayPpm = netSec > 0 ? Math.round(pizzas / (netSec / 60)) : 0;

  return {
    date: args.date,
    nowMs: args.nowMs,
    runToTime: args.runToTime,
    todayPpm,
    benchmarkPpm: benchmarkPpmOf(historyRuns),
    runs,
    scheduledRuns,
    historyRuns,
  };
}

// ── API client (raw fetch, matches inventoryShared) ──────────────────────────
export async function requestOptimize(input: OptimizeInput): Promise<OptimizeResult> {
  const res = await fetch("/api/ai/optimize", {
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
      `Optimize request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as OptimizeResult;
}

// Reuse the photo endpoint's friendly 429/413 messaging for parity.
export const optimizeErrorMessage = photoErrorMessage;
