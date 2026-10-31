import type { DayBreak, DayBreaks, FormValues, RunMeta } from "./types";
import { DAY_BREAK_DURATION_MIN } from "./types";
import { estimateRun, type RunEstimate } from "@workspace/live-calc";

export { estimateRun };
export type TimelineRun = { run: RunMeta; durationSec?: number; remainingSec?: number; estimate?: RunEstimate };
export type TimelineRunProjection = {
  runId: string;
  startMs?: number;
  finishMs?: number;
  durationSec?: number;
  estimate?: RunEstimate;
  status: "completed" | "current" | "paused" | "upcoming";
};
export type TimelineBreakProjection = {
  slot: 1 | 2 | 3;
  break: DayBreak;
  startMs?: number;
  finishMs?: number;
  status: "scheduled" | "pending" | "unassigned";
  reason?: "during-run" | "missing-run" | "invalid-time" | "unknown-duration";
};
export type DayTimeline = {
  runs: TimelineRunProjection[];
  breaks: TimelineBreakProjection[];
  projectedFinishMs?: number;
  partialFinishMs?: number;
  incomplete: boolean;
  productionStartMs: number;
};
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const finiteDuration = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const timestamp = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime());

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
    return {
      slot: slot as 1 | 2 | 3,
      enabled: candidate.enabled === true,
      mode: candidate.mode === "at-time" ? "at-time" : "after-run",
      ...(typeof candidate.runId === "string" && candidate.runId.trim() ? { runId: candidate.runId } : {}),
      ...(isValidLocalTime(candidate.atTime) ? { atTime: candidate.atTime } : {}),
      durationMin: DAY_BREAK_DURATION_MIN,
    };
  }) as DayBreaks;
}
function dateAtLocalTime(date: string | undefined, time: string, fallbackMs: number): number | undefined {
  if (!isValidLocalTime(time)) return undefined;
  const base = date ? new Date(`${date}T${time}:00`) : new Date(fallbackMs);
  if (!date) {
    const [hour, minute] = time.split(":").map(Number);
    base.setHours(hour, minute, 0, 0);
  }
  return Number.isFinite(base.getTime()) ? base.getTime() : undefined;
}

/** Unknown is deliberately not zero (in particular, not freezer-only). */
export function estimatedRunDurationSec(values: Partial<FormValues> | undefined): number | undefined {
  return estimateRun(values).durationSec;
}

/** Both editor and summary call this with the same identity-bound snapshots. */
export function buildTimelineRuns(
  runs: RunMeta[],
  values: (run: RunMeta) => Partial<FormValues> | undefined,
  nowMs: number,
): TimelineRun[] {
  return runs.map((run) => {
    const estimate = estimateRun(values(run), run, nowMs);
    return { run, durationSec: estimate.durationSec, remainingSec: estimate.remainingSec, estimate };
  });
}

