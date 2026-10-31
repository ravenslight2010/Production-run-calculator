import { randomUUID } from "node:crypto";
import {
  legacyFrontlineConsumption,
  computeAutoTrackElapsedMs,
  computeAutoTrackSchedule,
  computeAppSlotInfo,
  computeFrontlineSupplyFromStockLbs,
  applicatorStockFields,
  applicatorStockRegisterForChannel,
  capApplicatorStock,
  computeApplicatorStockCapacityLbs,
  computeApplicatorStockRateLbsPerSecond,
  computeSauceStockStepSeconds,
  depleteSauceStock,
  computeAutoTrackSuggestion,
  computeLinePhases,
  computePackagingDrainElapsedSec,
  computeServerCalc,
  createWallClockBookkeeping,
  getAutoTrackTiming,
  lineHasPackagingDrain,
  rearmWallClockTimers,
  tickWallClock,
  type AutoTrackSchedule,
  type Calc,
  type WallClockChannel,
  type WallClockBookkeeping,
} from "@workspace/live-calc";
import type { AutoTrackClaim, AutoTrackMutation } from "./autoTrackCoordination";

const NET_CHANNELS = [
  "sauce-barrel",
  "sauce-stock",
  "app1-batch", "app2-batch", "app3-batch", "app4-batch",
  "app1-stock", "app2-stock", "app3-stock", "app4-stock",
  "pep1-stock", "pep1b-stock", "pep2-stock", "pep2b-stock",
] as const;
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
  doughTimerControls?: Record<string, {
    generation?: string;
    pausedAt?: number;
    resumeAt?: number;
    updatedAt?: number;
    controlRevision?: number;
  }>;
};
const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
const DEFAULT_OUTER_STAGE_MIN = 2.5;

function pausedPackagingDrain(
  run: Record<string, unknown>,
  values: Record<string, unknown>,
  nowMs: number,
): { active: boolean; elapsedSec: number } {
  const pausedAt = number(run.pausedAt);
  if (pausedAt <= 0) return { active: false, elapsedSec: 0 };
  const stoppages = Array.isArray(run.stoppages)
    ? run.stoppages as Array<Record<string, unknown>>
    : [];
  const openPause = stoppages
    .filter((entry) => entry.type === "pause" && number(entry.endedAt) <= 0)
    .reduce<Record<string, unknown> | undefined>(
      (latest, entry) => !latest || number(entry.startedAt) > number(latest.startedAt)
        ? entry
        : latest,
      undefined,
    );
  // Legacy/missing pause policy remains fail-safe: the tunnel is stopped.
  const pauseStopsTunnel = openPause?.stopTunnel !== false;
  const elapsedBatchSec = computeAutoTrackElapsedMs({
    startedAt: number(run.startedAt),
    pausedAt,
    nowMs,
    stoppages: stoppages as never,
  }) / 1000;
  const args = {
    elapsedBatchSec,
    pausedAt,
    lastResumeWallMs: 0,
    lastPauseStartWallMs: 0,
    pauseStopsTunnel,
    lastPauseStopsTunnel: true,
    runStatus: "paused",
    pressOvenMin: typeof values.pressOvenMin === "number" ? values.pressOvenMin : undefined,
    frontlineMin: typeof values.frontlineMin === "number" ? values.frontlineMin : undefined,
    preTunnelMin: typeof values.preTunnelMin === "number"
      ? number(values.preTunnelMin)
      : DEFAULT_OUTER_STAGE_MIN,
    postTunnelMin: typeof values.postTunnelMin === "number"
      ? number(values.postTunnelMin)
      : DEFAULT_OUTER_STAGE_MIN,
    freezerTime: number(values.freezerTime),
    nowMs,
  } as const;
  return {
    active: lineHasPackagingDrain(computeLinePhases(args)),
    elapsedSec: computePackagingDrainElapsedSec(args),
  };
}

function buildNetMutations(prefix: string, madeFrom: number, madeTo: number, anchorFrom: number, anchorTo: number, correctionGeneration: number): AutoTrackMutation[] {
  return [
    { field: (prefix === "sauceBarrel" ? "sauceBarrelsMade" : `${prefix}esMade`) as AutoTrackMutation["field"], from: madeFrom, to: madeTo },
    { field: `${prefix}AnchorNetSec` as AutoTrackMutation["field"], from: anchorFrom, to: anchorTo },
    { field: `${prefix}CorrectionGeneration` as AutoTrackMutation["field"], from: correctionGeneration, to: correctionGeneration },
  ];
}

