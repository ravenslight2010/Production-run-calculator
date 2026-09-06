import { randomUUID } from "node:crypto";
import {
  computeAutoTrackElapsedMs,
  computeAutoTrackSchedule,
  computeAutoTrackSuggestion,
  computeServerCalc,
  createWallClockBookkeeping,
  getAutoTrackTiming,
  rearmWallClockTimers,
  tickWallClock,
  type AutoTrackSchedule,
  type WallClockChannel,
  type WallClockBookkeeping,
} from "@workspace/live-calc";
import type { AutoTrackClaim, AutoTrackMutation } from "./autoTrackCoordination";

const NET_CHANNELS = ["sauce-barrel", "app1-batch", "app2-batch", "app3-batch", "app4-batch"] as const;
export const WALL_CLOCK_REPLAY_CAP_MS = 6 * 60 * 60 * 1000;

type Payload = {
  dayState?: { runs?: Array<Record<string, unknown>>; currentIndex?: number };
  runValues?: Record<string, Record<string, unknown>>;
  runValuesUpdatedAt?: Record<string, number>;
  autoTrackCoordination?: { runs?: Record<string, Record<string, {
    generation?: string; sequence?: number; acceptedEventId?: string;
  }>> };
  packagingProgress?: Record<string, Record<string, unknown>>;
  autoTrackServerState?: {
    wallClockBookkeeping?: Record<string, Record<string, unknown>>;
    netOwnership?: Record<string, Record<string, { generation?: string; sequence?: number; updatedAt?: number }>>;
  };
  doughTimerControls?: Record<string, { generation?: string; pausedAt?: number; resumeAt?: number; updatedAt?: number }>;
};
const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
function buildNetMutations(prefix: string, madeFrom: number, madeTo: number, anchorFrom: number, anchorTo: number, correctionGeneration: number): AutoTrackMutation[] {
  return [
    { field: (prefix === "sauceBarrel" ? "sauceBarrelsMade" : `${prefix}esMade`) as AutoTrackMutation["field"], from: madeFrom, to: madeTo },
    { field: `${prefix}AnchorNetSec` as AutoTrackMutation["field"], from: anchorFrom, to: anchorTo },
    { field: `${prefix}CorrectionGeneration` as AutoTrackMutation["field"], from: correctionGeneration, to: correctionGeneration },
  ];
}

function schedule(
  payload: Payload,
  nowMs: number,
  options: { allowEndedDrain?: boolean } = {},
): { schedule: AutoTrackSchedule; values: Record<string, unknown> } | null {
  const result = computeServerCalc(payload as never, [], nowMs);
  const run = payload.dayState?.runs?.[payload.dayState.currentIndex ?? 0];
  if (!result || !run || typeof run.id !== "string") return null;
  // Date rows are client-local (and can legitimately be tomorrow in UTC), so
  // eligibility is lifecycle based rather than server-date based. Conversely,
  // an abandoned old running register must never restart net claims.
  const startedAt = number(run.startedAt);
  const endedAt = number(run.endedAt);
  const values = payload.runValues?.[run.id];
  if (!values) return null;
  const endedDrainActive = options.allowEndedDrain === true
    && endedAt > 0
    && number(values.freezerTime) > 0
    && nowMs < endedAt + number(values.freezerTime) * 60_000;
  const lifecycleStamp = Math.max(startedAt, number(run.metaUpdatedAt));
  if (
    startedAt <= 0
    || number(run.pausedAt) > 0
    || (endedAt > 0 && !endedDrainActive)
    || lifecycleStamp <= 0
    || nowMs - lifecycleStamp > WALL_CLOCK_REPLAY_CAP_MS
  ) return null;
  return {
    schedule: computeAutoTrackSchedule({
      runId: run.id, metaUpdatedAt: number(run.metaUpdatedAt), startedAt: number(run.startedAt),
      pausedAt: number(run.pausedAt) || undefined, endedAt: number(run.endedAt) || undefined,
      stoppages: Array.isArray(run.stoppages) ? run.stoppages as never : undefined,
      v: values as never, calc: result.calc, progress: values,
      coordination: payload.autoTrackCoordination?.runs?.[run.id] as never, nowMs,
      serverNetOwnership: payload.autoTrackServerState?.netOwnership?.[run.id] as never,
      serverWallOwnership: (
        payload.autoTrackServerState?.wallClockBookkeeping?.[run.id] as any
      )?.serverSequences as never,
    }),
    values,
  };
}

