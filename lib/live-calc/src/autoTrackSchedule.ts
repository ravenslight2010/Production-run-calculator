import { computeAppSlotInfo, getAutoTrackTiming } from "./autoTrackEngine";
import {
  APPLICATOR_STOCK_REGISTERS,
  applicatorStockFields,
  computeApplicatorStockCapacityLbs,
  computeApplicatorStockCadenceSeconds,
} from "./applicatorStock";
import { computeSauceStockStepSeconds } from "./sauceStock";
import { computeFrontlineSupplyFromStockLbs, computeSauceRunRequirement, legacyFrontlineConsumption } from "./stagedSupply";
import { computeWallClockDueRefs } from "./wallClockEngine";
import type { Calc, CalcFormValues, CalcStoppage, ServerCalcResult } from "./index";

export const AUTO_TRACK_SCHEDULE_CHANNELS = [
  "case", "tray-consume", "tray-produce", "batch-consume", "batch-produce", "hopper",
  "sauce-barrel", "sauce-stock", "app1-batch", "app2-batch", "app3-batch", "app4-batch",
  "app1-stock", "app2-stock", "app3-stock", "app4-stock",
  "pep1-stock", "pep1b-stock", "pep2-stock", "pep2b-stock",
] as const;
export type AutoTrackScheduleChannel = typeof AUTO_TRACK_SCHEDULE_CHANNELS[number];
export type AutoTrackScheduleEntry = {
  channel: AutoTrackScheduleChannel;
  dueAt: number;
  dueNow: boolean;
  nextDueAt: number;
  canonical: boolean;
  sequence?: number;
};
export type AutoTrackSchedule = {
  runId: string;
  generation: string;
  atMs: number;
  entries: AutoTrackScheduleEntry[];
};
export type AutoTrackScheduleCoordinationState = {
  generation?: string;
  sequence?: number;
  nextDueAt?: number;
};
export type AutoTrackScheduleInput = {
  runId: string;
  metaUpdatedAt?: number;
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  stoppages?: CalcStoppage[];
  v: CalcFormValues;
  calc: Calc;
  progress?: Record<string, unknown>;
  coordination?: Partial<Record<AutoTrackScheduleChannel, AutoTrackScheduleCoordinationState>>;
  serverNetOwnership?: Partial<Record<AutoTrackScheduleChannel, {
    generation?: string; sequence?: number; updatedAt?: number;
  }>>;
  serverWallOwnership?: Partial<Record<AutoTrackScheduleChannel, number>>;
  machine?: { spinSec?: number; hopperSec?: number };
  nowMs: number;
};
function number(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}
export function computeAutoTrackElapsedMs(input: {
  startedAt?: number;
  pausedAt?: number;
  nowMs: number;
  stoppages?: CalcStoppage[];
}): number {
  if (!Number.isFinite(input.startedAt)) return 0;
  const downtime = (input.stoppages ?? []).filter((s) => s.type !== "pause" && s.endedAt)
    .reduce((sum, s) => sum + Math.max(0, (s.endedAt ?? 0) - s.startedAt), 0);
  return Math.max(0, (input.pausedAt ?? input.nowMs) - input.startedAt! - downtime);
}
export function computeAutoTrackSchedule(input: AutoTrackScheduleInput): AutoTrackSchedule {
  const entries: AutoTrackScheduleEntry[] = [];
  const generation = `${input.runId}:${input.metaUpdatedAt ?? input.startedAt ?? 0}`;
  const live = !!input.startedAt && !input.endedAt && !input.pausedAt;
  const drain = !!input.endedAt && Number(input.v.freezerTime) > 0 &&
    input.nowMs < input.endedAt + Number(input.v.freezerTime) * 60000;
  const elapsedSec = computeAutoTrackElapsedMs(input) / 1000;
  const netCanonical = (channel: AutoTrackScheduleChannel) => {
    const owner = input.serverNetOwnership?.[channel];
    const state = input.coordination?.[channel];
    return owner?.generation === generation
      && state?.generation === generation
      && number(owner.sequence) === number(state.sequence)
      && input.nowMs - number(owner.updatedAt) <= 45_000;
  };
  const canonical = (channel: AutoTrackScheduleChannel, active: boolean) => {
    const state = input.coordination?.[channel];
    const dueAt = number(state?.nextDueAt);
    const serverSequence = number(input.serverWallOwnership?.[channel]);
    if (
      active && state?.generation === generation && dueAt > 0
      && serverSequence > 0 && serverSequence === number(state.sequence)
    ) entries.push({
      channel, dueAt, nextDueAt: dueAt, dueNow: input.nowMs >= dueAt,
      canonical: true, sequence: number(state.sequence),
    });
  };
  canonical("case", live || drain);
  for (const channel of ["tray-consume", "tray-produce", "batch-consume", "batch-produce", "hopper"] as const) {
    canonical(channel, live);
  }
  // Fresh runs without a canonical claim are server-bootstrap candidates.
  // These entries are advisory leases; the server persists the exact arm state
  // when it executes them, while clients fall back automatically on expiry.
  if (live && input.nowMs - (input.startedAt ?? input.nowMs) <= 6 * 60 * 60 * 1000) {
    const machine = input.machine ?? {};
    const timing = getAutoTrackTiming(
      input.calc.ppm, number(input.v.pizzasPerCase), input.calc.perTray,
      input.calc.perBatch,
      {
        spinSec: number(machine.spinSec),
        hopperSec: number(machine.hopperSec),
      },
    );
    const dueRefs = computeWallClockDueRefs({
      startedAt: input.startedAt,
      pausedAt: input.pausedAt,
      endedAt: input.endedAt,
      nowMs: input.nowMs,
      stoppages: input.stoppages,
      timing,
    });
    const replay: Array<[AutoTrackScheduleChannel, number, number]> = [
      ["case", dueRefs?.caseDueMs ?? 0, timing.caseMs],
      ["tray-consume", dueRefs?.trayConsDueMs ?? 0, timing.trayMs],
      ["tray-produce", dueRefs?.trayProdDueMs ?? 0, timing.trayProductionMs],
      ["batch-consume", dueRefs?.batchConsDueMs ?? 0, timing.batchConsumptionMs],
      ["batch-produce", dueRefs?.batchProdDueMs ?? 0, timing.batchProductionMs],
      ["hopper", dueRefs?.hopperDueMs ?? 0, timing.hopperMs],
    ];
    for (const [channel, dueAt, period] of replay) {
      if (period <= 0 || dueAt <= 0 || entries.some((entry) => entry.channel === channel)) continue;
      entries.push({ channel, dueAt, dueNow: input.nowMs >= dueAt, nextDueAt: dueAt + period, canonical: false });
    }
  }
  const sauceMade = Math.max(0, number(input.progress?.sauceBarrelsMade));
  const sauceRequirement = computeSauceRunRequirement({
    casesNeeded: number(input.v.casesNeeded),
    pizzasPerCase: number(input.v.pizzasPerCase),
    ozPerPizza: number(input.v.sauceOzPerPizza),
    barrelLbs: input.calc.sauceEffBarrel,
  });
  if (
    live
    && !input.calc.pressDone
    && input.calc.sauceDepletionSec > 0
    && sauceMade < Math.ceil(sauceRequirement.totalUnits)
  ) {
    const dueAt = Math.max(0, number(input.progress?.sauceBarrelAnchorNetSec)) + input.calc.sauceDepletionSec;
    const channel = "sauce-barrel" as const;
    const state = input.coordination?.[channel];
    const owned = netCanonical(channel);
    const canonicalDue = owned ? number(state?.nextDueAt) : dueAt;
    entries.push({
      channel, dueAt: canonicalDue,
      dueNow: elapsedSec >= canonicalDue,
      nextDueAt: owned ? canonicalDue : dueAt + input.calc.sauceDepletionSec,
      canonical: owned,
    });
  }
  if (live && !input.calc.pressDone && input.progress?.sauceStockInitialized === true) {
    const stock = number(input.progress?.sauceStockBarrels);
    const cadence = computeSauceStockStepSeconds(
      input.v.sauceOzPerPizza,
      input.calc.ppm,
      input.calc.sauceEffBarrel,
    );
    if (stock > 0 && stock <= 2 && cadence > 0) {
      const channel = "sauce-stock" as const;
      const anchor = Math.max(0, number(input.progress?.sauceStockAnchorNetSec));
      const dueAt = anchor + cadence;
      const state = input.coordination?.[channel];
      const owned = netCanonical(channel);
      const canonicalDue = owned ? Math.max(number(state?.nextDueAt), dueAt) : dueAt;
      entries.push({
        channel,
        dueAt: canonicalDue,
        dueNow: elapsedSec >= canonicalDue,
        nextDueAt: owned ? canonicalDue : dueAt + cadence,
        canonical: owned,
      });
    }
  }
  if (
    live
    && !input.calc.pressDone
    && input.progress?.sauceStockInitialized !== true
  ) {
    const cadence = computeSauceStockStepSeconds(
      input.v.sauceOzPerPizza,
      input.calc.ppm,
      input.calc.sauceEffBarrel,
    );
    const legacyInitialization = input.progress?.sauceStockInitialized === false;
    if (cadence > 0 || legacyInitialization) {
      const channel = "sauce-stock" as const;
      const state = input.coordination?.[channel];
      const owned = netCanonical(channel);
      const dueAt = owned ? Math.max(number(state?.nextDueAt), elapsedSec) : elapsedSec;
      entries.push({
        channel,
        dueAt,
        dueNow: elapsedSec >= dueAt,
        nextDueAt: owned
          ? Math.max(dueAt + cadence, dueAt + 1)
          : dueAt + Math.max(cadence, 1),
        canonical: owned,
      });
    }
  }
  // App batch claims fill current on-line stock; the historical made register
  // remains separate from consumption and current supply.
  if (live && !input.calc.pressDone) {
    for (const slot of ["app1", "app2", "app3", "app4"] as const) {
      const info = computeAppSlotInfo({
        type: String(input.v[`${slot}Type`] ?? ""),
        recipe: input.v[`${slot}CheeseRecipe`],
        batchLbs: number(input.v[`${slot}BatchLbs`]),
        ozPerPizza: number(input.v[`${slot}OzPerPizza`]),
        casesNeeded: number(input.v.casesNeeded),
        pizzasPerCase: number(input.v.pizzasPerCase),
        ppm: input.calc.ppm,
      });
      const fields = applicatorStockFields(slot);
      const stock = Math.max(0, number(input.progress?.[fields.stock]));
      const consumedField = `${slot}StockConsumedLbs`;
      const consumed = Math.max(0, number(input.progress?.[consumedField]
        ?? legacyFrontlineConsumption(input.progress ?? {})[consumedField]));
      const capacity = Math.min(
        computeApplicatorStockCapacityLbs(input.v as unknown as Record<string, unknown>, slot),
        info.effectiveBatchLbs * 2,
      );
      const supply = computeFrontlineSupplyFromStockLbs({
        demandLbs: info.required * info.effectiveBatchLbs,
        consumedLbs: consumed,
        onLineLbs: stock,
        configuredEffectiveWeight: info.effectiveBatchLbs,
      });
      const productionLbs = Math.min(
        info.effectiveBatchLbs,
        (supply?.stillToMake ?? 0) * info.effectiveBatchLbs,
      );
      if (
        !info.validForClaim
        || input.progress?.applicatorStockInitialized !== true
        || info.cadence <= 0
        || !supply?.stillToMake
        || capacity - stock + 0.0001 < productionLbs
      ) continue;
      const channel = `${slot}-batch` as AutoTrackScheduleChannel;
      const dueAt = Math.max(
        elapsedSec,
        Math.max(0, number(input.progress?.[`${slot}BatchAnchorNetSec`])) + info.cadence,
      );
      const state = input.coordination?.[channel];
      const owned = netCanonical(channel);
      const canonicalDue = owned ? Math.max(number(state?.nextDueAt), dueAt) : dueAt;
      entries.push({
        channel,
        dueAt: canonicalDue,
        dueNow: elapsedSec >= canonicalDue,
        nextDueAt: owned ? canonicalDue : dueAt + info.cadence,
        canonical: owned,
      });
    }
  }
  if (live && !input.calc.pressDone && number(input.v.pizzasPerCase) > 0
    && number(input.v.casesNeeded) > 0 && input.progress?.applicatorStockInitialized === true) {
    for (const register of APPLICATOR_STOCK_REGISTERS) {
      const fields = applicatorStockFields(register);
      const onHand = Math.max(0, number(input.progress?.[fields.stock]));
      const cadence = computeApplicatorStockCadenceSeconds(
        input.v as unknown as Record<string, unknown>,
        register,
        input.calc.ppm,
      );
      if (onHand <= 0 || cadence <= 0) continue;
      const dueAt = Math.max(0, number(input.progress?.[fields.anchor])) + cadence;
      const channel = `${register}-stock` as AutoTrackScheduleChannel;
      const state = input.coordination?.[channel];
      const owned = netCanonical(channel);
      const canonicalDue = owned ? Math.max(number(state?.nextDueAt), dueAt) : dueAt;
      entries.push({
        channel,
        dueAt: canonicalDue,
        dueNow: elapsedSec >= canonicalDue,
        nextDueAt: owned ? canonicalDue : dueAt + cadence,
        canonical: owned,
      });
    }
  }
  entries.sort((a, b) => AUTO_TRACK_SCHEDULE_CHANNELS.indexOf(a.channel) -
    AUTO_TRACK_SCHEDULE_CHANNELS.indexOf(b.channel));
  return {
    runId: input.runId,
    generation,
    atMs: input.nowMs,
    entries,
  };
}

