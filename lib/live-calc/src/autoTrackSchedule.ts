// Server-side auto-track schedule (refactor steps 6a + Task 2).
//
// "Tick detection" for the NET-SECOND channels (sauce barrel, applicator
// batches) is pure stored-state math: anchor + cadence vs. pause-aware elapsed
// net seconds. The server can therefore compute when those claims are due
// WITHOUT any client having to tick first. The WALL-CLOCK channels (case,
// trays, batches, hopper) mirror the client's arming state machine through the
// shared wallClockEngine: canonical coordination records still win (echoed
// verbatim), and otherwise the deterministic rearm-at-resume replay in
// computeWallClockDueRefs derives the next due (compute-only verdicts, gated;
// the client still executes wall-clock writes through the claim endpoint).
//
// Invariants mirrored from useAutoTrack.ts (see .agents/skills/state-accuracy-check):
//   - Net-time excludes pause gaps. On resume the client REBASES
//     run.startedAt (applyResumeToRun → computeResumedStartedAt), so elapsed
//     from the stored startedAt is pause-correct without any extra bookkeeping.
//   - Sauce cadence = calc.sauceDepletionSec (barrelLbs*16/oz/ppm*60).
//   - Applicator cadence = (effectiveBatchLbs*16/ozPerPizza/ppm)*60, gated on
//     non-mix types, positive effective batch/oz/required, and made < ceil(required).
//   - pressDone stops sauce + applicator claims.
//   - Paused/ended runs emit no sauce/applicator claims; case drain window is
//     the only post-End exception and it only echoes canonical coordination.
import type { Calc, CalcFormValues, CalcStoppage, ServerCalcResult } from "./index";
import { computeWallClockDueRefs, getAutoTrackTiming } from "./wallClockEngine";

export const AUTO_TRACK_SCHEDULE_CHANNELS = [
  "case",
  "tray-consume",
  "tray-produce",
  "batch-consume",
  "batch-produce",
  "hopper",
  "sauce-barrel",
  "app1-batch",
  "app2-batch",
  "app3-batch",
  "app4-batch",
] as const;

export type AutoTrackScheduleChannel = typeof AUTO_TRACK_SCHEDULE_CHANNELS[number];

export type AutoTrackScheduleEntry = {
  channel: AutoTrackScheduleChannel;
  /** Wall-ms for case/tray/batch/hopper; NET-SECONDS for sauce-barrel/appN-batch. */
  dueAt: number;
  dueNow: boolean;
  /** Same domain as dueAt — the claim AFTER this one. */
  nextDueAt: number;
  /** True when this echoes the persisted coordination record. */
  canonical: boolean;
  /** Coordination sequence when canonical (clients keep their own sequence in sync). */
  sequence?: number;
};

export type AutoTrackSchedule = {
  runId: string;
  generation: string;
  atMs: number;
  entries: AutoTrackScheduleEntry[];
};

/** Minimal coordination/claims record shape the scheduler reads. */
export type AutoTrackScheduleCoordinationState = {
  generation?: string;
  sequence?: number;
  nextDueAt?: number;
};

/** Stored run-progress fields read by the schedule (numeric coercion-safe). */
export type AutoTrackScheduleProgress = Record<string, unknown>;

export type AutoTrackScheduleInput = {
  runId: string;
  metaUpdatedAt?: number;
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  stoppages?: CalcStoppage[];
  v: CalcFormValues;
  calc: Calc;
  progress?: AutoTrackScheduleProgress;
  coordination?: Partial<
    Record<AutoTrackScheduleChannel, AutoTrackScheduleCoordinationState>
  >;
  /** Measured machine times (run values) for dough timing: mixers + hopper. */
  machine?: { spinSec?: number; hopperSec?: number };
  nowMs: number;
};

