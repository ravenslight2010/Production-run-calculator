import { computeAutoTrackElapsedMs, type AutoTrackSchedule } from "./autoTrackSchedule";
import {
  applyTemporaryOverrides,
  type Calc,
  type CalcRunMeta,
  type ServerCalcResult,
} from "./index";

export const OPERATIONAL_PROJECTION_VERSION = 1 as const;

export type OperationalProjection = {
  version: typeof OPERATIONAL_PROJECTION_VERSION;
  runId: string;
  lifecycleGeneration: string;
  serverTimeMs: number;
  capturedAtServerMs: number;
  calculationRevision: number;
  effectiveElapsedSec: number;
  timers: {
    nextBatchInSec: number;
    pressRemainingSec: number;
    freezerElapsedSec: number;
    freezerRemainingSec: number;
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
  const nextBatchInSec = args.serverCalc.calc.timePerBatchSec > 0
    ? Math.max(0, args.serverCalc.calc.timePerBatchSec -
      (effectiveElapsedSec % args.serverCalc.calc.timePerBatchSec))
    : 0;

  return {
    version: OPERATIONAL_PROJECTION_VERSION,
    runId: args.serverCalc.runId,
    lifecycleGeneration: `${run.id}:${run.metaUpdatedAt ?? run.startedAt ?? 0}`,
    serverTimeMs: args.nowMs,
    capturedAtServerMs: args.nowMs,
    calculationRevision: args.calculationRevision ?? 0,
    effectiveElapsedSec,
    timers: {
      nextBatchInSec,
      pressRemainingSec: Math.max(0, args.serverCalc.calc.adjustedTimeSec - effectiveElapsedSec),
      freezerElapsedSec: Math.min(effectiveElapsedSec, freezerTotalSec),
      freezerRemainingSec: Math.max(0, freezerTotalSec - effectiveElapsedSec),
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