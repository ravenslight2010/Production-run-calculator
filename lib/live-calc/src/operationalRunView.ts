import {
  applyTemporaryOverrides,
  computeServerCalc,
  type Calc,
  type CalcRunMeta,
  type ServerCalcSyncPayload,
} from "./index";
import {
  computeEndedRunElapsedSec,
  computeLinePhases,
  type LinePhases,
} from "./linePhases";

/** Versioned, complete snapshot accepted by the operational read model. */
export interface OperationalSyncSnapshotV1 extends ServerCalcSyncPayload {
  syncVersion: 1;
  completeness: "complete";
}

/** Metadata belongs to the snapshot transport, not to an individual run. */
export interface OperationalSnapshotMetadataV1 {
  snapshotId: string;
  capturedAt: number;
  /** The reset generation under which the snapshot was assembled. */
  resetAt?: number;
  /** Optional source date; it must agree with the requested operational date. */
  date?: string;
  /** Defaults to one minute. */
  maxAgeMs?: number;
}

export interface DeriveOperationalRunViewArgsV1 {
  snapshot: OperationalSyncSnapshotV1;
  date: string;
  runId: string;
  nowMs: number;
  snapshotMetadata: OperationalSnapshotMetadataV1;
  defaultPepTypes?: string[];
}

export type OperationalRunStatus = "not-started" | "running" | "paused" | "ended";
export type OperationalFreshness = "fresh" | "stale";

export interface OperationalRunViewV1 {
  version: 1;
  date: string;
  runId: string;
  observed: {
    /** Product identity from the canonical scheduled run. */
    brand: string;
    flavor: string;
    status: OperationalRunStatus;
    startedAt?: number;
    pausedAt?: number;
    endedAt?: number;
    elapsedBatchSec: number;
    /** Snapshot-level ingredient substitutions in effect for this operational date. */
    substitutionsApplied: number;
    packagingProgress: { skidsCompleted: number; casesOnCurrentSkid: number } | null;
    temporaryOverrides: {
      freezerTime: boolean;
      crustsPerCycle: boolean;
      cycleSpeed: boolean;
    };
    /** Canonical stoppage facts, including only closed intervals in downtime. */
    stoppages: { count: number; downtimeSeconds: number };
  };
  recap: {
    casesNeeded: number;
    casesCompleted: number;
    casesLeftToRun: number;
    pressDone: boolean;
    extraCases: number;
  };
  elapsed: { batchSec: number; phase: LinePhases };
  pace: Pick<Calc, "ppm" | "paceStatus" | "paceDelta" | "catchUpPpm">;
  advisory: {
    freezer: { cases: number; configuredMinutes: number };
    line: { cases: number };
  };
  calculatedAt: number;
  freshness: {
    status: OperationalFreshness;
    snapshotId: string;
    capturedAt: number;
    ageMs: number;
    maxAgeMs: number;
  };
  formulaProvenance: {
    policy: "operational-run-view";
    policyVersion: 1;
    calculator: "computeServerCalc";
    calculatorVersion: 1;
    temporaryOverrides: "applyTemporaryOverrides";
    inventory: ["computeCasesOnLine", "computeCasesInFreezer"];
    linePhases: "computeLinePhases";
    linePhasesVersion: 1;
  };
}

export class OperationalRunViewError extends Error {
  constructor(
    public readonly code:
      | "invalid-snapshot"
      | "reset-mismatch"
      | "missing-run"
      | "duplicate-run"
      | "invalid-run",
    message: string,
  ) {
    super(message);
    this.name = "OperationalRunViewError";
  }
}

function finiteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function runStatus(run: CalcRunMeta): OperationalRunStatus {
  if (finiteTimestamp(run.endedAt)) return "ended";
  if (finiteTimestamp(run.pausedAt)) return "paused";
  if (finiteTimestamp(run.startedAt)) return "running";
  return "not-started";
}

function elapsedBatchSec(run: CalcRunMeta, nowMs: number): number {
  if (!finiteTimestamp(run.startedAt)) return 0;
  if (finiteTimestamp(run.endedAt)) return computeEndedRunElapsedSec({
    startedAt: run.startedAt, endedAt: run.endedAt, stoppages: run.stoppages as never,
  });
  const reference = finiteTimestamp(run.pausedAt) ? run.pausedAt : nowMs;
  const nonPauseDowntime = (run.stoppages ?? [])
    .filter((item) => item.type !== "pause" && finiteTimestamp(item.endedAt))
    .reduce((sum, item) => sum + Math.max(0, item.endedAt! - item.startedAt), 0);
  return Math.max(0, reference - run.startedAt - nonPauseDowntime) / 1000;
}

