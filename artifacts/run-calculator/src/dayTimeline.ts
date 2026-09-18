import type { DayBreak, DayBreaks, FormValues, RunMeta } from "./types";
import { DAY_BREAK_DURATION_MIN } from "./types";

export type TimelineRun = {
  run: RunMeta;
  durationSec: number;
};

export type TimelineRunProjection = {
  runId: string;
  startMs?: number;
  finishMs?: number;
  durationSec: number;
  status: "completed" | "current" | "paused" | "upcoming";
};

export type TimelineBreakProjection = {
  slot: 1 | 2 | 3;
  break: DayBreak;
  startMs?: number;
  finishMs?: number;
  status: "scheduled" | "pending" | "unassigned";
  reason?: "during-run" | "missing-run" | "invalid-time";
};

export type DayTimeline = {
  runs: TimelineRunProjection[];
  breaks: TimelineBreakProjection[];
  projectedFinishMs?: number;
  productionStartMs: number;
};

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function defaultDayBreak(slot: 1 | 2 | 3): DayBreak {
  return { slot, enabled: false, mode: "after-run", durationMin: DAY_BREAK_DURATION_MIN };
}

export function defaultDayBreaks(): DayBreaks {
  return [defaultDayBreak(1), defaultDayBreak(2), defaultDayBreak(3)];
}

export function isValidLocalTime(value: unknown): value is string {
  return typeof value === "string" && CLOCK_RE.test(value);
}

export function normalizeDayBreaks(value: unknown): DayBreaks {
  const source = Array.isArray(value) ? value : [];
  return [1, 2, 3].map((slot) => {
    const raw = source[slot - 1];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultDayBreak(slot as 1 | 2 | 3);
    const candidate = raw as Record<string, unknown>;
    const mode = candidate.mode === "at-time" || candidate.mode === "after-run"
      ? candidate.mode
      : "after-run";
    const enabled = candidate.enabled === true;
    const runId = typeof candidate.runId === "string" && candidate.runId.trim() ? candidate.runId : undefined;
    const atTime = isValidLocalTime(candidate.atTime) ? candidate.atTime : undefined;
    return {
      slot: slot as 1 | 2 | 3,
      enabled,
      mode,
      ...(runId ? { runId } : {}),
      ...(atTime ? { atTime } : {}),
      durationMin: DAY_BREAK_DURATION_MIN,
    };
  }) as DayBreaks;
}

