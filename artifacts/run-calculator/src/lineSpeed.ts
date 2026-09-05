export type LineSpeedMode = "dough" | "crusts";

export type EffectiveLineSpeedInput = {
  mode: LineSpeedMode;
  crustsPerCycle?: number | null;
  cycleSpeed?: number | null;
  speedAdjustment?: number | null;
  approxLineSpeed?: number | null;
};

function finiteOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

/**
 * Returns the single line-speed basis used by live production calculations.
 *
 * Dough runs use the cycle-derived speed adjusted by the configured multiplier.
 * Crust runs use their approximate speed directly; they do not inherit the
 * dough multiplier. Invalid or non-positive speeds are disabled rather than
 * producing NaN, Infinity, or false timers.
 */
export function computeEffectiveLineSpeed(input: EffectiveLineSpeedInput): number {
  if (input.mode === "crusts") {
    const approxPpm = finiteOrZero(input.approxLineSpeed);
    return approxPpm > 0 ? Math.round(approxPpm * 100) / 100 : 0;
  }

  const crustsPerCycle = finiteOrZero(input.crustsPerCycle);
  const cycleSpeed = finiteOrZero(input.cycleSpeed);
  // The schema default is 1. A missing legacy value should retain that safe
  // default, while an explicit zero remains disabled instead of inventing a
  // line speed.
  const speedAdjustment = input.speedAdjustment == null || !Number.isFinite(input.speedAdjustment)
    ? 1
    : Number(input.speedAdjustment);
  const adjustedPpm = crustsPerCycle * cycleSpeed * speedAdjustment;
  return adjustedPpm > 0 ? Math.round(adjustedPpm * 100) / 100 : 0;
}