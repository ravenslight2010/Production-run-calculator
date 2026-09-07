import { computeAppSlotInfo, getAutoTrackTiming } from "./autoTrackEngine";
import type { Calc, CalcFormValues, CalcStoppage } from "./index";

export const AUTO_TRACK_SCHEDULE_CHANNELS = [
  "case", "tray-consume", "tray-produce", "batch-consume", "batch-produce", "hopper",
  "sauce-barrel", "app1-batch", "app2-batch", "app3-batch", "app4-batch",
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
    const timing = getAutoTrackTiming(
      input.calc.ppm, number(input.v.pizzasPerCase), input.calc.perTray,
      input.calc.perBatch,
    );
    const replay: Array<[AutoTrackScheduleChannel, number]> = [
      ["case", timing.caseMs],
      ["tray-consume", timing.trayMs],
      ["tray-produce", timing.trayProductionMs],
      ["batch-consume", timing.batchConsumptionMs],
      ["batch-produce", timing.batchProductionMs],
      ["hopper", timing.hopperMs],
    ];
    for (const [channel, period] of replay) {
      if (period <= 0 || entries.some((entry) => entry.channel === channel)) continue;
      const dueAt = (input.startedAt ?? input.nowMs) + period;
      entries.push({ channel, dueAt, dueNow: input.nowMs >= dueAt, nextDueAt: dueAt + period, canonical: false });
    }
  }
  if (live && !input.calc.pressDone && input.calc.sauceDepletionSec > 0) {
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
  if (live && !input.calc.pressDone) {
    for (const slot of ["app1", "app2", "app3", "app4"] as const) {
      const info = computeAppSlotInfo({
        type: input.v[`${slot}Type`],
        recipe: input.v[`${slot}CheeseRecipe`],
        batchLbs: input.v[`${slot}BatchLbs`],
        ozPerPizza: input.v[`${slot}OzPerPizza`],
        required: input.calc[`${slot}Batches`],
        ppm: input.calc.ppm,
      });
      const made = Math.max(0, number(input.progress?.[`${slot}BatchesMade`]));
      if (!info.validForClaim || made >= Math.ceil(input.calc[`${slot}Batches`])) continue;
      const dueAt = Math.max(0, number(input.progress?.[`${slot}BatchAnchorNetSec`])) + info.cadence;
      const channel = `${slot}-batch` as AutoTrackScheduleChannel;
      const state = input.coordination?.[channel];
      const owned = netCanonical(channel);
      const canonicalDue = owned ? number(state?.nextDueAt) : dueAt;
      entries.push({
        channel, dueAt: canonicalDue,
        dueNow: elapsedSec >= canonicalDue,
        nextDueAt: owned ? canonicalDue : dueAt + info.cadence, canonical: owned,
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