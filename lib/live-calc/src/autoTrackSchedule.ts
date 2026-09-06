import { computeAppSlotInfo } from "./autoTrackEngine";
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
  const live = !!input.startedAt && !input.endedAt && !input.pausedAt;
  const drain = !!input.endedAt && Number(input.v.freezerTime) > 0 &&
    input.nowMs < input.endedAt + Number(input.v.freezerTime) * 60000;
  const elapsedSec = computeAutoTrackElapsedMs(input) / 1000;
  const canonical = (channel: AutoTrackScheduleChannel, active: boolean) => {
    const state = input.coordination?.[channel];
    const dueAt = number(state?.nextDueAt);
    if (active && state && dueAt > 0) entries.push({
      channel, dueAt, nextDueAt: dueAt, dueNow: input.nowMs >= dueAt,
      canonical: true, sequence: number(state.sequence),
    });
  };
  canonical("case", live || drain);
  for (const channel of ["tray-consume", "tray-produce", "batch-consume", "batch-produce", "hopper"] as const) {
    canonical(channel, live);
  }
  if (live && !input.calc.pressDone && input.calc.sauceDepletionSec > 0) {
    const dueAt = Math.max(0, number(input.progress?.sauceBarrelAnchorNetSec)) + input.calc.sauceDepletionSec;
    entries.push({
      channel: "sauce-barrel", dueAt, dueNow: elapsedSec >= dueAt,
      nextDueAt: dueAt + input.calc.sauceDepletionSec, canonical: false,
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
      entries.push({
        channel: `${slot}-batch`, dueAt, dueNow: elapsedSec >= dueAt,
        nextDueAt: dueAt + info.cadence, canonical: false,
      });
    }
  }
  entries.sort((a, b) => AUTO_TRACK_SCHEDULE_CHANNELS.indexOf(a.channel) -
    AUTO_TRACK_SCHEDULE_CHANNELS.indexOf(b.channel));
  return {
    runId: input.runId,
    generation: `${input.runId}:${input.metaUpdatedAt ?? input.startedAt ?? 0}`,
    atMs: input.nowMs,
    entries,
  };
}