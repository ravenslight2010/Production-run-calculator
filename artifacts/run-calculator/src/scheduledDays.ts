export type ScheduledRun = {
  id: string;
  brand: string;
  flavor: string;
  casesNeeded: number;
  dieType: string;
};

export type ScheduledDay = {
  date: string;
  runCount: number;
  runs: ScheduledRun[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Keeps an unexpected scheduled-sync response (such as an auth error envelope)
 * out of React state. Callers can safely map and flatMap the returned array.
 */
export function normalizeScheduledDays(value: unknown): ScheduledDay[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((rawDay) => {
    const day = asRecord(rawDay);
    const date = asText(day?.date);
    if (!date) return [];

    const runs = Array.isArray(day?.runs)
      ? day.runs.flatMap((rawRun) => {
          const run = asRecord(rawRun);
          if (!run) return [];
          return [{
            id: asText(run.id),
            brand: asText(run.brand),
            flavor: asText(run.flavor),
            casesNeeded: asFiniteNumber(run.casesNeeded),
            dieType: asText(run.dieType),
          }];
        })
      : [];

    return [{
      date,
      runCount: asFiniteNumber(day?.runCount),
      runs,
    }];
  });
}