export function buildAutoTrackScheduleFromPayload(
  payload: unknown,
  calcResult: ServerCalcResult | null,
  nowMs = Date.now(),
): AutoTrackSchedule | null {
  const p = (payload ?? {}) as {
    dayState?: { runs?: Array<Record<string, unknown>>; currentIndex?: number };
    runValues?: Record<string, Record<string, unknown>>;
    autoTrackCoordination?: { runs?: Record<string, Record<string, unknown>> };
  };
  if (!p.dayState?.runs || p.dayState.runs.length === 0 || !calcResult) return null;
  const run = p.dayState.runs[p.dayState.currentIndex ?? 0];
  if (!run?.id || typeof run.id !== "string") return null;
  const runId = run.id;
  const rawValues = p.runValues?.[runId];
  if (!rawValues || typeof rawValues !== "object") return null;
  const coordinationForRun = p.autoTrackCoordination?.runs?.[runId];
  return computeAutoTrackSchedule({
    runId,
    metaUpdatedAt: typeof run.metaUpdatedAt === "number" ? run.metaUpdatedAt : undefined,
    startedAt: typeof run.startedAt === "number" ? run.startedAt : undefined,
    pausedAt: typeof run.pausedAt === "number" ? run.pausedAt : undefined,
    endedAt: typeof run.endedAt === "number" ? run.endedAt : undefined,
    stoppages: Array.isArray(run.stoppages) ? run.stoppages : undefined,
    v: rawValues as unknown as AutoTrackScheduleInput["v"],
    calc: calcResult.calc,
    progress: rawValues,
    coordination: coordinationForRun as AutoTrackScheduleInput["coordination"],
    nowMs,
  });
}
