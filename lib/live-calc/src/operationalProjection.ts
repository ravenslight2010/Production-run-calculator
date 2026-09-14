import { computeAutoTrackElapsedMs, type AutoTrackSchedule } from "./autoTrackSchedule";
import {
  applyTemporaryOverrides,
  type Calc,
  type CalcRunMeta,
  type CalcStoppage,
  type ServerCalcResult,
} from "./index";
import { computeLinePhases, type LinePhases } from "./linePhases";

export const OPERATIONAL_PROJECTION_VERSION = 1 as const;

/** Outer line stages default (press->tunnel, tunnel->packaging), in minutes. */
export const PRE_POST_TUNNEL_DEFAULT_MIN = 2.5 as const;

export type OperationalProjection = {
  version: typeof OPERATIONAL_PROJECTION_VERSION;
  runId: string;
  lifecycleGeneration: string;
  serverTimeMs: number;
  capturedAtServerMs: number;
  calculationRevision: number;
  effectiveElapsedSec: number;
  /** Day-state-owned 3-stage line model (press/frontline, tunnel, packaging). */
  linePhases: LinePhases;
  timers: {
    nextBatchInSec: number;
    pressRemainingSec: number;
    freezerElapsedSec: number;
    freezerRemainingSec: number;
    currentBatchNum: number;
    secUntilNextBatch: number;
    totalBatchesNeeded: number;
  };
  counters: {
    casesCompleted: number;
    casesInFreezer: number;
    casesOnLine: number;
    casesLeftToRun: number;
    pressCasesLeft: number;
    traysOnLine: number;
    batchesReady: number;
    sauceBarrelsMade: number;
    app1BatchesMade: number;
    app2BatchesMade: number;
    app3BatchesMade: number;
    app4BatchesMade: number;
  };
  facts: {
    runStatus: "pending" | "running" | "paused" | "ended";
    pressDone: boolean;
    paceStatus: Calc["paceStatus"];
    paceDelta: number;
  };
  calc: Calc;
  due: AutoTrackSchedule;
};

function runStatus(run: CalcRunMeta): OperationalProjection["facts"]["runStatus"] {
  if (run.endedAt) return "ended";
  if (run.pausedAt) return "paused";
  if (run.startedAt) return "running";
  return "pending";
}

