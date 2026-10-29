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
  const selected = typeof day.currentIndex === "number" ? day.currentIndex : 0;
  const indices = [selected];
  const values = record(data.runValues);
  for (let index = 0; index < runs.length; index++) {
    if (index === selected) continue;
    const run = record(runs[index]);
    const endedAt = Number(run.endedAt);
    const freezerMinutes = Number(record(values[String(run.id)]).freezerTime);
    if (endedAt > 0 && freezerMinutes > 0 && nowMs < endedAt + freezerMinutes * 60_000) {
      indices.push(index);
    }
  }
  return indices.flatMap((currentIndex) => {
    const plan = buildWallClockServerClaims(
      { ...data, dayState: { ...day, currentIndex } }, nowMs, eventIdNamespace,
    );
    return plan ? [plan] : [];
  });
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