function selectTrackingRun(
  payload: Payload,
  nowMs: number,
  options: {
    allowEndedDrain?: boolean;
    allowPausedPackagingDrain?: boolean;
    targetRunId?: string;
  },
): { run: Record<string, unknown>; index: number } | null {
  const runs = payload.dayState?.runs ?? [];
  const active: Array<{ run: Record<string, unknown>; index: number; startedAt: number }> = [];
  const drains: Array<{ run: Record<string, unknown>; index: number; lifecycleAt: number }> = [];

  runs.forEach((run, index) => {
    if (typeof run.id !== "string" || number(run.startedAt) <= 0) return;
    if (options.targetRunId !== undefined && run.id !== options.targetRunId) return;
    const values = payload.runValues?.[run.id];
    if (!values) return;
    const endedAt = number(run.endedAt);
    if (endedAt > 0) {
      const freezerTime = number(values.freezerTime);
      if (
        options.allowEndedDrain === true
        && freezerTime > 0
        && nowMs < endedAt + freezerTime * 60_000
      ) drains.push({ run, index, lifecycleAt: endedAt });
      return;
    }

    const pausedAt = number(run.pausedAt);
    if (pausedAt > 0) {
      if (
        options.allowPausedPackagingDrain === true
        && pausedPackagingDrain(run, values, nowMs).active
      ) drains.push({ run, index, lifecycleAt: pausedAt });
      return;
    }
    active.push({ run, index, startedAt: number(run.startedAt) });
  });

  // The selected tab is device-local and is deliberately absent from canonical
  // sync snapshots. A started run's server-issued lifecycle is the authority
  // for background tracking; prefer the newest if legacy state has competing
  // active rows, with run order as a deterministic tie-breaker.
  const activeRun = active.sort((a, b) => b.startedAt - a.startedAt || b.index - a.index)[0];
  if (activeRun) return { run: activeRun.run, index: activeRun.index };

  // With no running lifecycle, continue only an eligible pause/end freezer
  // drain. Filter by its own window before choosing the most recent one.
  const drainingRun = drains.sort((a, b) => b.lifecycleAt - a.lifecycleAt || b.index - a.index)[0];
  return drainingRun ? { run: drainingRun.run, index: drainingRun.index } : null;
}

function schedule(
  payload: Payload,
  nowMs: number,
  options: {
    allowEndedDrain?: boolean;
    allowPausedPackagingDrain?: boolean;
    targetRunId?: string;
  } = {},
): {
  schedule: AutoTrackSchedule;
  values: Record<string, unknown>;
  ppm: number;
  run: Record<string, unknown>;
  calc: Calc;
} | null {
  const selected = selectTrackingRun(payload, nowMs, options);
  if (!selected) return null;
  const run = selected.run;
  const selectedPayload = {
    ...payload,
    dayState: { ...payload.dayState, currentIndex: selected.index },
  };
  const result = computeServerCalc(selectedPayload as never, [], nowMs);
  if (!result || typeof run.id !== "string") return null;
  // Date rows are client-local (and can legitimately be tomorrow in UTC), so
  // eligibility is lifecycle based rather than server-date based. Conversely,
  // an abandoned old running register must never restart net claims.
  const startedAt = number(run.startedAt);
  const endedAt = number(run.endedAt);
  if (run.autoTrackDisabled === true) return null;
  const storedValues = payload.runValues?.[run.id];
  const values = storedValues
    ? { ...storedValues, ...legacyFrontlineConsumption(storedValues) }
    : undefined;
  if (!values) return null;
  const endedDrainActive = options.allowEndedDrain === true
    && endedAt > 0
    && number(values.freezerTime) > 0
    && nowMs < endedAt + number(values.freezerTime) * 60_000;
  const pausedDrainActive = options.allowPausedPackagingDrain === true
    && pausedPackagingDrain(run, values, nowMs).active;
  const lifecycleStamp = Math.max(startedAt, number(run.metaUpdatedAt));
  if (
    startedAt <= 0
    || (number(run.pausedAt) > 0 && !pausedDrainActive)
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
    ppm: result.calc.ppm,
    run,
    calc: result.calc,
  };
}