function toNumber(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function clampPeriodMs(periodMs: number): number {
  if (!Number.isFinite(periodMs) || periodMs <= 0) return 0;
  return Math.min(60 * 60 * 1000, Math.max(2000, periodMs));
}

/**
 * Pause-aware elapsed net ms, mirroring the client's elapsedBatchSec:
 * `(pausedAt ?? nowMs) - startedAt - closedNonPauseDowntimeMs`. Closed pause
 * stoppages are intentionally NOT subtracted: on resume the client REBASES
 * startedAt forward by the paused duration, so the stored startedAt is
 * already pause-correct.
 */
export function computeAutoTrackElapsedMs(input: {
  startedAt?: number;
  pausedAt?: number;
  nowMs: number;
  stoppages?: CalcStoppage[];
}): number {
  if (!Number.isFinite(input.startedAt)) return 0;
  const downtimeMs = (input.stoppages ?? [])
    .filter((s) => s.type !== "pause" && !!s.endedAt)
    .reduce((acc, s) => acc + Math.max(0, (s.endedAt ?? 0) - s.startedAt), 0);
  return Math.max(
    0,
    (input.pausedAt ?? input.nowMs) - (input.startedAt as number) - downtimeMs,
  );
}

/**
 * Compute the server's view of every auto-track channel's next-due for one
 * run. Purely advisory: nothing is written here — clients adopt the entries
 * (or ignore them); live-claim validation still lives in the claim endpoint.
 */
export function computeAutoTrackSchedule(
  input: AutoTrackScheduleInput,
): AutoTrackSchedule {
  const {
    runId,
    metaUpdatedAt,
    startedAt,
    pausedAt,
    endedAt,
    stoppages,
    v,
    calc,
    progress = {},
    coordination,
    nowMs,
  } = input;
  const generation = `${runId}:${metaUpdatedAt ?? startedAt ?? 0}`;
  const entries: AutoTrackScheduleEntry[] = [];

  const runIsLive = !!startedAt && !endedAt && !pausedAt;
  const drainMs = Number(v.freezerTime) * 60000;
  const drainActive =
    !!startedAt &&
    !!endedAt &&
    endedAt > 0 &&
    drainMs > 0 &&
    nowMs < endedAt + drainMs;
  const netMs = computeAutoTrackElapsedMs({ startedAt, pausedAt, nowMs, stoppages });
  const netSec = netMs / 1000;
  const machine = input.machine ?? {};
  const timing = getAutoTrackTiming(
    calc.ppm,
    toNumber(v.pizzasPerCase),
    calc.perTray,
    calc.perBatch,
    { spinSec: toNumber(machine.spinSec), hopperSec: toNumber(machine.hopperSec) },
  );

  const echoCanonical = (
    channel: AutoTrackScheduleChannel,
    active: boolean,
  ): void => {
    const state = coordination?.[channel];
    const dueAt = toNumber(state?.nextDueAt);
    if (!active || !state || !(dueAt > 0)) return;
    emittedWallClock.add(channel);
    entries.push({
      channel,
      dueAt,
      dueNow: nowMs >= dueAt,
      nextDueAt: dueAt,
      canonical: true,
      sequence: toNumber(state?.sequence),
    });
  };
  /** Wall-clock channels already emitted above (canonical echo wins). */
  const emittedWallClock = new Set<AutoTrackScheduleChannel>();

  // ── Wall-clock channels: canonical coordination echo first, then the
  // pure-engine replay (compute-only verdicts, Task 2). ──
  echoCanonical("case", runIsLive || drainActive);
  echoCanonical("tray-consume", runIsLive);
  echoCanonical("tray-produce", runIsLive);
  echoCanonical("batch-consume", runIsLive);
  echoCanonical("batch-produce", runIsLive);
  echoCanonical("hopper", runIsLive);

  // Deterministic rearm-at-resume replay for channels with no canonical
  // record yet (fresh run, no claims). Gated to live runs within the replay
  // window; a claim anywhere re-persists the canonical nextDueAt and takes
  // over from the next beat. Compute-only: the client still executes the
  // actual write through the validated claim endpoint.
  const WALL_CLOCK_REPLAY_CAP_MS = 6 * 60 * 60 * 1000;
  const replayDue =
    !!startedAt && runIsLive && nowMs - startedAt <= WALL_CLOCK_REPLAY_CAP_MS
      ? computeWallClockDueRefs({ startedAt, pausedAt, endedAt, nowMs, stoppages, timing })
      : null;
  const emitReplay = (
    channel: AutoTrackScheduleChannel,
    dueAt: number,
    periodMs: number,
  ): void => {
    if (emittedWallClock.has(channel) || !Number.isFinite(dueAt) || dueAt <= 0 || periodMs <= 0) return;
    entries.push({
      channel,
      dueAt,
      dueNow: nowMs >= dueAt,
      nextDueAt: dueAt + periodMs,
      canonical: false,
    });
  };
  if (replayDue) {
    if (calc.ppm > 0 && toNumber(v.pizzasPerCase) > 0) {
      emitReplay("case", replayDue.caseDueMs, timing.caseMs);
    }
    if (calc.ppm > 0 && calc.perTray > 0) {
      emitReplay("tray-consume", replayDue.trayConsDueMs, timing.trayMs);
      emitReplay("tray-produce", replayDue.trayProdDueMs, timing.trayProductionMs);
    }
    if (calc.ppm > 0 && calc.perBatch > 0) {
      emitReplay("batch-consume", replayDue.batchConsDueMs, timing.batchConsumptionMs);
      emitReplay("batch-produce", replayDue.batchProdDueMs, timing.batchProductionMs);
    }
    if ((machine.hopperSec ?? 0) > 0) {
      emitReplay("hopper", replayDue.hopperDueMs, timing.hopperMs);
    }
  }

  // ── Sauce barrel: pure stored-state net-second math. ──
  if (runIsLive && !calc.pressDone) {
    const cadence = toNumber(calc.sauceDepletionSec);
    const anchor = Math.max(0, toNumber(progress.sauceBarrelAnchorNetSec));
    if (cadence > 0) {
      const dueAt = anchor + cadence;
      entries.push({
        channel: "sauce-barrel",
        dueAt,
        dueNow: netSec >= dueAt,
        nextDueAt: dueAt + cadence,
        canonical: false,
      });
    }
  }

  // ── Applicator batches: per-slot net-second math with the client's gates. ──
  if (runIsLive && !calc.pressDone) {
    const slots = ["app1", "app2", "app3", "app4"] as const;
    for (const slot of slots) {
      const recipeLbs = (v[`${slot}CheeseRecipe`] ?? [])
        .reduce((sum: number, row) => sum + (toNumber(row.lbs) || 0), 0);
      const effectiveBatchLbs = recipeLbs > 0
        ? recipeLbs
        : toNumber(v[`${slot}BatchLbs`]);
      const ounces = toNumber(v[`${slot}OzPerPizza`]);
      const required = toNumber(calc[`${slot}Batches`]);
      const type = String(v[`${slot}Type`] ?? "");
      const valid =
        !!type.trim() &&
        !type.trim().toLowerCase().includes("mix") &&
        effectiveBatchLbs > 0 &&
        ounces > 0 &&
        required > 0 &&
        calc.ppm > 0;
      if (!valid) continue;
      const made = Math.max(0, toNumber(progress[`${slot}BatchesMade`]));
      if (made >= Math.ceil(required)) continue;
      const cadence = (effectiveBatchLbs * 16 / ounces / calc.ppm) * 60;
      if (!Number.isFinite(cadence) || cadence <= 0) continue;
      const anchor = Math.max(0, toNumber(progress[`${slot}BatchAnchorNetSec`]));
      const dueAt = anchor + cadence;
      entries.push({
        channel: `${slot}-batch`,
        dueAt,
        dueNow: netSec >= dueAt,
        nextDueAt: dueAt + cadence,
        canonical: false,
      });
    }
  }

  entries.sort((a, b) => {
    const order = (c: AutoTrackScheduleChannel): number =>
      AUTO_TRACK_SCHEDULE_CHANNELS.indexOf(c);
    return order(a.channel) - order(b.channel);
  });

  return { runId, generation, atMs: nowMs, entries };
}

// ── Server-side schedule builder (refactor steps 6a/7) ──────────────────────
// Extracts the schedule inputs from a SyncPayload-shaped object and builds the
// auto-track schedule. Shared by the API SSE/claim paths and the server tick
// loop so every consumer derives due times/verdicts through the same code.
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
    machine: {
      spinSec:
        (toNumber(rawValues.mixerLowSec) || 0) +
        (toNumber(rawValues.mixerHighSec) || 0),
      hopperSec: toNumber(rawValues.hopperSec) || 0,
    },
    nowMs,
  });
}
