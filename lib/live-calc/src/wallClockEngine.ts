// Pure wall-clock auto-track engine (refactor Task 2).
//
// Ports the arm-state machines from the web client's useAutoTrack write
// effect into a dependency-free engine so the SERVER can own the same
// case/tray/batch state machines (and eventually execute their claims).
// Zero React dependencies; every function is deterministic on its inputs.
//
// Parity contract: the per-tick decisions delegate to the SAME shared
// compute functions the client uses (computeCaseTickWrite / computeTrayTick /
// computeBatchTick), and this file adds the bookkeeping refs, gates, and
// event building that the client's effect wires around them. Keep both
// ports in sync — see .agents/memory/autotrack-{stale-delta,remainder-carry,
// zero-seed,over-provisioning}.md and dough-inline-timers.md.
import {
  clampWebPeriodMs,
  computeBatchTick,
  computeCaseTickWrite,
  computeTrayTick,
  getAutoTrackTiming,
  suggestedDoughStaging,
  type AutoTrackTiming,
} from "./autoTrackEngine";

// ---------------------------------------------------------------------------
// Bookkeeping (the refs the client keeps in useRef, persisted per run here)
// ---------------------------------------------------------------------------

export type WallClockRunStatus = "pending" | "running" | "paused" | "ended";

export type WallClockChannel =
  | "case"
  | "tray-consume"
  | "tray-produce"
  | "batch-consume"
  | "batch-produce"
  | "hopper";

export type WallClockMutation = { field: string; from: number; to: number };

export type WallClockTickEvent = {
  channel: WallClockChannel;
  /** Wall-ms due boundary of the tick that produced this event. */
  dueAt: number;
  /** The re-armed next-due timestamp after this event. */
  nextDueAt: number;
  mutations: WallClockMutation[];
};

/** Per-run arm-state that drives when each wall-clock channel ticks. */
export interface WallClockBookkeeping {
  caseNextDueMs: number;
  trayProdNextDueMs: number;
  trayConsNextDueMs: number;
  batchProdNextDueMs: number;
  batchConsNextDueMs: number;
  hopperNextDueMs: number;
  trayLastMs: number;
  batchLastMs: number;
  /** Incremental case baseline; -1 = not baselined yet. */
  lastExpectedCases: number;
  /** Freezer-tunnel WIP baseline; -1 = not baselined yet. */
  drainFreezer: number;
  /** Fractional tray-consumption carry (sub-unit depletion accumulates). */
  traysRemainder: number;
  traySeeded: boolean;
  batchSeeded: boolean;
  /** Stale-delta single-skip guard (form reset to 0 while baseline ahead). */
  formResetSkipped: boolean;
  caseClaimRetry: boolean;
  /** 0 = not paused; non-zero wall-ms when the dough timers were paused. */
  doughPausedAtMs: number;
  /** 0 = manual pause (waits for explicit resume); >0 = timed auto-resume. */
  doughResumeAtMs: number;
}

export function createWallClockBookkeeping(): WallClockBookkeeping {
  return {
    caseNextDueMs: 0,
    trayProdNextDueMs: 0,
    trayConsNextDueMs: 0,
    batchProdNextDueMs: 0,
    batchConsNextDueMs: 0,
    hopperNextDueMs: 0,
    trayLastMs: 0,
    batchLastMs: 0,
    lastExpectedCases: -1,
    drainFreezer: -1,
    traysRemainder: 0,
    traySeeded: false,
    batchSeeded: false,
    formResetSkipped: false,
    caseClaimRetry: false,
    doughPausedAtMs: 0,
    doughResumeAtMs: 0,
  };
}

/** Mirror of the client's rearmCaseTimer + rearmDoughTimers. Batch PRODUCTION
 * is intentionally left alone (the client re-arms it only via first-tick
 * arming in computeBatchTick). */
