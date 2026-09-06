import { randomUUID } from "node:crypto";
import {
  buildAppSlotClaimMutations,
  buildAutoTrackScheduleFromPayload,
  buildSauceClaimMutations,
  computeAutoTrackElapsedMs,
  computeAutoTrackSuggestion,
  computeServerCalc,
  createWallClockBookkeeping,
  getAutoTrackTiming,
  tickWallClock,
  type Calc,
  type WallClockBookkeeping,
} from "@workspace/live-calc";
import type { AutoTrackClaim, AutoTrackMutation } from "./autoTrackCoordination";

/** Channels the server tick loop executes (refactor step 7a): the net-second
 * channels whose due times the server derives purely from stored state
 * (anchor + cadence vs pause-aware elapsed net seconds). The wall-clock
 * channels (case/tray/batch/hopper) depend on client arm-state machines
 * (period advance, remainder carry, feed-complete gates) and stay
 * client-driven; the server only echoes their canonical coordination. */
export const SERVER_TICK_CHANNELS = new Set<string>([
  "sauce-barrel",
  "app1-batch",
  "app2-batch",
  "app3-batch",
  "app4-batch",
]);

export function isServerTickChannel(channel: string): boolean {
  return SERVER_TICK_CHANNELS.has(channel);
}

/** Wall-clock channels the server can bootstrap for a fresh run (step 7b):
 * the client arm-state machines ported into `tickWallClock` (case, tray
 * consume/produce, batch consume/produce, hopper cycle). The net-second
 * channels above are derived purely from stored anchors; these need
 * per-run bookkeeping, which the runner persists under
 * `autoTrackServerState.wallClockBookkeeping[runId]`. */
export const WALL_CLOCK_CHANNELS = [
  "case",
  "tray-consume",
  "tray-produce",
  "batch-consume",
  "batch-produce",
  "hopper",
] as const;

export type WallClockChannel = (typeof WALL_CLOCK_CHANNELS)[number];

/** Same fresh-run replay window the schedule uses for compute-only wall-clock
 * verdicts. Once a register is canonical (any claim landed), the server stops
 * driving that channel and hands it back to clients. */
export const WALL_CLOCK_REPLAY_CAP_MS = 6 * 60 * 60 * 1000;

