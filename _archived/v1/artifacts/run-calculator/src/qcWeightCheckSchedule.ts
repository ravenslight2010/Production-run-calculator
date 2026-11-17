export const QC_WEIGHT_CHECK_INTERVAL_MS = 30 * 60_000;
export const QC_WEIGHT_CHECK_OVERDUE_GRACE_MS = 60_000;

export type QcWeightReminderTarget = {
  ingredientId: string;
  ingredientName: string;
  targetValue: number | null;
  unit: string | null;
  state: string;
};

export type QcWeightReminderEvent = {
  eventType: string;
  ingredientId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type QcRunPause = {
  type?: string;
  startedAt: number;
  endedAt?: number;
};

export type QcWeightCheckReminder = {
  ingredientId: string;
  ingredientName: string;
  nextCheckAt: number;
};

const VALID_UNITS = new Set(["oz", "g", "lb", "kg"]);

function completedPauseIntervals(pauses: readonly QcRunPause[]) {
  return pauses.flatMap((pause) => {
    if (pause.type !== "pause" || pause.endedAt === undefined) return [];
    if (!Number.isFinite(pause.startedAt) || !Number.isFinite(pause.endedAt)) return [];
    if (pause.endedAt <= pause.startedAt) return [];
    return [{ startedAt: pause.startedAt, endedAt: pause.endedAt }];
  });
}

function pauseDurationBefore(
  intervals: readonly { startedAt: number; endedAt: number }[],
  at: number,
  runStartAt: number,
): number {
  return intervals.reduce((total, interval) => {
    if (interval.endedAt > at) return total;
    return total + Math.max(0, interval.endedAt - Math.max(interval.startedAt, runStartAt));
  }, 0);
}

function isInsidePause(
  intervals: readonly { startedAt: number; endedAt: number }[],
  at: number,
): boolean {
  return intervals.some((interval) => at >= interval.startedAt && at < interval.endedAt);
}

function isConfiguredTarget(target: QcWeightReminderTarget): boolean {
  return target.state === "configured"
    && target.targetValue !== null
    && Number.isFinite(target.targetValue)
    && target.targetValue > 0
    && target.unit !== null
    && VALID_UNITS.has(target.unit);
}

export function hasConfiguredQcWeightReminderTarget(
  targets: readonly QcWeightReminderTarget[],
): boolean {
  return targets.some(isConfiguredTarget);
}

export function deriveQcWeightCheckReminders({
  runStartedAt,
  pauses,
  targets,
  events,
  now,
}: {
  /** This is the run's persisted, pause-adjusted startedAt value. */
  runStartedAt: number;
  pauses: readonly QcRunPause[];
  targets: readonly QcWeightReminderTarget[];
  events: readonly QcWeightReminderEvent[];
  now: number;
}): QcWeightCheckReminder[] {
  if (!Number.isFinite(runStartedAt) || !Number.isFinite(now)) return [];

  const intervals = completedPauseIntervals(pauses);
  const totalPauseMs = pauseDurationBefore(intervals, now, Number.NEGATIVE_INFINITY);
  const originalRunStartAt = runStartedAt - totalPauseMs;

  return targets.flatMap((target) => {
    if (!isConfiguredTarget(target)) return [];

    const latestActiveElapsed = events.reduce<number | null>((latest, event) => {
      if (
        event.eventType !== "weight"
        || event.ingredientId !== target.ingredientId
        || event.payload.checkType !== "30-minute"
      ) return latest;

      const createdAt = Date.parse(event.createdAt);
      if (
        !Number.isFinite(createdAt)
        || createdAt < originalRunStartAt
        || createdAt > now
        || isInsidePause(intervals, createdAt)
      ) return latest;

      const activeElapsed = createdAt - originalRunStartAt
        - pauseDurationBefore(intervals, createdAt, originalRunStartAt);
      return latest === null ? activeElapsed : Math.max(latest, activeElapsed);
    }, null);

    const elapsedDeadline = latestActiveElapsed === null
      ? QC_WEIGHT_CHECK_INTERVAL_MS
      : Math.max(
        QC_WEIGHT_CHECK_INTERVAL_MS,
        latestActiveElapsed + QC_WEIGHT_CHECK_INTERVAL_MS,
      );

    return [{
      ingredientId: target.ingredientId,
      ingredientName: target.ingredientName,
      nextCheckAt: runStartedAt + elapsedDeadline,
    }];
  });
}