export function rearmWallClockTimers(
  bookkeeping: WallClockBookkeeping,
  nowMs: number,
  timing: AutoTrackTiming,
): WallClockBookkeeping {
  return {
    ...bookkeeping,
    caseNextDueMs: timing.caseMs > 0 ? nowMs + timing.caseMs : 0,
    trayProdNextDueMs: timing.trayProductionMs > 0 ? nowMs + timing.trayProductionMs : 0,
    hopperNextDueMs: timing.hopperMs > 0 ? nowMs + timing.hopperMs : 0,
    trayConsNextDueMs: timing.trayMs > 0 ? nowMs + timing.trayMs : 0,
    trayLastMs: 0,
    batchConsNextDueMs: timing.batchConsumptionMs > 0 ? nowMs + timing.batchConsumptionMs : 0,
    batchLastMs: 0,
    doughPausedAtMs: 0,
    doughResumeAtMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Per-instant tick — a faithful port of the client's wall-clock write effect
// ---------------------------------------------------------------------------

export type WallClockTickInput = {
  bookkeeping: WallClockBookkeeping;
  nowMs: number;
  timing: AutoTrackTiming;
  runStatus: WallClockRunStatus;
  drainActive: boolean;
  packagingDrainActive: boolean;
  packagingAutoTrackActive: boolean;
  /** Manual-edit suppression window (applies to case writes). */
  caseSuppressed: boolean;
  /** Manual-edit suppression window (applies to dough writes). */
  doughSuppressed: boolean;
  calc: {
    ppm: number;
    perTray: number;
    perBatch: number;
    pressDone: boolean;
    casesInFreezer: number;
    traysNeeded: number;
    batchesNeeded: number;
  };
  v: {
    pizzasPerCase: number;
    casesPerSkid: number;
    casesNeeded: number;
    traysOnLine: number;
    batchesReady: number;
  };
  form: {
    skidsCompleted: number;
    casesOnCurrentSkid: number;
    traysOnLine: number;
    batchesReady: number;
  };
  /** Unclamped time-based case total (incremental delta source). */
  expectedCasesRaw: number;
  /** Clamped-to-casesNeeded case total (write/display source). */
  expectedCases: number;
};

export function tickWallClock(input: WallClockTickInput): {
  next: WallClockBookkeeping;
  events: WallClockTickEvent[];
} {
  const bk = input.bookkeeping;
  const next: WallClockBookkeeping = { ...bk };
  const events: WallClockTickEvent[] = [];

  const caseTrackingActive =
    (input.runStatus === "running" && input.packagingAutoTrackActive)
    || input.drainActive
    || input.packagingDrainActive;

  // ── Cases (and skids, derived from the same total): tick once per case. ──
  if (
    caseTrackingActive
    && input.calc.ppm > 0
    && input.v.pizzasPerCase > 0
    // Mirrors the client's `!autoTrackSuggestion` effect gate (suggestion is
    // null whenever casesPerSkid is missing), so the event builder's
    // div-by-casesPerSkid can never produce an invalid mutation server-side.
    && input.v.casesPerSkid > 0
    && input.nowMs >= next.caseNextDueMs
  ) {
    const casePeriodMs = clampWebPeriodMs((input.v.pizzasPerCase / input.calc.ppm) * 60000);
    const prevExpected = next.lastExpectedCases;
    next.caseNextDueMs = input.nowMs + casePeriodMs;
    // Baseline advances EVERY tick (even suppressed) so the drain delta is
    // always measured from the latest tunnel state and a suppression window
    // expiring never causes a catch-up jump.
    next.lastExpectedCases = input.expectedCasesRaw;
    const prevFreezer = next.drainFreezer;
    next.drainFreezer = Math.max(0, Math.floor(input.calc.casesInFreezer));
    if (!input.caseSuppressed) {
      const curTotal =
        (input.form.skidsCompleted || 0) * input.v.casesPerSkid +
        (input.form.casesOnCurrentSkid || 0);
      const decision = computeCaseTickWrite({
        prevExpected,
        expectedRaw: input.expectedCasesRaw,
        expectedCases: input.expectedCases,
        prevFreezer,
        nextFreezer: next.drainFreezer,
        curTotal,
        casesPerSkid: input.v.casesPerSkid,
        casesNeeded: input.v.casesNeeded,
        drainActive: input.drainActive,
        packagingDrainActive: input.packagingDrainActive,
        caseClaimRetry: next.caseClaimRetry,
        formResetSkipped: next.formResetSkipped,
      });
      if (decision.caseClaimRetryReset) next.caseClaimRetry = false;
      next.formResetSkipped = decision.formResetSkippedNew;
      const fired = decision.action !== "none" && decision.action !== "reset-skip";
      if (fired) {
        const nextSkids = Math.floor(decision.newTotal / input.v.casesPerSkid);
        const nextCases = Math.round(decision.newTotal % input.v.casesPerSkid);
        events.push({
          channel: "case",
          dueAt: input.nowMs,
          nextDueAt: next.caseNextDueMs,
          mutations: [
            { field: "skidsCompleted", from: input.form.skidsCompleted || 0, to: nextSkids },
            { field: "casesOnCurrentSkid", from: input.form.casesOnCurrentSkid || 0, to: nextCases },
          ],
        });
      }
    }
  }

  // ── Hopper cycle display tick: arms once, then cycles every hopperSec.
  // Runs BEFORE the dough pause guard (the UI shows "—:—" while paused).
  const hopperSec =
    input.timing.hopperMs > 0 ? input.timing.hopperMs / 1000 : 0;
  if (input.runStatus === "running" && hopperSec > 0) {
    if (next.hopperNextDueMs === 0) {
      next.hopperNextDueMs = input.nowMs + input.timing.hopperMs;
    } else if (input.nowMs >= next.hopperNextDueMs) {
      next.hopperNextDueMs = input.nowMs + input.timing.hopperMs;
      events.push({
        channel: "hopper",
        dueAt: input.nowMs,
        nextDueAt: next.hopperNextDueMs,
        mutations: [],
      });
    }
  }

  // ── Dough-timer pause gate ────────────────────────────────────────────────
  if (next.doughPausedAtMs > 0) {
    if (next.doughResumeAtMs > 0 && input.nowMs >= next.doughResumeAtMs) {
      // Timed correction pause ended: re-arm every dough channel and skip this
      // render so the next tick starts from a clean, full cadence.
      return { next: rearmWallClockTimers(next, input.nowMs, input.timing), events };
    }
    return { next, events };
  }

  const doughFeedComplete = input.calc.pressDone;

  // ── Trays ────────────────────────────────────────────────────────────────
  // Tracks how many trays were auto-seeded this tick so the batch seed below
  // subtracts the tray coverage (seeding both at the full deficit would
  // double-count dough-on-hand).
  let traysSeededAmount = 0;
  if (input.runStatus === "running" && input.calc.perTray > 0 && input.calc.ppm > 0) {
    const trayTick = computeTrayTick({
      nowMs: input.nowMs,
      prodDueMs: next.trayProdNextDueMs,
      consDueMs: next.trayConsNextDueMs,
      lastMs: next.trayLastMs,
      periodMs: input.timing.trayMs,
      suppressed: input.doughSuppressed,
      feedComplete: doughFeedComplete,
      deficitOpen: input.calc.traysNeeded > 0 || input.v.batchesReady > 0,
      seeded: next.traySeeded,
      current: input.form.traysOnLine || 0,
      seed: suggestedDoughStaging(input.calc.traysNeeded, input.calc.batchesNeeded).trays,
      ppm: input.calc.ppm,
      perTray: input.calc.perTray,
      remainder: next.traysRemainder,
    });
    next.trayProdNextDueMs = trayTick.prodDueMsNew;
    next.trayConsNextDueMs = trayTick.consDueMsNew;
    next.trayLastMs = trayTick.lastMsNew;
    next.traysRemainder = trayTick.remainderNew;
    next.traySeeded = trayTick.seededNew;
    if (trayTick.seed) {
      traysSeededAmount = trayTick.seed.to;
      events.push({
        channel: "tray-consume",
        dueAt: input.nowMs,
        nextDueAt: next.trayConsNextDueMs,
        mutations: [{ field: "traysOnLine", from: trayTick.seed.from, to: trayTick.seed.to }],
      });
    } else if (trayTick.delta !== 0) {
      const trayNext = Math.max(0, input.v.traysOnLine + trayTick.delta);
      if (trayNext !== input.v.traysOnLine) {
        events.push({
          channel: trayTick.delta > 0 ? "tray-produce" : "tray-consume",
          dueAt: input.nowMs,
          nextDueAt: trayTick.delta > 0 ? next.trayProdNextDueMs : next.trayConsNextDueMs,
          mutations: [
            { field: "traysOnLine", from: input.form.traysOnLine || 0, to: trayNext },
          ],
        });
      }
    }
  }

  // ── Batches ──────────────────────────────────────────────────────────────
  if (input.runStatus === "running" && input.calc.perBatch > 0 && input.calc.ppm > 0) {
    const batchTick = computeBatchTick({
      nowMs: input.nowMs,
      prodDueMs: next.batchProdNextDueMs,
      consDueMs: next.batchConsNextDueMs,
      lastMs: next.batchLastMs,
      periodMs: input.timing.batchConsumptionMs,
      fullBatchMs: input.timing.batchProductionMs,
      effDrainMs: Math.max(
        input.timing.hopperMs,
        (input.calc.perBatch / input.calc.ppm) * 60000,
      ),
      suppressed: input.doughSuppressed,
      feedComplete: doughFeedComplete,
      deficitOpen: input.calc.batchesNeeded > 0,
      seeded: next.batchSeeded,
      current: input.form.batchesReady || 0,
      traysSeededAmount,
      traysNeeded: input.calc.traysNeeded,
      batchesNeeded: input.calc.batchesNeeded,
    });
    next.batchProdNextDueMs = batchTick.prodDueMsNew;
    next.batchConsNextDueMs = batchTick.consDueMsNew;
    next.batchLastMs = batchTick.lastMsNew;
    next.batchSeeded = batchTick.seededNew;
    if (batchTick.seed) {
      events.push({
        channel: "batch-consume",
        dueAt: input.nowMs,
        nextDueAt: next.batchConsNextDueMs,
        mutations: [{ field: "batchesReady", from: batchTick.seed.from, to: batchTick.seed.to }],
      });
    } else if (batchTick.delta !== 0) {
      let batchNext = input.v.batchesReady + batchTick.delta;
      if (batchTick.delta > 0) batchNext = Math.min(batchNext, Math.max(input.v.batchesReady, 3));
      batchNext = Math.max(0, Math.round(batchNext * 100) / 100);
      if (batchNext !== input.v.batchesReady) {
        events.push({
          channel: batchTick.delta > 0 ? "batch-produce" : "batch-consume",
          dueAt: input.nowMs,
          nextDueAt: batchTick.delta > 0 ? next.batchProdNextDueMs : next.batchConsNextDueMs,
          mutations: [
            { field: "batchesReady", from: input.form.batchesReady || 0, to: batchNext },
          ],
        });
      }
    }
  }

  return { next, events };
}

// ---------------------------------------------------------------------------
// Stateless due-ref replay (compute-only verdicts for the schedule)
// ---------------------------------------------------------------------------
//
// The client re-arms every wall-clock timer at each resume transition
// (due = resumeInstant + period; the run-start transition also fires one
// immediate baseline tick because the due refs start at 0), then each tick
// re-arms due = now + period. Over a running segment [s, e] the due ref
// therefore lands at `s + (floor((e - s) / period) + 1) * period`. This is
// deterministic from the run timestamps alone — no bookkeeping needs to be
// persisted to publish wall-clock due-now verdicts. Boundaries within a
// sub-second of a tick are absorbed by the claim protocol (a catch-up tick
// just re-computes its delta from current values).
//
// Pauses freeze due refs (the client's dough blocks return before ticking);
// non-pause downtime does NOT (the effect keeps ticking every second; the
// expected values simply stop growing). Hopper follows the same cadence
// (arms at +hopperMs, then cycles). Machine-time inputs are approximated
// from the stored run values when known.

export type WallClockDueRefs = {
  caseDueMs: number;
  trayProdDueMs: number;
  trayConsDueMs: number;
  batchProdDueMs: number;
  batchConsDueMs: number;
  hopperDueMs: number;
};

export type WallClockStoppage = { type?: string; startedAt: number; endedAt?: number };

/** Running segments for a run, split only by pause intervals (non-pause
 * downtime keeps ticking). Pauses without an endedAt are treated as still
 * paused. */
export function buildRunningSegments(input: {
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  nowMs: number;
  stoppages?: WallClockStoppage[];
}): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  const startedAt = Number.isFinite(input.startedAt) ? (input.startedAt as number) : NaN;
  if (!Number.isFinite(startedAt)) return segments;
  const pauses = (input.stoppages ?? [])
    .filter((s) => (s.type ?? "") === "pause")
    .map((s) => ({ start: s.startedAt, end: s.endedAt }))
    .filter((s) => Number.isFinite(s.start))
    .sort((a, b) => a.start - b.start);
  let cursor = startedAt;
  for (const pause of pauses) {
    const segEnd = Math.min(pause.start, input.nowMs);
    if (segEnd > cursor) segments.push({ start: cursor, end: segEnd });
    if (!pause.end || pause.end >= input.nowMs) {
      cursor = input.nowMs;
      break;
    }
    cursor = Math.max(cursor, pause.end);
  }
  const horizon = Number.isFinite(input.endedAt) && (input.endedAt as number) < input.nowMs
    ? (input.endedAt as number)
    : input.nowMs;
  if (horizon > cursor) segments.push({ start: cursor, end: horizon });
  return segments;
}

/** Compute each wall-clock channel's next-due timestamp by replaying the
 * rearm-at-resume cadence over the run's running segments. Returns null when
 * there is no valid anchor. */
export function computeWallClockDueRefs(input: {
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  nowMs: number;
  stoppages?: WallClockStoppage[];
  timing: AutoTrackTiming;
}): WallClockDueRefs | null {
  if (!Number.isFinite(input.startedAt)) return null;
  const segments = buildRunningSegments(input);
  if (segments.length === 0) return null;

  const advance = (periodMs: number): number => {
    if (!Number.isFinite(periodMs) || periodMs <= 0) return 0;
    let due = 0;
    for (const seg of segments) {
      const dur = Math.max(0, seg.end - seg.start);
      // +1 = the immediate baseline/arm tick that starts each segment (due
      // refs start at 0 at run start; resume re-arms to segmentStart + period).
      const segDue = seg.start + (Math.floor(dur / periodMs) + 1) * periodMs;
      due = segDue;
    }
    return due;
  };

  return {
    caseDueMs: advance(input.timing.caseMs),
    trayProdDueMs: advance(input.timing.trayProductionMs),
    trayConsDueMs: advance(input.timing.trayMs),
    batchProdDueMs: advance(input.timing.batchProductionMs),
    batchConsDueMs: advance(input.timing.batchConsumptionMs),
    hopperDueMs: advance(input.timing.hopperMs),
  };
}

export type { AutoTrackTiming };
export { getAutoTrackTiming };