function number(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

/**
 * Build the live station read model from one server snapshot. The projection
 * deliberately includes both immutable facts and display derivations: clients
 * may animate from serverTimeMs, but only this model is allowed to authorize
 * automatic writes.
 */
export function buildOperationalProjection(args: {
  payload: {
    dayState: { runs: CalcRunMeta[]; currentIndex?: number };
    runValues?: Record<string, Record<string, unknown>>;
    packagingProgress?: Record<string, Record<string, unknown>>;
  };
  serverCalc: ServerCalcResult;
  schedule: AutoTrackSchedule;
  nowMs: number;
  calculationRevision?: number;
}): OperationalProjection {
  const run = args.payload.dayState.runs[args.payload.dayState.currentIndex ?? 0];
  const raw = args.payload.runValues?.[args.serverCalc.runId] ?? {};
  const progress = args.payload.packagingProgress?.[args.serverCalc.runId] ?? {};
  const v = applyTemporaryOverrides({ ...raw, ...progress }) as Record<string, unknown>;
  const effectiveNowMs = run.pausedAt ?? run.endedAt ?? args.nowMs;
  const effectiveElapsedSec = computeAutoTrackElapsedMs({
    startedAt: run.startedAt,
    pausedAt: effectiveNowMs,
    nowMs: effectiveNowMs,
    stoppages: run.stoppages,
  }) / 1000;
  const freezerTotalSec = Math.max(0, number(v.freezerTime) * 60);
  const calcTimePerBatch = args.serverCalc.calc.timePerBatchSec;
  const nextBatchInSec = calcTimePerBatch > 0
    ? Math.max(0, calcTimePerBatch - (effectiveElapsedSec % calcTimePerBatch))
    : 0;
  // Slice 4: batch/finish timing moved server-side — same formulas the client
  // used locally, so no numerical behavior changes (floor for batch num,
  // timePerBatchSec - (elapsed % timePerBatchSec) for seconds-until, ceil for
  // total batches needed).
  const currentBatchNum = calcTimePerBatch > 0
    ? Math.floor(effectiveElapsedSec / calcTimePerBatch)
    : 0;
  const secUntilNextBatch = calcTimePerBatch > 0
    ? calcTimePerBatch - (effectiveElapsedSec % calcTimePerBatch)
    : 0;
  const totalBatchesNeeded = calcTimePerBatch > 0 && args.serverCalc.calc.totalTimeSec > 0
    ? Math.ceil(args.serverCalc.calc.totalTimeSec / calcTimePerBatch)
    : 0;
  // Slice 5: the 3-stage line-phase model is server-owned. It derives from the
  // day-state run lifecycle (startedAt/pausedAt/endedAt/stoppages), the
  // effective (override-applied) timing values, and the server clock — the
  // same shared model the client uses as its offline/lag fallback.
  const pauseRecords = (run.stoppages ?? []).filter((s) => s.type === "pause");
  const openPause = pauseRecords
    .filter((s) => !s.endedAt)
    .reduce<CalcStoppage | undefined>(
      (latest, s) => (!latest || s.startedAt > latest.startedAt ? s : latest),
      undefined,
    );
  const lastClosedPause = pauseRecords
    .filter((s) => !!s.endedAt)
    .reduce<CalcStoppage | undefined>(
      (latest, s) => (!latest || (s.endedAt ?? 0) > (latest.endedAt ?? 0) ? s : latest),
      undefined,
    );
  const linePhases = computeLinePhases({
    elapsedBatchSec: effectiveElapsedSec,
    pausedAt: run.pausedAt,
    lastResumeWallMs: lastClosedPause?.endedAt ?? 0,
    lastPauseStartWallMs: lastClosedPause?.startedAt ?? 0,
    pauseStopsTunnel: openPause?.stopTunnel !== false,
    lastPauseStopsTunnel: lastClosedPause?.stopTunnel !== false,
    runStatus: runStatus(run),
    preTunnelMin: number(v.preTunnelMin) > 0 ? number(v.preTunnelMin) : PRE_POST_TUNNEL_DEFAULT_MIN,
    postTunnelMin: number(v.postTunnelMin) > 0 ? number(v.postTunnelMin) : PRE_POST_TUNNEL_DEFAULT_MIN,
    freezerTime: Math.max(0, number(v.freezerTime)),
    nowMs: args.nowMs,
    endedAt: run.endedAt,
  });

  return {
    version: OPERATIONAL_PROJECTION_VERSION,
    runId: args.serverCalc.runId,
    lifecycleGeneration: `${run.id}:${run.metaUpdatedAt ?? run.startedAt ?? 0}`,
    serverTimeMs: args.nowMs,
    capturedAtServerMs: args.nowMs,
    calculationRevision: args.calculationRevision ?? 0,
    effectiveElapsedSec,
    linePhases,
    timers: {
      nextBatchInSec,
      pressRemainingSec: Math.max(0, args.serverCalc.calc.adjustedTimeSec - effectiveElapsedSec),
      freezerElapsedSec: Math.min(effectiveElapsedSec, freezerTotalSec),
      freezerRemainingSec: Math.max(0, freezerTotalSec - effectiveElapsedSec),
      currentBatchNum,
      secUntilNextBatch,
      totalBatchesNeeded,
    },
    counters: {
      casesCompleted: args.serverCalc.calc.casesCompleted,
      casesInFreezer: args.serverCalc.calc.casesInFreezer,
      casesOnLine: args.serverCalc.calc.casesOnLine,
      casesLeftToRun: args.serverCalc.calc.casesLeftToRun,
      pressCasesLeft: args.serverCalc.calc.pressCasesLeft,
      traysOnLine: number(v.traysOnLine),
      batchesReady: number(v.batchesReady),
      sauceBarrelsMade: number(v.sauceBarrelsMade),
      app1BatchesMade: number(v.app1BatchesMade),
      app2BatchesMade: number(v.app2BatchesMade),
      app3BatchesMade: number(v.app3BatchesMade),
      app4BatchesMade: number(v.app4BatchesMade),
    },
    facts: {
      runStatus: runStatus(run),
      pressDone: args.serverCalc.calc.pressDone,
      paceStatus: args.serverCalc.calc.paceStatus,
      paceDelta: args.serverCalc.calc.paceDelta,
    },
    calc: args.serverCalc.calc,
    due: args.schedule,
  };
}