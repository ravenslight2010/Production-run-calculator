// Mobile AI assistant client. Mirrors the web app's src/aiOptimize.ts so both
// platforms send the model identically-shaped data and render the same cards
// (replit.md parity rule). Per-run shaping matches the web buildOptimizeRun:
// downtime = completed stoppages, planned PPM = crustsPerCycle * cycleSpeed *
// speedAdjustment, live cases-made from skid progress. The one platform
// difference is plumbing: mobile threads the session bearer token + client id
// through fetch (no cookie jar), exactly like context/inventoryShared.ts.

import { getAuthToken } from "@workspace/api-client-react";
import type { ReviewVerdict } from "@workspace/ai-review";
import {
  computeCalc,
  runLabel,
  type RunState,
  type HistoryDay,
} from "./RunContext";
import { getApiBaseUrl, getOrCreateClientId } from "./sync/client";
import { InventoryApiError, photoErrorMessage } from "./inventoryShared";

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
  review?: ReviewVerdict;
};

export type OptimizeResult = {
  recommendations: OptimizeRecommendation[];
  generatedAt: number;
  note?: string;
};

// ── Per-run shaping ──────────────────────────────────────────────────────────
// Mirrors the web buildOptimizeRun. Mobile has no "pause" stoppage type, so
// every completed stoppage counts as downtime — matching mobile's own
// computeCalc / historicalBenchmarkPpm conventions.
function plannedPpmOf(s: RunState["settings"]): number {
  return Math.max(0, s.crustsPerCycle * s.cycleSpeed * s.speedAdjustment);
}

function statusOf(run: RunState): RunStatus {
  if (run.endedAt) return "finished";
  if (run.startedAt) return "running";
  return "upcoming";
}

function buildOptimizeRun(run: RunState, index: number, nowMs: number): OptimizeRun {
  const s = run.settings;
  const p = run.progress;
  const status = statusOf(run);
  const ppc = s.pizzasPerCase;

  const downtimeSec = (run.stoppages ?? [])
    .filter((st) => st.endedAt != null)
    .reduce((acc, st) => acc + (st.endedAt! - st.startedAt) / 1000, 0);

  const endRef = run.endedAt ?? (run.startedAt ? nowMs : undefined);
  const grossDurSec = run.startedAt && endRef ? (endRef - run.startedAt) / 1000 : 0;
  const netElapsedSec = Math.max(0, grossDurSec - downtimeSec);

  const casesNeeded = s.casesNeeded;
  const liveCasesMade = p.skidsCompleted * s.casesPerSkid + p.casesOnCurrentSkid;
  const casesMade =
    status === "finished"
      ? run.actualCases ?? Math.max(0, casesNeeded - computeCalc(run, endRef ?? nowMs).casesLeft)
      : status === "running"
        ? Math.max(0, liveCasesMade)
        : 0;
  const casesLeft = Math.max(0, casesNeeded - casesMade);

  const plannedPpm = Math.round(plannedPpmOf(s));
  const actualPpm =
    netElapsedSec > 0 && casesMade > 0 && ppc > 0
      ? Math.round((casesMade * ppc) / (netElapsedSec / 60))
      : null;
  const minutesRemaining =
    status === "running" && casesLeft > 0 && plannedPpm > 0 && ppc > 0
      ? Math.round((casesLeft * ppc) / plannedPpm)
      : null;

  const stoppages: OptimizeStoppage[] = (run.stoppages ?? []).map((st) => ({
    reason: st.reason || "Stoppage",
    durationSec: (st.endedAt ? st.endedAt - st.startedAt : nowMs - st.startedAt) / 1000,
    open: !st.endedAt,
  }));

  return {
    id: run.id,
    label: runLabel(run, index),
    brand: s.brand,
    flavor: s.flavor,
    dieType: s.dieType ?? "",
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

// Historical benchmark PPM: average net PPM across finished history runs with
// >=60s net run time. Mirrors the web benchmarkPpmOf over shaped runs.
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
  runs: RunState[];
  history: HistoryDay[];
  scheduledDays: ScheduledDayInput[];
}): OptimizeInput {
  const runs = args.runs.map((r, i) => buildOptimizeRun(r, i, args.nowMs));

  const historyRuns: OptimizeRun[] = [];
  for (const day of args.history) {
    day.runs.forEach((run, i) => {
      historyRuns.push(buildOptimizeRun(run, i, args.nowMs));
    });
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
  for (let i = 0; i < args.runs.length; i++) {
    const o = runs[i];
    pizzas += o.casesMade * args.runs[i].settings.pizzasPerCase;
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

// ── API client (auth-threaded fetch, matches inventoryShared.api) ────────────
export async function requestOptimize(input: OptimizeInput): Promise<OptimizeResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("No API base URL (sync disabled)");
  const clientId = await getOrCreateClientId();
  const token = await getAuthToken();
  const res = await fetch(`${base}/api/ai/optimize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
