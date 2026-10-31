import { buildWallClockServerClaims } from "./autoTrackServerTicks";

type WallPlan = NonNullable<ReturnType<typeof buildWallClockServerClaims>>;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

/** End advances selection, but the previous run's tunnel must still drain. */
export function buildServerWallClockPlans(
  raw: unknown,
  nowMs: number,
  eventIdNamespace: string,
): WallPlan[] {
  const data = record(raw);
  const day = record(data.dayState);
  const runs = Array.isArray(day.runs) ? day.runs : [];
  const values = record(data.runValues);
  const currentPlan = buildWallClockServerClaims(data, nowMs, eventIdNamespace);
  if (!currentPlan) return [];

  const currentRun = runs.map(record).find((run) => run.id === currentPlan.runId);
  const currentIsRunning = currentRun
    && Number(currentRun.startedAt) > 0
    && (Number(currentRun.endedAt) || 0) <= 0
    && (Number(currentRun.pausedAt) || 0) <= 0;
  if (!currentIsRunning) return [currentPlan];

  // An active run normally wins server selection. Keep the latest still-eligible
  // ended run's bounded case-only freezer drain alongside it, targeting that run
  // explicitly so a newer active lifecycle cannot steal the drain's claims.
  const drain = runs.map((value, index) => {
    const run = record(value);
    const endedAt = Number(run.endedAt);
    const freezerMinutes = Number(record(values[String(run.id)]).freezerTime);
    return { run, index, endedAt, freezerMinutes };
  })
    .filter(({ run, endedAt, freezerMinutes }) =>
      typeof run.id === "string"
      && Number(run.startedAt) > 0
      && endedAt > 0
      && freezerMinutes > 0
      && nowMs < endedAt + freezerMinutes * 60_000)
    .sort((a, b) => b.endedAt - a.endedAt || b.index - a.index)[0];
  if (!drain || drain.run.id === currentPlan.runId) return [currentPlan];

  const drainPlan = buildWallClockServerClaims(
    data, nowMs, eventIdNamespace, drain.run.id as string,
  );
  return drainPlan && drainPlan.runId !== currentPlan.runId
    ? [currentPlan, drainPlan]
    : [currentPlan];
}

/** Never advance bookkeeping beyond an event omitted by the shared budget. */
export function fitServerWallClockPlans(plans: WallPlan[], remainingBudget: number): WallPlan[] {
  let remaining = Math.max(0, remainingBudget);
  return plans.filter((plan) => {
    if (plan.claims.length > remaining) return false;
    remaining -= plan.claims.length;
    return true;
  });
}