function dateAtLocalTime(date: string | undefined, time: string, fallbackMs: number): number | undefined {
  if (!isValidLocalTime(time)) return undefined;
  const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T${time}:00`)
    : new Date(fallbackMs);
  if (!date) {
    const [hour, minute] = time.split(":").map(Number);
    base.setHours(hour, minute, 0, 0);
  }
  return Number.isFinite(base.getTime()) ? base.getTime() : undefined;
}

function productionStartMs(date: string | undefined, time: string, fallbackMs: number): number {
  return dateAtLocalTime(date, isValidLocalTime(time) ? time : "06:00", fallbackMs) ?? fallbackMs;
}

export function estimatedRunDurationSec(values: Partial<FormValues> | undefined): number {
  const cases = Number(values?.casesNeeded ?? 0);
  const pizzasPerCase = Number(values?.pizzasPerCase ?? 0);
  const ppm = Number(values?.approxLineSpeed ?? 0);
  const freezerMin = Number(values?.freezerTime ?? 0);
  const lineSec = cases > 0 && pizzasPerCase > 0 && ppm > 0
    ? (cases * pizzasPerCase / ppm) * 60
    : 0;
  return Math.max(0, lineSec + Math.max(0, freezerMin) * 60);
}

export function calculateDayTimeline(input: {
  date?: string;
  productionStartTime?: string;
  runs: TimelineRun[];
  breaks?: unknown;
  currentRunId?: string;
  currentRemainingSec?: number;
  nowMs: number;
}): DayTimeline {
  const breaks = normalizeDayBreaks(input.breaks);
  const start = productionStartMs(input.date, input.productionStartTime ?? "06:00", input.nowMs);
  const projections: TimelineRunProjection[] = [];
  const breakProjections: TimelineBreakProjection[] = breaks.map((breakSlot) => ({
    slot: breakSlot.slot,
    break: breakSlot,
    status: "unassigned",
  }));
  let cursor = start;

  for (const item of input.runs) {
    const run = item.run;
    if (run.endedAt) {
      projections.push({
        runId: run.id,
        startMs: run.startedAt,
        finishMs: run.endedAt,
        durationSec: item.durationSec,
        status: "completed",
      });
      cursor = Math.max(cursor, run.endedAt);
      continue;
    }

    let finishMs: number;
    let status: TimelineRunProjection["status"];
    if (run.id === input.currentRunId && run.startedAt) {
      const remaining = Math.max(0, Number(input.currentRemainingSec ?? item.durationSec));
      finishMs = run.pausedAt ? run.pausedAt + remaining * 1000 : input.nowMs + remaining * 1000;
      status = run.pausedAt ? "paused" : "current";
      cursor = Math.max(cursor, run.startedAt);
    } else if (run.startedAt) {
      finishMs = Math.max(cursor, run.startedAt) + item.durationSec * 1000;
      status = run.pausedAt ? "paused" : "current";
      cursor = Math.max(cursor, run.startedAt);
    } else {
      const startMs = cursor;
      finishMs = startMs + item.durationSec * 1000;
      projections.push({ runId: run.id, startMs, finishMs, durationSec: item.durationSec, status: "upcoming" });
      cursor = finishMs;
      continue;
    }
    projections.push({ runId: run.id, startMs: run.startedAt, finishMs, durationSec: item.durationSec, status });
    cursor = Math.max(cursor, finishMs);
  }

  const breakTargets = new Map<number, number>();
  for (const projection of breakProjections) {
    const breakSlot = projection.break;
    if (!breakSlot.enabled) continue;
    let target: number | undefined;
    if (breakSlot.mode === "after-run") {
      const referenced = breakSlot.runId ? projections.find((run) => run.runId === breakSlot.runId) : undefined;
      if (!referenced) {
        projection.reason = "missing-run";
        continue;
      }
      target = referenced.finishMs;
    } else {
      target = dateAtLocalTime(input.date, breakSlot.atTime ?? "", input.nowMs);
      if (target === undefined) {
        projection.reason = "invalid-time";
        continue;
      }
    }
    const targetMs = target;
    if (targetMs === undefined) {
      projection.reason = "invalid-time";
      continue;
    }
    const active = projections.find((run) =>
      run.status !== "completed" && run.startMs !== undefined && run.finishMs !== undefined
      && targetMs > run.startMs && targetMs < run.finishMs,
    );
    if (active && breakSlot.mode === "at-time") {
      projection.status = "pending";
      projection.reason = "during-run";
      continue;
    }
    breakTargets.set(projection.slot, targetMs);
    projection.status = "scheduled";
  }

  // Rebuild the schedule in run order. Completed/current timestamps are
  // authoritative. A scheduled break is inserted before the first upcoming
  // run whose baseline window reaches its target; an after-run break therefore
  // lands immediately after its referenced run. A clock break that was inside
  // a projected (not-yet-active) run is placed after that run.
  const scheduledBreaks = breakProjections
    .filter((item) => item.status === "scheduled" && breakTargets.has(item.slot))
    .sort((a, b) => (breakTargets.get(a.slot)! - breakTargets.get(b.slot)!) || (a.slot - b.slot));
  let downstream = start;
  let breakIndex = 0;
  const placeBreak = (item: TimelineBreakProjection) => {
    const targetMs = breakTargets.get(item.slot) ?? downstream;
    const startMs = Math.max(downstream, targetMs);
    item.startMs = startMs;
    item.finishMs = startMs + DAY_BREAK_DURATION_MIN * 60_000;
    downstream = item.finishMs;
    breakIndex += 1;
  };
  for (const run of projections) {
    if (run.status === "completed" || (run.status === "current" || run.status === "paused") && run.startMs !== undefined) {
      downstream = Math.max(downstream, run.finishMs ?? downstream);
      while (breakIndex < scheduledBreaks.length
        && (breakTargets.get(scheduledBreaks[breakIndex].slot) ?? Number.POSITIVE_INFINITY) <= downstream) {
        placeBreak(scheduledBreaks[breakIndex]);
      }
      continue;
    }
    const baselineFinish = run.finishMs ?? downstream;
    while (breakIndex < scheduledBreaks.length) {
      const targetMs = breakTargets.get(scheduledBreaks[breakIndex].slot) ?? Number.POSITIVE_INFINITY;
      const breakIsAfterThisRun = scheduledBreaks[breakIndex].break.mode === "after-run"
        && targetMs === baselineFinish;
      if (!(targetMs <= (run.startMs ?? downstream) || (targetMs < baselineFinish && !breakIsAfterThisRun))) break;
      placeBreak(scheduledBreaks[breakIndex]);
    }
    run.startMs = downstream;
    run.finishMs = downstream + run.durationSec * 1000;
    downstream = run.finishMs;
    while (breakIndex < scheduledBreaks.length
      && (breakTargets.get(scheduledBreaks[breakIndex].slot) ?? Number.POSITIVE_INFINITY) <= baselineFinish) {
      placeBreak(scheduledBreaks[breakIndex]);
    }
  }
  while (breakIndex < scheduledBreaks.length) {
    placeBreak(scheduledBreaks[breakIndex]);
  }
  const lastRunFinish = projections.reduce((max, run) => Math.max(max, run.finishMs ?? 0), start);
  const lastBreakFinish = breakProjections.reduce((max, item) => Math.max(max, item.finishMs ?? 0), start);
  return { runs: projections, breaks: breakProjections, projectedFinishMs: Math.max(lastRunFinish, lastBreakFinish), productionStartMs: start };
}