/** Builds due sauce/applicator claims entirely from canonical stored state. */
export function buildNetSecondServerClaims(raw: unknown, nowMs = Date.now()): AutoTrackClaim[] {
  const payload = (raw && typeof raw === "object" ? raw : {}) as Payload;
  let built: { schedule: AutoTrackSchedule; values: Record<string, unknown> } | null;
  try { built = schedule(payload, nowMs); } catch { return []; }
  if (!built) return [];
  const { schedule: plan, values } = built;
  const baseUpdatedAt = number(payload.runValuesUpdatedAt?.[plan.runId]);
  const coordination = payload.autoTrackCoordination?.runs?.[plan.runId];
  return plan.entries.flatMap((entry) => {
    if (!(NET_CHANNELS as readonly string[]).includes(entry.channel) || !entry.dueNow) return [];
    const slot = entry.channel === "sauce-barrel" ? "" : entry.channel.slice(0, 4);
    const madeField = entry.channel === "sauce-barrel" ? "sauceBarrelsMade" : `${slot}BatchesMade`;
    const anchorField = entry.channel === "sauce-barrel" ? "sauceBarrelAnchorNetSec" : `${slot}BatchAnchorNetSec`;
    const correctionField = entry.channel === "sauce-barrel" ? "sauceBarrelCorrectionGeneration" : `${slot}BatchCorrectionGeneration`;
    const correctionGeneration = Math.max(0, number(values[correctionField]));
    const prefix = entry.channel === "sauce-barrel" ? "sauceBarrel" : `${slot}Batch`;
    const mutations = buildNetMutations(prefix, Math.max(0, number(values[madeField])), Math.max(0, number(values[madeField])) + 1, Math.max(0, number(values[anchorField])), entry.dueAt, correctionGeneration);
    const cadence = Math.max(0, entry.dueAt - Math.max(0, number(values[anchorField])));
    const claimNextDueAt = entry.nextDueAt > entry.dueAt
      ? entry.nextDueAt : entry.dueAt + cadence;
    return [{
      version: 1, runId: plan.runId, channel: entry.channel, generation: plan.generation,
      sequence: number(coordination?.[entry.channel]?.sequence) + 1,
      eventId: `srv:${entry.channel}:${randomUUID()}`, dueAt: entry.dueAt,
      nextDueAt: claimNextDueAt, baseUpdatedAt, correctionGeneration, mutations,
    } as AutoTrackClaim];
  });
}

/** Server bootstrap for wall-clock channels. Bookkeeping is deliberately
 * persisted by the caller even if no channel is due, so restarts cannot replay
 * a stale beat. Canonical client coordination always takes ownership back. */
