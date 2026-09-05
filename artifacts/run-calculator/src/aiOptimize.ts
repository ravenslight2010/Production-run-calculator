import type { ReviewVerdict } from "@workspace/ai-review";
import { computeCasesInFreezer } from "@workspace/inventory-math";
import { withTempOverrides, type FormValues, type RunMeta, type HistoryDay } from "./types";
import { computeEffectiveLineSpeed } from "./lineSpeed";
import { computeSummaryStats, runLabel } from "./utils";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";
import type { AiStatus } from "./aiStatus";

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
  /** Recorded/cased output only. Work still in the freezer/on the line stays separate. */
  casesMade: number;
  /** Lifecycle-aware cases pressed but not yet cased. Optional for older clients. */
  casesOnLine?: number;
  casesLeft: number;
  plannedPpm: number;
  actualPpm: number | null;
  minutesRemaining: number | null;
  netElapsedSec: number;
  downtimeSec: number;
  stoppages: OptimizeStoppage[];
  /** How many pizzas make one case (unit-conversion denominator for PPM→cases) */
  pizzasPerCase?: number;
  /** How many cases fit on one skid (used to split total cases into skidsCompleted + casesOnCurrentSkid) */
  casesPerSkid?: number;
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
  /**
   * Client timezone offset in minutes EAST of UTC (-Date.getTimezoneOffset()),
   * so the server (which runs in UTC) can render local 12-hour wall-clock
   * times in AI prompts. Optional; the server falls back to its own clock.
   */
  tzOffsetMinutes?: number;
  runToTime: string;
  todayPpm: number;
  benchmarkPpm: number | null;
  runs: OptimizeRun[];
  scheduledRuns: OptimizeScheduledRun[];
  historyRuns: OptimizeRun[];
  /**
   * Client-resolved material demand from upcoming (today-or-later) scheduled
   * runs, keyed by inventory item key. Only the proactive reorder nudge reads
   * it; /ai/optimize ignores it. Lets the nudge project on-hand exactly like the
   * warehouse "Reorder Now" card (the server can't resolve scheduled-run demand
   * itself because brand/recipe profiles live client-side). Optional.
   */
  reorderDemandByKey?: Record<string, number>;
};

export type OptimizeActionKind = "set_target_time" | "set_run_target" | "reorder_run" | "adjust_line_speed";

export type OptimizeAction = {
  kind: OptimizeActionKind;
  label: string;
  time?: string;
  runId?: string;
  casesNeeded?: number;
  beforeRunId?: string | null;
  /** New speed value for adjust_line_speed: speedAdjustment multiplier or approxLineSpeed ppm. */
  newValue?: number;
  /** True when the current run uses Approximate Line Speed (crust mode) instead of cycle-speed math. */
  isCrustMode?: boolean;
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
  aiStatus?: AiStatus;
};

// ── Per-run shaping ──────────────────────────────────────────────────────────
// Mirrors buildRunCsvRow (downtime = stoppages with an end time that aren't
// pauses) and the live calc's planned PPM (configured cycle speed for dough,
// approximate line speed for crusts). Kept in lockstep with the live calculator.
function plannedPpmOf(run: RunMeta, vals: FormValues): number {
  return computeEffectiveLineSpeed({
    mode: run.subTab === "crusts" ? "crusts" : "dough",
    approxLineSpeed: vals.approxLineSpeed,
    crustsPerCycle: vals.crustsPerCycle,
    cycleSpeed: vals.cycleSpeed,
    speedAdjustment: vals.speedAdjustment,
  });
}

function statusOf(run: RunMeta): RunStatus {
  if (run.endedAt) return "finished";
  if (run.startedAt) return "running";
  return "upcoming";
}

export function buildOptimizeRun(run: RunMeta, vals: FormValues, nowMs: number): OptimizeRun {
  const s = computeSummaryStats(vals);
  const status = statusOf(run);
  const effectiveVals = withTempOverrides(vals);
  const ppc = effectiveVals.pizzasPerCase;

  const downtimeSec = (run.stoppages ?? [])
    .filter((st) => st.endedAt && st.type !== "pause")
    .reduce((acc, st) => acc + (st.endedAt! - st.startedAt) / 1000, 0);

  // An active pause freezes productive elapsed time at pausedAt. Closed pauses
  // are already excluded because resumeRun shifts startedAt forward.
  const endRef = run.endedAt ?? run.pausedAt ?? (run.startedAt ? nowMs : undefined);
  const grossDurSec = run.startedAt && endRef ? (endRef - run.startedAt) / 1000 : 0;
  // If a run is ended while still paused, endRun cannot shift startedAt; remove
  // only that pause still open at end (closed pauses were already shifted out).
  const openPauseAtEndSec =
    run.endedAt == null
      ? 0
      : (run.stoppages ?? [])
          .filter(
            (st) =>
              st.type === "pause" &&
              st.startedAt < run.endedAt! &&
              (st.endedAt == null || st.endedAt >= run.endedAt!),
          )
          .reduce((acc, st) => acc + (run.endedAt! - st.startedAt) / 1000, 0);
  const netElapsedSec = Math.max(0, grossDurSec - downtimeSec - openPauseAtEndSec);

  const casesNeeded = vals.casesNeeded;
  const liveCasesMade = vals.skidsCompleted * vals.casesPerSkid + vals.casesOnCurrentSkid;
  const casesMade =
    status === "finished"
      ? run.actualCases ?? s.totalCases
      : status === "running"
        ? Math.max(0, liveCasesMade)
        : 0;
  const linePpm = plannedPpmOf(run, effectiveVals);
  const casesOnLine = computeCasesInFreezer({
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    pausedAt: run.pausedAt,
    stoppages: run.stoppages,
    now: nowMs,
    ppm: linePpm,
    pizzasPerCase: ppc,
    freezerTimeMin: effectiveVals.freezerTime,
  });
  const casesLeft = Math.max(0, casesNeeded - casesMade);

  const plannedPpm = Math.round(linePpm);
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
    casesOnLine,
    casesLeft,
    plannedPpm,
    actualPpm,
    minutesRemaining,
    netElapsedSec: Math.round(netElapsedSec),
    downtimeSec: Math.round(downtimeSec),
    stoppages,
    pizzasPerCase: ppc,
    casesPerSkid: vals.casesPerSkid,
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
    // Minutes EAST of UTC so the server can render local wall-clock times in
    // AI prompts (the server itself runs in UTC).
    tzOffsetMinutes: -new Date(args.nowMs).getTimezoneOffset(),
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
