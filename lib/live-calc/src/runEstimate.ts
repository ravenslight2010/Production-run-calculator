import { applyTemporaryOverrides, computeEffectiveLineSpeed, type CalcRunMeta, type LineSpeedMode } from "./index";
import { FACTORY_SPEED_ADJUSTMENT_BASELINE } from "@workspace/factory-constants";

export interface RunEstimateValues {
  casesNeeded?: number;
  pizzasPerCase?: number;
  approxLineSpeed?: number;
  crustsPerCycle?: number;
  cycleSpeed?: number;
  speedAdjustment?: number;
  freezerTime?: number | string;
  tempFreezerTime?: number;
  tempCrustsPerCycle?: number;
  tempCycleSpeed?: number;
  skidsCompleted?: number;
  casesPerSkid?: number;
  casesOnCurrentSkid?: number;
}

export interface RunEstimate {
  durationSec?: number;
  remainingSec?: number;
  basis: "actual" | "live" | "paused" | "planned";
  missing: string[];
  cases?: number;
  pizzasPerCase?: number;
  ppm?: number;
  freezerMin?: number;
  completedCases?: number;
  leadInSec?: number;
  mode: LineSpeedMode;
  crustsPerCycle?: number;
  cyclesPerMin?: number;
  speedAdjustment?: number;
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * Packaging-clear estimate, not the press-finished clock. Uses the same rate,
 * accepted packaging counters and pause-frozen freezer fill as computeCalc.
 * No occupancy-only two-wide allowance is added to a completion time.
 */
export function estimateRun(
  values: RunEstimateValues | undefined,
  run: CalcRunMeta & { subTab?: LineSpeedMode } = {},
  nowMs = Date.now(),
): RunEstimate {
  const v = values ?? {};
  const ve = applyTemporaryOverrides({ ...v });
  const mode = run.subTab ?? "dough";
  const basis = run.endedAt ? "actual" : run.startedAt ? run.pausedAt ? "paused" : "live" : "planned";
  const result: RunEstimate = { mode, basis, missing: [] };
  if (!positive(v.casesNeeded)) result.missing.push("cases needed (> 0)");
  else result.cases = v.casesNeeded;
  if (!positive(v.pizzasPerCase)) result.missing.push("pizzas per case (> 0)");
  else result.pizzasPerCase = v.pizzasPerCase;
  if (mode === "crusts") {
    if (!positive(v.approxLineSpeed)) result.missing.push("line speed (pizzas/min)");
  } else {
    result.crustsPerCycle = ve.crustsPerCycle;
    result.cyclesPerMin = ve.cycleSpeed;
    result.speedAdjustment = v.speedAdjustment ?? FACTORY_SPEED_ADJUSTMENT_BASELINE;
    if (!positive(ve.crustsPerCycle)) result.missing.push("crusts per cycle (> 0)");
    if (!positive(ve.cycleSpeed)) result.missing.push("cycles per minute (> 0)");
    if (v.speedAdjustment !== undefined && !positive(v.speedAdjustment)) result.missing.push("speed adjustment (> 0)");
  }
  const ppm = computeEffectiveLineSpeed({ ...ve, mode });
  if (positive(ppm)) result.ppm = ppm;
  else if (!result.missing.some((s) => /speed|cycle/.test(s))) result.missing.push("effective rate (pizzas/min)");
  const freezer = typeof ve.freezerTime === "string" && ve.freezerTime.trim() !== ""
    ? Number(ve.freezerTime) : ve.freezerTime;
  if (!nonnegative(freezer)) result.missing.push("freezer transit (minutes, 0 allowed)");
  else result.freezerMin = freezer;
  if (result.missing.length) return result;
  const duration = v.casesNeeded! * v.pizzasPerCase! / ppm * 60 + result.freezerMin! * 60;
  if (!Number.isFinite(duration)) {
    result.missing.push("finite production duration");
    return result;
  }
  result.durationSec = duration;
  if (!run.startedAt || run.endedAt) return result;
  const skids = v.skidsCompleted ?? 0;
  const loose = v.casesOnCurrentSkid ?? 0;
  if (!nonnegative(skids) || !nonnegative(loose) || (skids > 0 && !positive(v.casesPerSkid))) {
    result.missing.push("valid packaging progress and cases per skid");
    return result;
  }
  const completed = skids * (v.casesPerSkid ?? 0) + loose;
  if (!Number.isFinite(completed) || !Number.isFinite(nowMs) || !positive(run.startedAt)
    || (run.pausedAt !== undefined && !positive(run.pausedAt))) {
    result.missing.push("finite progress and lifecycle clock");
    return result;
  }
  result.completedCases = completed;
  // Resume shifts startedAt in the existing lifecycle; do not subtract closed
  // pauses a second time. While paused, fill remains frozen at pausedAt.
  const elapsedSec = Math.max(0, ((run.pausedAt ?? nowMs) - run.startedAt) / 1000);
  result.leadInSec = Math.max(0, result.freezerMin! * 60 - elapsedSec);
  const left = Math.max(0, v.casesNeeded! - completed);
  result.remainingSec = left === 0 ? 0 : left * v.pizzasPerCase! / ppm * 60 + result.leadInSec;
  if (!Number.isFinite(result.remainingSec)) {
    result.remainingSec = undefined;
    result.missing.push("finite remaining duration");
  }
  return result;
}