export type ServerWallClockBookkeeping = WallClockBookkeeping & {
  lifecycleGeneration: string;
  serverSequences: Partial<Record<WallClockChannel, number>>;
  appliedDoughControlUpdatedAt?: number;
};
export function buildWallClockServerClaims(raw: unknown, nowMs = Date.now()): { runId: string; bookkeeping: ServerWallClockBookkeeping; claims: AutoTrackClaim[] } | null {
  const payload = (raw && typeof raw === "object" ? raw : {}) as Payload;
  const built = schedule(payload, nowMs, { allowEndedDrain: true });
  const run = payload.dayState?.runs?.[payload.dayState?.currentIndex ?? 0];
  if (!built || !run || number(run.startedAt) <= 0 || number(run.pausedAt) > 0) return null;
  const { schedule: plan, values } = built;
  const endedAt = number(run.endedAt);
  const drainActive = endedAt > 0
    && number(values.freezerTime) > 0
    && nowMs < endedAt + number(values.freezerTime) * 60_000;
  const runStatus = drainActive ? "ended" : "running";
  const old = payload.autoTrackServerState?.wallClockBookkeeping?.[plan.runId] ?? {};
  const calc = computeServerCalc(payload as never, [], nowMs)!.calc;
  const timing = getAutoTrackTiming(calc.ppm, number(values.pizzasPerCase), calc.perTray, calc.perBatch, {
    spinSec: number(values.mixerLowSec) + number(values.mixerHighSec),
    hopperSec: number(values.hopperSec),
  });
  const freshBookkeeping = createWallClockBookkeeping();
  const bookNumber = (field: keyof WallClockBookkeeping, fallback = 0) =>
    typeof old[field] === "number" && Number.isFinite(old[field]) ? old[field] as number : fallback;
  let bookkeeping: WallClockBookkeeping = {
    caseNextDueMs: bookNumber("caseNextDueMs"),
    trayProdNextDueMs: bookNumber("trayProdNextDueMs"),
    trayConsNextDueMs: bookNumber("trayConsNextDueMs"),
    batchProdNextDueMs: bookNumber("batchProdNextDueMs"),
    batchConsNextDueMs: bookNumber("batchConsNextDueMs"),
    hopperNextDueMs: bookNumber("hopperNextDueMs"),
    trayLastMs: bookNumber("trayLastMs"),
    batchLastMs: bookNumber("batchLastMs"),
    lastExpectedCases: bookNumber("lastExpectedCases", freshBookkeeping.lastExpectedCases),
    drainFreezer: bookNumber("drainFreezer", freshBookkeeping.drainFreezer),
    traysRemainder: bookNumber("traysRemainder"),
    traySeeded: old.traySeeded === true,
    batchSeeded: old.batchSeeded === true,
    formResetSkipped: old.formResetSkipped === true,
    caseClaimRetry: old.caseClaimRetry === true,
    doughPausedAtMs: bookNumber("doughPausedAtMs"),
    doughResumeAtMs: bookNumber("doughResumeAtMs"),
  };
  const hasPersistedBookkeeping = Object.keys(old).some((key) => key !== "lifecycleGeneration");
  let serverSequences = old.serverSequences && typeof old.serverSequences === "object"
    ? { ...old.serverSequences } as Partial<Record<WallClockChannel, number>>
    : {};
  if (hasPersistedBookkeeping && old.lifecycleGeneration !== plan.generation) {
    const priorCaseNextDueMs = bookkeeping.caseNextDueMs;
    const priorDrainFreezer = bookkeeping.drainFreezer;
    bookkeeping = rearmWallClockTimers(freshBookkeeping, nowMs, timing);
    // End Run advances the lifecycle generation, but the physical freezer keeps
    // draining. Preserve its last observed contents and case arm so the first
    // ended-generation beat accounts for exactly what exited across the handoff.
    // Every dough-owned timer still rebases and other lifecycle transitions keep
    // the normal full reset above.
    if (drainActive) {
      bookkeeping.caseNextDueMs = priorCaseNextDueMs > 0
        ? priorCaseNextDueMs
        : bookkeeping.caseNextDueMs;
      bookkeeping.drainFreezer = priorDrainFreezer;
    }
    serverSequences = {};
  }
  const coordination = payload.autoTrackCoordination?.runs?.[plan.runId];
  const elapsedSec = computeAutoTrackElapsedMs({
    startedAt: number(run.startedAt), pausedAt: number(run.pausedAt) || undefined, nowMs,
    stoppages: Array.isArray(run.stoppages) ? run.stoppages as never : undefined,
  }) / 1000;
  const suggestion = computeAutoTrackSuggestion({
    runStatus, drainActive, packagingDrainActive: false, packagingDrainElapsedSec: 0,
    ppm: calc.ppm, casesPerSkid: number(values.casesPerSkid), pizzasPerCase: number(values.pizzasPerCase),
    casesNeeded: number(values.casesNeeded), freezerTime: number(values.freezerTime), elapsedBatchSec: elapsedSec,
  });
  // Pre-engine records persisted only the six due refs. When adopting one of
  // those overdue arms, preserve its already-authorized single case beat while
  // establishing the engine's incremental baseline; subsequent beats use the
  // normal elapsed/freezer calculation exclusively.
  const legacyCaseArm = old.lifecycleGeneration === plan.generation
    && typeof old.caseNextDueMs === "number"
    && !Object.prototype.hasOwnProperty.call(old, "lastExpectedCases")
    && old.caseNextDueMs <= nowMs;
  const legacyExpected = number(values.skidsCompleted) * number(values.casesPerSkid)
    + number(values.casesOnCurrentSkid) + 1;
  const expectedCasesRaw = legacyCaseArm
    ? Math.max(suggestion?.expectedCasesRaw ?? 0, legacyExpected)
    : suggestion?.expectedCasesRaw ?? 0;
  const expectedCases = number(values.casesNeeded) > 0
    ? Math.min(number(values.casesNeeded), expectedCasesRaw)
    : expectedCasesRaw;
  const control = payload.doughTimerControls?.[plan.runId];
  const matchingControl = control?.generation === plan.generation;
  const pausedByControl = matchingControl && number(control.pausedAt) > 0
    && (number(control.resumeAt) === 0 || number(control.resumeAt) > nowMs);
  const timedResume = matchingControl && number(control.pausedAt) > 0
    && number(control.resumeAt) > 0 && number(control.resumeAt) <= nowMs
    && number(old.appliedDoughControlUpdatedAt) !== number(control.updatedAt);
  if (timedResume) {
    bookkeeping = {
      ...bookkeeping,
      doughPausedAtMs: number(control?.pausedAt),
      doughResumeAtMs: number(control?.resumeAt),
    };
  } else if (pausedByControl) {
    bookkeeping = {
      ...bookkeeping,
      doughPausedAtMs: bookkeeping.doughPausedAtMs || number(control?.pausedAt),
      doughResumeAtMs: number(control?.resumeAt),
    };
  } else if (matchingControl && number(control?.pausedAt) === 0 && bookkeeping.doughPausedAtMs > 0) {
    bookkeeping = rearmWallClockTimers(bookkeeping, nowMs, timing);
  }
  const tick = tickWallClock({
    bookkeeping, nowMs, timing, runStatus, drainActive, packagingDrainActive: false,
    packagingAutoTrackActive: true, caseSuppressed: false, doughSuppressed: false,
    calc: { ppm: calc.ppm, perTray: calc.perTray, perBatch: calc.perBatch, pressDone: calc.pressDone, casesInFreezer: calc.casesInFreezer, traysNeeded: calc.traysNeeded, batchesNeeded: calc.batchesNeeded },
    v: { pizzasPerCase: number(values.pizzasPerCase), casesPerSkid: number(values.casesPerSkid), casesNeeded: number(values.casesNeeded), traysOnLine: number(values.traysOnLine), batchesReady: number(values.batchesReady) },
    form: { skidsCompleted: number(values.skidsCompleted), casesOnCurrentSkid: number(values.casesOnCurrentSkid), traysOnLine: number(values.traysOnLine), batchesReady: number(values.batchesReady) },
    expectedCasesRaw, expectedCases,
  });
  const claims = tick.events
    .filter((event) => {
      const state = coordination?.[event.channel];
      if (!state) return true;
      // Manual invalidation remains client-owned until a current-generation
      // register is established. A current client register is a safe takeover
      // base once its due boundary actually produces an engine event.
      if (state.generation !== plan.generation) {
        // End advances the lifecycle generation while the same physical case
        // stream drains. Let the new generation's sequence-1 claim arbitrate
        // through the normal row lock regardless of whether the browser or
        // server owned the running generation. Competing browser/server claims
        // for the ended generation cannot both be accepted.
        return drainActive && event.channel === "case";
      }
      const ownedSequence = number(serverSequences[event.channel]);
      return ownedSequence === 0 || ownedSequence === number(state.sequence);
    })
    .map((event) => ({
      version: 1, runId: plan.runId, channel: event.channel, generation: plan.generation,
      sequence: coordination?.[event.channel]?.generation === plan.generation
        ? number(coordination[event.channel]?.sequence) + 1 : 1,
      eventId: `srv:wc:${event.channel}:${randomUUID()}`,
      dueAt: event.dueAt, nextDueAt: event.nextDueAt, baseUpdatedAt: number(payload.runValuesUpdatedAt?.[plan.runId]),
      ...(event.channel === "case" ? { correctionGeneration: number(payload.packagingProgress?.[plan.runId]?.correctionGeneration) } : {}),
      mutations: event.mutations as AutoTrackMutation[],
    } as AutoTrackClaim));
  for (const claim of claims) {
    serverSequences[claim.channel as WallClockChannel] = claim.sequence;
  }
  return {
    runId: plan.runId,
    bookkeeping: {
      ...tick.next, lifecycleGeneration: plan.generation, serverSequences,
      appliedDoughControlUpdatedAt: timedResume
        ? number(control?.updatedAt) : number(old.appliedDoughControlUpdatedAt),
    },
    claims,
  };
}