/** Builds due sauce/applicator claims entirely from canonical stored state. */
export function buildNetSecondServerClaims(
  raw: unknown,
  nowMs = Date.now(),
  eventIdNamespace?: string,
): AutoTrackClaim[] {
  const payload = (raw && typeof raw === "object" ? raw : {}) as Payload;
  const built = schedule(payload, nowMs);
  if (!built) return [];
  const { schedule: plan, values, ppm, calc } = built;
  const baseUpdatedAt = number(payload.runValuesUpdatedAt?.[plan.runId]);
  const coordination = payload.autoTrackCoordination?.runs?.[plan.runId];
  return plan.entries.flatMap((entry) => {
    if (!(NET_CHANNELS as readonly string[]).includes(entry.channel) || !entry.dueNow) return [];
    if (entry.channel === "sauce-stock") {
      const onHand = number(values.sauceStockBarrels);
      const anchor = number(values.sauceStockAnchorNetSec);
      const correctionGeneration = Math.max(0, number(values.sauceStockCorrectionGeneration));
      const cadence = computeSauceStockStepSeconds(
        values.sauceOzPerPizza,
        ppm,
        Number(calc.sauceEffBarrel) || 0,
      );
      const prior = coordination?.["sauce-stock"];
      const initialize = values.sauceStockInitialized !== true;
      if (!initialize && (onHand <= 0 || onHand > 2 || cadence <= 0)) return [];
      const mutationAnchor = initialize ? 0 : anchor;
      const dueAt = entry.dueAt;
      const nextDueAt = entry.nextDueAt > dueAt
        ? entry.nextDueAt
        : dueAt + Math.max(cadence, 1);
      return [{
        version: 1,
        runId: plan.runId,
        channel: "sauce-stock",
        generation: plan.generation,
        sequence: prior?.generation === plan.generation ? number(prior.sequence) + 1 : 1,
        eventId: eventIdNamespace
          ? `srv:sauce-stock:${eventIdNamespace}`
          : `srv:sauce-stock:${randomUUID()}`,
        dueAt,
        nextDueAt,
        baseUpdatedAt,
        correctionGeneration,
        mutations: [
          { field: "sauceStockBarrels", from: onHand, to: initialize ? 2 : depleteSauceStock(onHand) },
          { field: "sauceStockAnchorNetSec", from: mutationAnchor, to: dueAt },
          { field: "sauceStockCorrectionGeneration", from: correctionGeneration, to: correctionGeneration },
        ],
      } as AutoTrackClaim];
    }
    const register = applicatorStockRegisterForChannel(entry.channel);
    if (register) {
      const fields = applicatorStockFields(register);
      const onHand = number(values[fields.stock]);
      const capacity = computeApplicatorStockCapacityLbs(values, register);
      const anchor = number(values[fields.anchor]);
      const correctionGeneration = Math.max(0, number(values[fields.correctionGeneration]));
      const cadence = Math.max(0, entry.dueAt - anchor);
      const ozField = register.endsWith("b")
        ? `${register.slice(0, -1)}OzPerPizzaB`
        : `${register}OzPerPizza`;
      const nextOnHand = capApplicatorStock(
        onHand - cadence * computeApplicatorStockRateLbsPerSecond(values[ozField], ppm),
        capacity,
      );
      const consumedField = register.startsWith("app")
        ? `${register}StockConsumedLbs`
        : null;
      const consumed = consumedField ? number(values[consumedField]) : 0;
      const prior = coordination?.[entry.channel];
      return [{
        version: 1, runId: plan.runId, channel: entry.channel, generation: plan.generation,
        sequence: prior?.generation === plan.generation ? number(prior.sequence) + 1 : 1,
        eventId: eventIdNamespace
          ? `srv:${entry.channel}:${eventIdNamespace}`
          : `srv:${entry.channel}:${randomUUID()}`,
        dueAt: entry.dueAt,
        nextDueAt: entry.nextDueAt > entry.dueAt ? entry.nextDueAt : entry.dueAt + cadence,
        baseUpdatedAt, correctionGeneration,
        mutations: [
          { field: fields.stock, from: onHand, to: nextOnHand },
          { field: fields.anchor, from: anchor, to: entry.dueAt },
          { field: fields.correctionGeneration, from: correctionGeneration, to: correctionGeneration },
          ...(consumedField ? [{
            field: consumedField as AutoTrackClaim["mutations"][number]["field"],
            from: consumed,
            to: consumed + Math.max(0, onHand - nextOnHand),
          }] : []),
        ],
      } as AutoTrackClaim];
    }
    const slot = entry.channel === "sauce-barrel" ? "" : entry.channel.slice(0, 4);
    const madeField = entry.channel === "sauce-barrel" ? "sauceBarrelsMade" : `${slot}BatchesMade`;
    const anchorField = entry.channel === "sauce-barrel" ? "sauceBarrelAnchorNetSec" : `${slot}BatchAnchorNetSec`;
    const correctionField = entry.channel === "sauce-barrel" ? "sauceBarrelCorrectionGeneration" : `${slot}BatchCorrectionGeneration`;
    const correctionGeneration = Math.max(0, number(values[correctionField]));
    const prefix = entry.channel === "sauce-barrel" ? "sauceBarrel" : `${slot}Batch`;
    if (/^app[1-4]-batch$/.test(entry.channel)) {
      const appSlot = slot as "app1" | "app2" | "app3" | "app4";
      const info = computeAppSlotInfo({
        type: String(values[`${appSlot}Type`] ?? ""),
        recipe: values[`${appSlot}CheeseRecipe`] as Array<{ lbs: number }> | undefined,
        batchLbs: number(values[`${appSlot}BatchLbs`]),
        ozPerPizza: number(values[`${appSlot}OzPerPizza`]),
        casesNeeded: number(values.casesNeeded),
        pizzasPerCase: number(values.pizzasPerCase),
        ppm,
      });
      const stockField = `${appSlot}StockLbs`;
      const consumedField = `${appSlot}StockConsumedLbs`;
      const stock = Math.max(0, number(values[stockField]));
      const consumed = Math.max(0, number(values[consumedField]));
      const capacity = Math.min(
        computeApplicatorStockCapacityLbs(values, appSlot),
        info.effectiveBatchLbs * 2,
      );
      const supply = computeFrontlineSupplyFromStockLbs({
        demandLbs: info.required * info.effectiveBatchLbs,
        consumedLbs: consumed,
        onLineLbs: stock,
        configuredEffectiveWeight: info.effectiveBatchLbs,
      });
      const producedLbs = Math.min(
        info.effectiveBatchLbs,
        (supply?.stillToMake ?? 0) * info.effectiveBatchLbs,
      );
      if (
        !info.validForClaim
        || values.applicatorStockInitialized !== true
        || !supply?.stillToMake
        || producedLbs <= 0
        || capacity - stock + 0.0001 < producedLbs
      ) return [];

      const made = Math.max(0, number(values[madeField]));
      const anchor = Math.max(0, number(values[anchorField]));
      const mutations = buildNetMutations(prefix, made, made + 1, anchor, entry.dueAt, correctionGeneration);
      mutations.push({
        field: stockField as AutoTrackClaim["mutations"][number]["field"],
        from: stock,
        to: capApplicatorStock(stock + producedLbs, capacity),
      });
      const prior = coordination?.[entry.channel];
      const cadence = Math.max(0, entry.dueAt - anchor);
      return [{
        version: 1, runId: plan.runId, channel: entry.channel, generation: plan.generation,
        sequence: prior?.generation === plan.generation ? number(prior.sequence) + 1 : 1,
        eventId: eventIdNamespace
          ? `srv:${entry.channel}:${eventIdNamespace}`
          : `srv:${entry.channel}:${randomUUID()}`,
        dueAt: entry.dueAt,
        nextDueAt: entry.nextDueAt > entry.dueAt ? entry.nextDueAt : entry.dueAt + cadence,
        baseUpdatedAt, correctionGeneration, mutations,
      } as AutoTrackClaim];
    }
    const mutations = buildNetMutations(prefix, Math.max(0, number(values[madeField])), Math.max(0, number(values[madeField])) + 1, Math.max(0, number(values[anchorField])), entry.dueAt, correctionGeneration);
    const cadence = Math.max(0, entry.dueAt - Math.max(0, number(values[anchorField])));
    const claimNextDueAt = entry.nextDueAt > entry.dueAt
      ? entry.nextDueAt : entry.dueAt + cadence;
    const prior = coordination?.[entry.channel];
    return [{
      version: 1, runId: plan.runId, channel: entry.channel, generation: plan.generation,
      sequence: prior?.generation === plan.generation ? number(prior.sequence) + 1 : 1,
      eventId: eventIdNamespace
        ? `srv:${entry.channel}:${eventIdNamespace}`
        : `srv:${entry.channel}:${randomUUID()}`,
      dueAt: entry.dueAt,
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
  appliedPackagingCorrectionGeneration?: number;
  appliedPackagingOverrideUntil?: number;
  packagingHeld?: boolean;
};
export function buildWallClockServerClaims(
  raw: unknown,
  nowMs = Date.now(),
  eventIdNamespace?: string,
  targetRunId?: string,
): { runId: string; bookkeeping: ServerWallClockBookkeeping; claims: AutoTrackClaim[] } | null {
  const payload = (raw && typeof raw === "object" ? raw : {}) as Payload;
  const built = schedule(payload, nowMs, {
    allowEndedDrain: true,
    allowPausedPackagingDrain: true,
    targetRunId,
  });
  const run = built?.run;
  if (!built || !run || number(run.startedAt) <= 0) return null;
  const { schedule: plan, values, calc } = built;
  const endedAt = number(run.endedAt);
  const drainActive = endedAt > 0
    && number(values.freezerTime) > 0
    && nowMs < endedAt + number(values.freezerTime) * 60_000;
  const pausedDrain = pausedPackagingDrain(run, values, nowMs);
  const packagingDrainActive = pausedDrain.active;
  const runStatus = drainActive
    ? "ended"
    : packagingDrainActive
      ? "paused"
      : "running";
  const old = payload.autoTrackServerState?.wallClockBookkeeping?.[plan.runId] ?? {};
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
    runStatus, drainActive, packagingDrainActive,
    packagingDrainElapsedSec: pausedDrain.elapsedSec,
    ppm: calc.ppm, casesPerSkid: number(values.casesPerSkid), pizzasPerCase: number(values.pizzasPerCase),
    casesNeeded: number(values.casesNeeded), freezerTime: number(values.freezerTime), elapsedBatchSec: elapsedSec,
  });
  if (
    hasPersistedBookkeeping
    && old.lifecycleGeneration !== plan.generation
    && packagingDrainActive
  ) {
    // A pause starts a distinct, zero-based physical output clock. Baseline it
    // at the transition and wait one full case cadence so pre-pause time cannot
    // be replayed as paused Packaging output after reconnect or restart.
    bookkeeping.lastExpectedCases = suggestion?.expectedCasesRaw ?? -1;
  }
  // Pre-engine records persisted only the six due refs. An overdue legacy arm
  // may preserve a case beat only when the freezer-aware suggestion already
  // authorizes the next case; an expired timer alone is not output evidence.
  const legacyCaseArm = old.lifecycleGeneration === plan.generation
    && typeof old.caseNextDueMs === "number"
    && !Object.prototype.hasOwnProperty.call(old, "lastExpectedCases")
    && old.caseNextDueMs <= nowMs;
  const suggestionExpectedCasesRaw = suggestion?.expectedCasesRaw ?? 0;
  const currentCases = number(values.skidsCompleted) * number(values.casesPerSkid)
    + number(values.casesOnCurrentSkid);
  const legacyExpected = currentCases + 1;
  const legacyCaseAlreadyAuthorized = suggestionExpectedCasesRaw >= legacyExpected;
  const expectedCasesRaw = legacyCaseArm && legacyCaseAlreadyAuthorized
    ? Math.max(suggestionExpectedCasesRaw, legacyExpected)
    : suggestionExpectedCasesRaw;
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
  const progress = payload.packagingProgress?.[plan.runId];
  const correctionGeneration = number(progress?.correctionGeneration);
  const overrideUntil = number(progress?.manualOverrideUntil);
  const caseSuppressed = overrideUntil > nowMs;
  const correctionChanged = correctionGeneration > 0 && (
    old.appliedPackagingCorrectionGeneration !== correctionGeneration
    || old.appliedPackagingOverrideUntil !== overrideUntil
  );
  // A correction is the new physical baseline, not a gap to fill from expected
  // lifetime output. Keep observing output during the hold without issuing
  // rejected claims (which also prevented the other wall arms being persisted).
  // On expiry or explicit Resume wait one full case period; never replay held
  // time, even when the worker slept through the entire hold.
  if (caseSuppressed || correctionChanged || old.packagingHeld === true) {
    bookkeeping.lastExpectedCases = expectedCasesRaw;
    bookkeeping.drainFreezer = Math.max(0, Math.floor(calc.casesInFreezer));
    bookkeeping.caseNextDueMs = Math.max(nowMs, overrideUntil) + timing.caseMs;
    bookkeeping.caseClaimRetry = false;
    bookkeeping.formResetSkipped = true;
  }
  const tick = tickWallClock({
    bookkeeping, nowMs, timing, runStatus, drainActive, packagingDrainActive,
    packagingAutoTrackActive: true, caseSuppressed, doughSuppressed: false,
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
        return (drainActive || packagingDrainActive) && event.channel === "case";
      }
      const ownedSequence = number(serverSequences[event.channel]);
      return ownedSequence === 0 || ownedSequence === number(state.sequence);
    })
    .map((event) => ({
      version: 1, runId: plan.runId, channel: event.channel, generation: plan.generation,
      sequence: coordination?.[event.channel]?.generation === plan.generation
        ? number(coordination[event.channel]?.sequence) + 1 : 1,
      eventId: eventIdNamespace
        ? `srv:wc:${event.channel}:${eventIdNamespace}`
        : `srv:wc:${event.channel}:${randomUUID()}`,
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
      appliedPackagingCorrectionGeneration: correctionGeneration,
      appliedPackagingOverrideUntil: overrideUntil,
      packagingHeld: caseSuppressed,
    },
    claims,
  };
}