export function calculateDayTimeline(input: {
  date?: string;
  productionStartTime?: string;
  runs: TimelineRun[];
  breaks?: unknown;
  currentRunId?: string;
  currentRemainingSec?: number;
  nowMs: number;
  /** Explicitly false for future-day planning. */
  isToday?: boolean;
}): DayTimeline {
  const start = dateAtLocalTime(input.date, input.productionStartTime ?? "06:00", input.nowMs) ?? input.nowMs;
  const today = new Date(input.nowMs);
  const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const isToday = input.isToday ?? input.date === localDay;
  const projections: TimelineRunProjection[] = [];
  const breaks: TimelineBreakProjection[] = normalizeDayBreaks(input.breaks).map((item) => ({
    slot: item.slot, break: item, status: "unassigned",
  }));
  const clockTargets = new Map<number, number>();
  let incomplete = false;
  for (const item of breaks) {
    if (!item.break.enabled) continue;
    if (item.break.mode === "after-run") {
      if (!input.runs.some(({ run }) => run.id === item.break.runId)) item.reason = "missing-run";
    } else {
      const time = dateAtLocalTime(input.date, item.break.atTime ?? "", input.nowMs);
      if (time === undefined) item.reason = "invalid-time";
      else clockTargets.set(item.slot, time);
    }
    if (item.reason) incomplete = true;
  }
  let cursor: number | undefined = start;
  let partialFinish: number | undefined;
  const placed = new Set<number>();
  const place = (item: TimelineBreakProjection, target?: number) => {
    placed.add(item.slot);
    if (cursor === undefined || target === undefined) {
      item.status = "pending";
      item.reason = "unknown-duration";
      incomplete = true;
      return;
    }
    const breakStart = Math.max(cursor, target);
    const breakFinish = breakStart + DAY_BREAK_DURATION_MIN * 60_000;
    if (!timestamp(breakStart) || !timestamp(breakFinish)) {
      item.status = "pending";
      item.reason = "unknown-duration";
      cursor = undefined;
      incomplete = true;
      return;
    }
    item.startMs = breakStart;
    item.finishMs = breakFinish;
    item.status = "scheduled";
    cursor = item.finishMs;
    partialFinish = Math.max(partialFinish ?? 0, cursor);
  };
  const clocksThrough = (boundary: number | undefined, activeStart?: number) => {
    if (boundary === undefined) return;
    for (const item of [...breaks].sort((a, b) =>
      (clockTargets.get(a.slot) ?? Infinity) - (clockTargets.get(b.slot) ?? Infinity) || a.slot - b.slot)) {
      const target = clockTargets.get(item.slot);
      if (placed.has(item.slot) || target === undefined || target > boundary) continue;
      if (activeStart !== undefined && target > activeStart && target < boundary) {
        placed.add(item.slot);
        item.status = "pending";
        item.reason = "during-run";
        incomplete = true;
      } else place(item, target);
    }
  };
  for (const item of input.runs) {
    const { run } = item;
    const completed = timestamp(run.endedAt);
    const active = timestamp(run.startedAt) && !completed;
    const status = completed ? "completed" : active ? run.pausedAt ? "paused" : "current" : "upcoming";
    let startMs: number | undefined;
    let finishMs: number | undefined;
    if (completed) {
      startMs = timestamp(run.startedAt) ? run.startedAt : undefined;
      finishMs = run.endedAt;
      cursor = cursor === undefined ? finishMs : Math.max(cursor, finishMs!);
    } else if (active) {
      startMs = run.startedAt;
      const remaining = run.id === input.currentRunId && input.currentRemainingSec !== undefined
        ? input.currentRemainingSec : item.remainingSec;
      finishMs = finiteDuration(remaining) ? Math.max(input.nowMs, run.pausedAt ?? input.nowMs) + remaining * 1000 : undefined;
      cursor = finishMs === undefined ? undefined : Math.max(cursor ?? finishMs, finishMs);
    } else {
      if (cursor !== undefined && isToday) cursor = Math.max(cursor, input.nowMs);
      clocksThrough(cursor);
      startMs = cursor;
      finishMs = startMs !== undefined && finiteDuration(item.durationSec) ? startMs + item.durationSec * 1000 : undefined;
      cursor = finishMs;
    }
    if (!timestamp(finishMs)) {
      finishMs = undefined;
      cursor = undefined;
      incomplete = true;
    } else partialFinish = Math.max(partialFinish ?? 0, finishMs);
    projections.push({ runId: run.id, startMs, finishMs, durationSec: item.durationSec, estimate: item.estimate, status });
    // A clock choice inside any unfinished run needs an explicit planning
    // decision; do not silently move the requested time to an after-run break.
    clocksThrough(finishMs, completed ? undefined : startMs);
    for (const br of breaks) {
      if (br.break.enabled && br.break.mode === "after-run" && br.break.runId === run.id && !br.reason) place(br, finishMs);
    }
  }
  for (const item of breaks) {
    if (!item.break.enabled || placed.has(item.slot) || item.reason) continue;
    place(item, clockTargets.get(item.slot));
  }
  return {
    runs: projections, breaks, productionStartMs: start, incomplete,
    projectedFinishMs: incomplete ? undefined : cursor,
    partialFinishMs: partialFinish,
  };
}