const WALL_CLOCK_MUTATION_FIELDS: Record<WallClockChannel, readonly string[]> = {
  case: ["skidsCompleted", "casesOnCurrentSkid"],
  "tray-consume": ["traysOnLine"],
  "tray-produce": ["traysOnLine"],
  "batch-consume": ["batchesReady"],
  "batch-produce": ["batchesReady"],
  hopper: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumber(value: unknown): number {
  return finiteNumber(value) ? value : 0;
}

/** Per-run arm-state stored under `autoTrackServerState.wallClockBookkeeping`.
 * Missing/malformed entries fall back to a fresh bootstrap (same as a brand-new
 * run), never NaN. */
export function sanitizeWallClockBookkeeping(raw: unknown): WallClockBookkeeping {
  const base = createWallClockBookkeeping();
  const r = isPlainObject(raw) ? raw : {};
  const num = (key: string): number => (finiteNumber(r[key]) ? r[key] : 0);
  const bool = (key: string): boolean => r[key] === true;
  return {
    caseNextDueMs: num("caseNextDueMs"),
    trayProdNextDueMs: num("trayProdNextDueMs"),
    trayConsNextDueMs: num("trayConsNextDueMs"),
    batchProdNextDueMs: num("batchProdNextDueMs"),
    batchConsNextDueMs: num("batchConsNextDueMs"),
    hopperNextDueMs: num("hopperNextDueMs"),
    trayLastMs: num("trayLastMs"),
    batchLastMs: num("batchLastMs"),
    lastExpectedCases: finiteNumber(r.lastExpectedCases) ? r.lastExpectedCases : base.lastExpectedCases,
    drainFreezer: finiteNumber(r.drainFreezer) ? r.drainFreezer : base.drainFreezer,
    traysRemainder: num("traysRemainder"),
    traySeeded: bool("traySeeded"),
    batchSeeded: bool("batchSeeded"),
    formResetSkipped: bool("formResetSkipped"),
    caseClaimRetry: bool("caseClaimRetry"),
    doughPausedAtMs: num("doughPausedAtMs"),
    doughResumeAtMs: num("doughResumeAtMs"),
  };
}

export type WallClockServerPlan = {
  runId: string;
  /** Next persisted arm-state for this run after this beat. */
  bookkeeping: WallClockBookkeeping;
  /** Claims for the standard parse/apply/row-lock pipeline. */
  claims: AutoTrackClaim[];
};

export type WallClockServerState = {
  version: number;
  wallClockBookkeeping: Record<string, WallClockBookkeeping>;
};

/** Attach the runner's next bookkeeping to a sync-payload-shaped data blob.
 * `applyAutoTrackClaim` only rewrites runValues / runValuesUpdatedAt /
 * autoTrackCoordination / packagingProgress, so this key survives it; the
 * runner persists it in the same upsert. */
export function withWallClockServerState(
  data: Record<string, unknown>,
  runId: string,
  bookkeeping: WallClockBookkeeping,
): Record<string, unknown> {
  const prior = isPlainObject(data.autoTrackServerState)
    ? { ...data.autoTrackServerState }
    : {};
  const bookkeepingMap = isPlainObject(prior.wallClockBookkeeping)
    ? { ...prior.wallClockBookkeeping } as Record<string, WallClockBookkeeping>
    : {};
  bookkeepingMap[runId] = bookkeeping;
  const serverState: WallClockServerState = {
    version: 1,
    wallClockBookkeeping: bookkeepingMap,
  };
  return { ...data, autoTrackServerState: serverState };
}

/**
 * Build the server's wall-clock claims for one run beat. Pure (no DB): the
 * runner applies each claim through the SAME parse/apply/row-lock pipeline as
 * a client POST and persists `bookkeeping` atomically with the row. Drives
 * only FRESH live runs within WALL_CLOCK_REPLAY_CAP_MS and only channels with
 * NO canonical coordination record yet — once any claim (server or client)
 * re-persists a canonical nextDueAt, the schedule echoes it and this builder
 * leaves that channel to the clients. Returns null for rows without an
 * eligible live run (or once every wall-clock channel is canonical).
 */
export function buildWallClockServerClaims(
  payload: unknown,
  nowMs = Date.now(),
): WallClockServerPlan | null {
  let schedule;
  try {
    // Skeletal/incomplete run values cannot drive the calc; an un-computable
    // row simply has no server wall-clock ticks, like the net-second path.
    const calcResult = computeServerCalc(payload as never, []);
    if (!calcResult) return null;
    const calc = calcResult.calc;
    schedule = buildAutoTrackScheduleFromPayload(payload, calcResult, nowMs);
    if (!schedule) return null;
    return buildWallClockClaimFromInputs({ payload, runId: schedule.runId, calc, schedule, nowMs });
  } catch {
    return null;
  }
}

function buildWallClockClaimFromInputs(input: {
  payload: unknown;
  runId: string;
  calc: Calc;
  schedule: NonNullable<ReturnType<typeof buildAutoTrackScheduleFromPayload>>;
  nowMs: number;
}): WallClockServerPlan | null {
  const { payload, runId, calc, schedule, nowMs } = input;
  if (!schedule) return null;
  const p = (payload ?? {}) as {
    dayState?: { runs?: Array<Record<string, unknown>>; currentIndex?: number };
    runValues?: Record<string, Record<string, unknown>>;
    runValuesUpdatedAt?: Record<string, number>;
    autoTrackCoordination?: { runs?: Record<string, Record<string, unknown>> };
    packagingProgress?: Record<string, Record<string, unknown>>;
    autoTrackServerState?: WallClockServerState;
  };
  const run = p.dayState?.runs?.[p.dayState?.currentIndex ?? 0];
  const startedAt = toNumber(run?.startedAt);
  const pausedAt = toNumber(run?.pausedAt);
  const endedAt = toNumber(run?.endedAt);
  if (
    startedAt <= 0
    || pausedAt > 0
    || endedAt > 0
    || nowMs - startedAt > WALL_CLOCK_REPLAY_CAP_MS
  ) return null;
  const values = p.runValues?.[runId] ?? {};
  const baseUpdatedAt = toNumber(p.runValuesUpdatedAt?.[runId]);
  const coordinationForRun = p.autoTrackCoordination?.runs?.[runId] as
    | Partial<Record<string, { sequence?: number; nextDueAt?: number }>>
    | undefined;

  // Channels the server still drives: schedule entries in wall-clock replay
  // (canonical echo wins and hands the channel back to clients).
  const driveChannels = new Set<WallClockChannel>();
  for (const entry of schedule.entries) {
    if (!entry.canonical && (WALL_CLOCK_CHANNELS as readonly string[]).includes(entry.channel)) {
      driveChannels.add(entry.channel as WallClockChannel);
    }
  }
  if (driveChannels.size === 0) return null;

  const netMs = computeAutoTrackElapsedMs({
    startedAt,
    pausedAt: undefined,
    nowMs,
    stoppages: Array.isArray(run?.stoppages) ? run.stoppages as never : undefined,
  });
  const timing = getAutoTrackTiming(
    calc.ppm,
    toNumber(values.pizzasPerCase),
    calc.perTray,
    calc.perBatch,
    {
      spinSec: toNumber(values.mixerLowSec) + toNumber(values.mixerHighSec),
      hopperSec: toNumber(values.hopperSec),
    },
  );
  const suggestion = computeAutoTrackSuggestion({
    runStatus: "running",
    drainActive: false,
    packagingDrainActive: false,
    packagingDrainElapsedSec: 0,
    ppm: calc.ppm,
    casesPerSkid: toNumber(values.casesPerSkid),
    pizzasPerCase: toNumber(values.pizzasPerCase),
    casesNeeded: toNumber(values.casesNeeded),
    freezerTime: toNumber(values.freezerTime),
    elapsedBatchSec: netMs / 1000,
  });
  const prior = sanitizeWallClockBookkeeping(
    p.autoTrackServerState?.wallClockBookkeeping?.[runId],
  );
  const tickResult = tickWallClock({
    bookkeeping: prior,
    nowMs,
    timing,
    runStatus: "running",
    drainActive: false,
    packagingDrainActive: false,
    packagingAutoTrackActive: true,
    caseSuppressed: false,
    doughSuppressed: false,
    calc: {
      ppm: calc.ppm,
      perTray: calc.perTray,
      perBatch: calc.perBatch,
      pressDone: calc.pressDone,
      casesInFreezer: calc.casesInFreezer,
      traysNeeded: calc.traysNeeded,
      batchesNeeded: calc.batchesNeeded,
    },
    v: {
      pizzasPerCase: toNumber(values.pizzasPerCase),
      casesPerSkid: toNumber(values.casesPerSkid),
      casesNeeded: toNumber(values.casesNeeded),
      traysOnLine: toNumber(values.traysOnLine),
      batchesReady: toNumber(values.batchesReady),
    },
    form: {
      skidsCompleted: toNumber(values.skidsCompleted),
      casesOnCurrentSkid: toNumber(values.casesOnCurrentSkid),
      traysOnLine: toNumber(values.traysOnLine),
      batchesReady: toNumber(values.batchesReady),
    },
    expectedCasesRaw: suggestion?.expectedCasesRaw ?? 0,
    expectedCases: suggestion?.expectedCases ?? 0,
  });

  const claims: AutoTrackClaim[] = [];
  for (const event of tickResult.events) {
    if (!driveChannels.has(event.channel)) continue;
    const state = coordinationForRun?.[event.channel];
    const sequence = (typeof state?.sequence === "number" ? state.sequence : 0) + 1;
    const mutations = event.mutations
      .filter((mutation) => WALL_CLOCK_MUTATION_FIELDS[event.channel].includes(mutation.field))
      .map((mutation) => ({
        field: mutation.field as AutoTrackMutation["field"],
        from: Math.max(0, mutation.from),
        to: Math.max(0, mutation.to),
      }));
    const correctionGeneration = event.channel === "case"
      ? Math.max(0, toNumber(p.packagingProgress?.[runId]?.correctionGeneration))
      : undefined;
    claims.push({
      version: 1,
      runId,
      channel: event.channel,
      generation: schedule.generation,
      sequence,
      eventId: `srv:wc:${sequence}:${event.channel}:${randomUUID()}`,
      dueAt: event.dueAt,
      nextDueAt: event.nextDueAt,
      baseUpdatedAt,
      ...(correctionGeneration !== undefined ? { correctionGeneration } : {}),
      mutations,
    });
  }
  return { runId, bookkeeping: tickResult.next, claims };
}

/**
 * Build server-driven auto-track claims for the current run when a net-second
 * channel is due now. Pure (no DB): the tick runner applies each claim through
 * the SAME parse/apply pipeline as a client POST, so every invariant
 * (sequence, generation, correction generation, mutation from-checks, sauce
 * inventory) still holds. Returns [] for runs without a computable schedule or
 * with no due net-second channels.
 */
export function buildNetSecondServerClaims(
  payload: unknown,
  nowMs = Date.now(),
): AutoTrackClaim[] {
  let calc;
  let schedule;
  try {
    // Skeletal/incomplete run values cannot drive the calc (computeServerCalc
    // throws on missing form fields); an un-computable run simply has no
    // server ticks, exactly like the SSE/claim paths' calc guards.
    calc = computeServerCalc(payload as never, []);
    schedule = buildAutoTrackScheduleFromPayload(payload, calc, nowMs);
  } catch {
    return [];
  }
  if (!schedule) return [];
  const p = (payload ?? {}) as {
    runValues?: Record<string, Record<string, unknown>>;
    runValuesUpdatedAt?: Record<string, number>;
    autoTrackCoordination?: { runs?: Record<string, Record<string, unknown>> };
  };
  const runId = schedule.runId;
  const values = p.runValues?.[runId] ?? {};
  const baseUpdatedAt = Number(p.runValuesUpdatedAt?.[runId]) || 0;
  const coordinationForRun = p.autoTrackCoordination?.runs?.[runId] as
    | Partial<Record<string, { sequence?: number; generation?: string; nextDueAt?: number }>>
    | undefined;
  const claims: AutoTrackClaim[] = [];

  for (const entry of schedule.entries) {
    if (!isServerTickChannel(entry.channel) || !entry.dueNow) continue;
    const state = coordinationForRun?.[entry.channel];
    const sequence = (typeof state?.sequence === "number" ? state.sequence : 0) + 1;
    const slot = entry.channel.slice(0, 4);
    const correctionField = entry.channel === "sauce-barrel"
      ? "sauceBarrelCorrectionGeneration"
      : `${slot}BatchCorrectionGeneration`;
    const correctionGeneration = Math.max(0, Number(values[correctionField]) || 0);
    const countField = entry.channel === "sauce-barrel"
      ? "sauceBarrelsMade"
      : `${slot}BatchesMade`;
    const anchorField = entry.channel === "sauce-barrel"
      ? "sauceBarrelAnchorNetSec"
      : `${slot}BatchAnchorNetSec`;
    const countFrom = Math.max(0, Number(values[countField]) || 0);
    const anchorFrom = Math.max(0, Number(values[anchorField]) || 0);
    const mutations = entry.channel === "sauce-barrel"
      ? buildSauceClaimMutations({
          countFrom,
          countTo: countFrom + 1,
          anchorFrom,
          anchorTo: entry.dueAt,
          correctionGeneration,
        })
      : buildAppSlotClaimMutations({
          slot: slot as "app1" | "app2" | "app3" | "app4",
          madeFrom: countFrom,
          madeTo: countFrom + 1,
          anchorFrom,
          anchorTo: entry.dueAt,
          correctionGeneration,
        });
    claims.push({
      version: 1,
      runId,
      channel: entry.channel,
      generation: schedule.generation,
      sequence,
      eventId: `srv:${sequence}:${entry.channel}:${randomUUID()}`,
      dueAt: entry.dueAt,
      nextDueAt: entry.nextDueAt,
      baseUpdatedAt,
      correctionGeneration,
      mutations,
    });
  }
  return claims;
}