/** Derives a server-safe operational view without mutating the sync snapshot. */
export function deriveOperationalRunView(
  args: DeriveOperationalRunViewArgsV1,
): OperationalRunViewV1 {
  const { snapshot, date, runId, nowMs, snapshotMetadata } = args;
  if (!snapshot || snapshot.syncVersion !== 1 || snapshot.completeness !== "complete" ||
    !snapshot.dayState || !Array.isArray(snapshot.dayState.runs)) {
    throw new OperationalRunViewError("invalid-snapshot", "A complete v1 sync snapshot is required.");
  }
  if (!date || !runId || !finiteTimestamp(nowMs) || !snapshotMetadata?.snapshotId ||
    !finiteTimestamp(snapshotMetadata.capturedAt)) {
    throw new OperationalRunViewError("invalid-snapshot", "date, runId, nowMs, and snapshot metadata are required.");
  }
  const state = snapshot.dayState as ServerCalcSyncPayload["dayState"] & {
    date?: string; resetAt?: number; substitutions?: unknown[];
  };
  if ((state.date && state.date !== date) || (snapshotMetadata.date && snapshotMetadata.date !== date) ||
    (finiteTimestamp(state.resetAt) && finiteTimestamp(snapshotMetadata.resetAt) &&
      state.resetAt !== snapshotMetadata.resetAt)) {
    throw new OperationalRunViewError("reset-mismatch", "Snapshot date or reset generation does not match the request.");
  }
  const matches = state.runs.filter((run) => run.id === runId);
  if (matches.length === 0) throw new OperationalRunViewError("missing-run", `Run "${runId}" is absent from the snapshot.`);
  if (matches.length > 1) throw new OperationalRunViewError("duplicate-run", `Run "${runId}" occurs more than once.`);
  const run = matches[0];
  if (!run.id || (run.startedAt !== undefined && !finiteTimestamp(run.startedAt)) ||
    (run.pausedAt !== undefined && !finiteTimestamp(run.pausedAt)) ||
    (run.endedAt !== undefined && !finiteTimestamp(run.endedAt)) ||
    (finiteTimestamp(run.startedAt) && finiteTimestamp(run.endedAt) && run.endedAt < run.startedAt) ||
    !snapshot.runValues?.[runId] || typeof snapshot.runValues[runId] !== "object") {
    throw new OperationalRunViewError("invalid-run", `Run "${runId}" has invalid lifecycle or values.`);
  }

  const currentIndex = state.runs.indexOf(run);
  const result = computeServerCalc({ ...snapshot, dayState: { ...state, currentIndex } }, args.defaultPepTypes ?? [], nowMs);
  if (!result) throw new OperationalRunViewError("invalid-run", `Run "${runId}" cannot be calculated.`);
  const raw = snapshot.runValues[runId] as Record<string, unknown>;
  const effective = applyTemporaryOverrides(raw);
  const latestPause = [...(run.stoppages ?? [])].filter((s) => s.type === "pause")
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const latestClosedPause = [...(run.stoppages ?? [])].filter((s) => s.type === "pause" && finiteTimestamp(s.endedAt))
    .sort((a, b) => b.endedAt! - a.endedAt!)[0];
  const status = runStatus(run);
  const elapsed = elapsedBatchSec(run, nowMs);
  const stoppages = run.stoppages ?? [];
  const downtimeSeconds = stoppages.reduce((sum, item) =>
    item.type === "pause" || !finiteTimestamp(item.endedAt)
      ? sum
      : sum + Math.max(0, item.endedAt - item.startedAt), 0);
  const phase = computeLinePhases({
    elapsedBatchSec: elapsed, pausedAt: run.pausedAt, lastResumeWallMs: latestClosedPause?.endedAt ?? 0,
    lastPauseStartWallMs: latestClosedPause?.startedAt ?? 0, pauseStopsTunnel: latestPause?.stopTunnel,
    lastPauseStopsTunnel: latestClosedPause?.stopTunnel, preTunnelMin: 2.5, postTunnelMin: 2.5,
    freezerTime: Number(effective.freezerTime) || 0, nowMs, endedAt: run.endedAt,
    runStatus: status,
  });
  const progress = snapshot.packagingProgress?.[runId];
  const ageMs = Math.max(0, nowMs - snapshotMetadata.capturedAt);
  const maxAgeMs = snapshotMetadata.maxAgeMs ?? 60_000;
  const usedOverride = (name: string) => Number(raw[`temp${name}`]) > 0;
  return {
    version: 1, date, runId,
    observed: {
      brand: typeof (run as CalcRunMeta & { brand?: unknown }).brand === "string"
        ? (run as CalcRunMeta & { brand: string }).brand : "",
      flavor: typeof (run as CalcRunMeta & { flavor?: unknown }).flavor === "string"
        ? (run as CalcRunMeta & { flavor: string }).flavor : "",
      status, startedAt: run.startedAt, pausedAt: run.pausedAt, endedAt: run.endedAt, elapsedBatchSec: elapsed,
      substitutionsApplied: Array.isArray(state.substitutions) ? state.substitutions.length : 0,
      packagingProgress: progress ? { skidsCompleted: progress.skidsCompleted, casesOnCurrentSkid: progress.casesOnCurrentSkid } : null,
      temporaryOverrides: { freezerTime: usedOverride("FreezerTime"), crustsPerCycle: usedOverride("CrustsPerCycle"), cycleSpeed: usedOverride("CycleSpeed") },
      stoppages: { count: stoppages.length, downtimeSeconds },
    },
    recap: { casesNeeded: Number(raw.casesNeeded) || 0, casesCompleted: result.calc.casesCompleted, casesLeftToRun: result.calc.casesLeftToRun, pressDone: result.calc.pressDone, extraCases: result.calc.extraCases },
    elapsed: { batchSec: elapsed, phase },
    pace: { ppm: result.calc.ppm, paceStatus: result.calc.paceStatus, paceDelta: result.calc.paceDelta, catchUpPpm: result.calc.catchUpPpm },
    advisory: { freezer: { cases: result.calc.casesInFreezer, configuredMinutes: Number(effective.freezerTime) || 0 }, line: { cases: result.calc.casesOnLine } },
    calculatedAt: nowMs,
    freshness: { status: ageMs > maxAgeMs ? "stale" : "fresh", snapshotId: snapshotMetadata.snapshotId, capturedAt: snapshotMetadata.capturedAt, ageMs, maxAgeMs },
    formulaProvenance: {
      policy: "operational-run-view",
      policyVersion: 1,
      calculator: "computeServerCalc",
      calculatorVersion: 1,
      temporaryOverrides: "applyTemporaryOverrides",
      inventory: ["computeCasesOnLine", "computeCasesInFreezer"],
      linePhases: "computeLinePhases",
      linePhasesVersion: 1,
    },
  };
}