import { computeCasesInFreezer } from "@workspace/inventory-math";
import { withTempOverrides, type FormValues, type RunMeta } from "./types";
import { computeEffectiveLineSpeed } from "./lineSpeed";
import { computeSummaryStats, runLabel } from "./utils";

/** A normalized run fact shared by deterministic recap, anomaly, and scheduling tools. */
export type ShapedRun = {
  id: string;
  label: string;
  brand: string;
  flavor: string;
  dieType: string;
  status: "running" | "upcoming" | "finished";
  casesNeeded: number;
  casesMade: number;
  casesOnLine?: number;
  casesLeft: number;
  plannedPpm: number;
  actualPpm: number | null;
  minutesRemaining: number | null;
  netElapsedSec: number;
  downtimeSec: number;
  stoppages: { reason: string; durationSec: number; open: boolean }[];
  pizzasPerCase?: number;
  casesPerSkid?: number;
};

function statusOf(run: RunMeta): ShapedRun["status"] {
  if (run.endedAt) return "finished";
  if (run.startedAt) return "running";
  return "upcoming";
}

export function buildShapedRun(run: RunMeta, vals: FormValues, nowMs: number): ShapedRun {
  const summary = computeSummaryStats(vals);
  const status = statusOf(run);
  const effectiveVals = withTempOverrides(vals);
  const pizzasPerCase = effectiveVals.pizzasPerCase;
  const plannedPpm = Math.round(computeEffectiveLineSpeed({
    mode: run.subTab === "crusts" ? "crusts" : "dough",
    approxLineSpeed: vals.approxLineSpeed,
    crustsPerCycle: vals.crustsPerCycle,
    cycleSpeed: vals.cycleSpeed,
    speedAdjustment: vals.speedAdjustment,
  }));
  const downtimeSec = (run.stoppages ?? [])
    .filter((stop) => stop.endedAt && stop.type !== "pause")
    .reduce((total, stop) => total + (stop.endedAt! - stop.startedAt) / 1000, 0);
  const endRef = run.endedAt ?? run.pausedAt ?? (run.startedAt ? nowMs : undefined);
  const grossDurSec = run.startedAt && endRef ? (endRef - run.startedAt) / 1000 : 0;
  const openPauseAtEndSec = run.endedAt == null ? 0 : (run.stoppages ?? [])
    .filter((stop) => stop.type === "pause" && stop.startedAt < run.endedAt! &&
      (stop.endedAt == null || stop.endedAt >= run.endedAt!))
    .reduce((total, stop) => total + (run.endedAt! - stop.startedAt) / 1000, 0);
  const netElapsedSec = Math.max(0, grossDurSec - downtimeSec - openPauseAtEndSec);
  const liveCasesMade = vals.skidsCompleted * vals.casesPerSkid + vals.casesOnCurrentSkid;
  const casesMade = status === "finished" ? run.actualCases ?? summary.totalCases :
    status === "running" ? Math.max(0, liveCasesMade) : 0;
  const casesLeft = Math.max(0, vals.casesNeeded - casesMade);

  return {
    id: run.id, label: runLabel(run), brand: run.brand, flavor: run.flavor,
    dieType: vals.dieType ?? "", status, casesNeeded: vals.casesNeeded, casesMade,
    casesOnLine: computeCasesInFreezer({
      startedAt: run.startedAt, endedAt: run.endedAt, pausedAt: run.pausedAt,
      stoppages: run.stoppages, now: nowMs, ppm: plannedPpm,
      pizzasPerCase, freezerTimeMin: effectiveVals.freezerTime,
    }),
    casesLeft, plannedPpm,
    actualPpm: netElapsedSec > 0 && casesMade > 0 && pizzasPerCase > 0
      ? Math.round((casesMade * pizzasPerCase) / (netElapsedSec / 60)) : null,
    minutesRemaining: status === "running" && casesLeft > 0 && plannedPpm > 0 && pizzasPerCase > 0
      ? Math.round((casesLeft * pizzasPerCase) / plannedPpm) : null,
    netElapsedSec: Math.round(netElapsedSec), downtimeSec: Math.round(downtimeSec),
    stoppages: (run.stoppages ?? []).filter((stop) => stop.type !== "pause").map((stop) => ({
      reason: stop.reason || "Stoppage",
      durationSec: (stop.endedAt ? stop.endedAt - stop.startedAt : nowMs - stop.startedAt) / 1000,
      open: !stop.endedAt,
    })),
    pizzasPerCase, casesPerSkid: vals.casesPerSkid,
  };
}