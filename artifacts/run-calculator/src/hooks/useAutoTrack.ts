import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { type FormValues } from "../types";
import { AUTO_TRACK_COORDINATION_EVENT } from "../autoTrackCoordinationClient";

type RunStatus = "pending" | "running" | "paused" | "ended";

interface AutoTrackCalc {
  ppm: number;
  perTray: number;
  perBatch: number;
  traysNeeded: number;
  batchesNeeded: number;
  /**
   * True once the press has made everything the run needs — cased product
   * plus live Freeze tunnel contents ≥ casesNeeded. Count-based (real packaging
   * count + tunnel model), NOT an elapsed-time estimate: this is what stops
   * the dough counters, because from this moment the dough crew is working on
   * the NEXT run's dough.
   */
  pressDone: boolean;
  /**
   * Live Freeze tunnel contents in cases (the pure computeCasesInFreezer
   * model). During the post-End tunnel drain this is the ONLY source of
    * case-tick increments: cased count grows exactly by what EXITED the tunnel
    * since the last tick, so product moves from "in Freeze tunnel" to "done" without
   * double-counting and the count can never exceed what was pressed.
   */
  casesInFreezer: number;
}

/**
 * Suggested dough staging for a run — the same numbers the "Suggest" button
 * applies to the Trays on Line / Batches Ready steppers. Derived from the
 * CURRENT deficit (traysNeeded/batchesNeeded), capped to a sane staging
 * quantity (40 trays / 3 batches). This suggestion is not a persisted tray
 * capacity: traysOnLine remains an uncapped aggregate so automatic tracking
 * never discards valid staged dough. Kept at verbatim parity with mobile
 * RunContext's suggestedDoughStaging.
 */
export type SuggestedDoughStagingReturn = { trays: number | null; batches: number | null };

export function suggestedDoughStaging(
  traysNeeded: number,
  batchesNeeded: number,
): SuggestedDoughStagingReturn {
  return {
    trays: traysNeeded > 0
      ? Math.max(1, Math.round(Math.min(40, traysNeeded)))
      : null,
    batches: batchesNeeded > 0
      ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, batchesNeeded))))
      : null,
  };
}

interface AutoTrackValues {
  casesPerSkid: number;
  pizzasPerCase: number;
  casesNeeded: number;
  freezerTime: number;
  traysOnLine: number;
  batchesReady: number;
}

export type AutoTrackChannel =
  | "case"
  | "tray-consume"
  | "tray-produce"
  | "batch-consume"
  | "batch-produce"
  | "hopper";

export type AutoTrackMutation = {
  field: "skidsCompleted" | "casesOnCurrentSkid" | "traysOnLine" | "batchesReady";
  from: number;
  to: number;
};

export type AutoTrackEventClaim = {
  version: 1;
  runId: string;
  channel: AutoTrackChannel;
  generation: string;
  sequence: number;
  eventId: string;
  dueAt: number;
  nextDueAt: number;
  baseUpdatedAt: number;
  correctionGeneration?: number;
  mutations: AutoTrackMutation[];
};

export type AutoTrackEventResult = {
  outcome: "accepted" | "duplicate" | "stale" | "conflict";
  state: { generation: string; sequence: number; nextDueAt: number };
  values: Partial<FormValues>;
};

interface AutoTrackParams {
  runId: string;
  /** Shared lifecycle stamp; changes on start/pause/resume/end/manual run switch. */
  runGeneration?: string;

  runStatus: RunStatus;
  /**
   * Wall-clock ms when the run was ended (null while pending/running/paused).
   * Drives the freezer-drain window: for freezerTime minutes after endedAt the
   * case/skid counters keep ticking (packaging is still casing what's in the
   * tunnel) while dough tray/batch tracking stays stopped.
   */

  endedAt?: number | null;
  /** Line-stage signal for packaging-only drain after a pause. */
  packagingDrainActive?: boolean;
  /** Seconds of actual packaging output during the pause. */
  packagingDrainElapsedSec?: number;
  /** False while a resumed line is refilling toward Wrapper/Packaging. */
  packagingAutoTrackActive?: boolean;

  nowTime: Date;

  elapsedBatchSec: number;

  calc: AutoTrackCalc;

  v: AutoTrackValues;

  form: UseFormReturn<FormValues>;
  /**
   * Measured machine times in seconds (0 = not measured → fall back to
   * line-speed-derived estimates, i.e. the pre-existing behavior).
   *  • spinSec: total mixer time (low + high stage) — overrides how often the
   *    mixer finishes a new batch (+1 production tick).
   *  • hopperSec: how long the hopper takes to turn one batch into balls —
   *    "batches ready" can never drain faster than the hopper converts, so the
   *    effective drain period is the SLOWER of hopper time and line demand.
   */

  machine?: { spinSec: number; hopperSec: number };
  /**
   * Hard-disable all auto-track WRITES (cast/wall display screens). A passive
   * display must never decrement trays/batches or seed staging — its writes
   * get pushed through live sync with fresh stamps and clobber the operator's
   * manual edits on every other device.
   */

  disabled?: boolean;
  /**
   * When provided, the hook uses this ref for its own suppression check
   * (Date.now() < externalAutoSuppressRef.current) instead of maintaining a
   * separate internal ref. Callers (e.g. LiveRunProvider) pass Home's ref so
   * that manual-edit suppression latches written by UI consumers are honoured
   * by the auto-track write loop.
   */

  externalAutoSuppressRef?: React.MutableRefObject<number>;
  /**
   * Persists the independently synced packaging register before a case/skid
   * auto-write lands in the form. Returning false fences a tick that raced a
   * newly adopted manual-override deadline.
   */
  onPackagingProgressAutoAdvance?: (
    skidsCompleted: number,
    casesOnCurrentSkid: number,
  ) => boolean;
  /**
   * A foreground sync pull is checking the newest shared run values. Hold all
   * counter ticks until that pull completes.
   */
  autoTrackBlocked?: boolean;
  /**
   * Synchronous companion to autoTrackBlocked. The foreground barrier ref is
   * raised before the wake clock can render, so the write effect is fenced even
   * if React has not committed the blocked state yet.
   */

  autoTrackBlockedRef?: React.MutableRefObject<boolean>;
  /**
   * Only lifecycle adoption requests a bookkeeping rebase on release. An
   * unchanged foreground pull must retain ordinary screen-off catch-up.
   */

  autoTrackRebaseAfterBlock?: boolean;
  claimAutoTrackEvent?: (claim: AutoTrackEventClaim) => Promise<AutoTrackEventResult>;
}

interface AutoTrackResult {
  autoTrackProgress: boolean;
  setAutoTrackProgress: React.Dispatch<React.SetStateAction<boolean>>;
  autoTrackSuggestion: {
    skids: number;
    casesOnSkid: number;
    expectedCases: number;
    expectedCasesRaw: number;
    trays: number | null;
    batches: number | null;
  } | null;
  autoSuppressUntilRef: React.MutableRefObject<number>;
  /**
   * Restart the requested auto-track countdown(s) from their full cadence.
   * A scoped resume must not re-arm unrelated production timers or write a
   * counter in the same render as the resume action.
   */
  fireAutoTrackNow: (scope?: "case" | "dough" | "all") => void;
  /**
   * Wall-clock ms timestamps of each counter's next tick — read-only refs for
   * countdown displays (0 = not yet armed). The UI derives "next tick in m:ss"
   * from these; they are bookkeeping owned by the hook.
   */
  tickDueRefs: {
    case: React.MutableRefObject<number>;
    tray: React.MutableRefObject<number>;
    trayProd: React.MutableRefObject<number>;
    batch: React.MutableRefObject<number>;
    batchProd: React.MutableRefObject<number>;
    /** Hopper cycle next-completion timestamp — drives the hopper countdown display. */
    hopperProd: React.MutableRefObject<number>;
  };
  /** True while the dough-timer independent pause is active. */
  isDoughTimerPaused: boolean;
  /** Freeze mixer/hopper countdown displays and suppress dough tick writes. */
  pauseDoughTimers: () => void;
  /** Restart dough countdowns from full duration and clear the paused state. */
  resumeDoughTimers: () => void;
  /** Server event acknowledgement state for accessible status messaging. */
  coordinationStatus: "ready" | "waiting" | "delayed";
}

/** Exported return type — shared with __mocks__/useAutoTrack.ts for compile-time drift detection. */
export type UseAutoTrackReturn = AutoTrackResult;

// Each counter ticks at its own natural production pace, clamped to a sane
// range: never faster than once per 1s (the app clock resolution) and never
// slower than once per hour (a stalled/garbage rate must not freeze the
// counter forever).
function clampPeriodMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 60 * 60 * 1000;
  return Math.min(60 * 60 * 1000, Math.max(1000, ms));
}

export interface AutoTrackTiming {
  caseMs: number;
  trayMs: number;
  trayProductionMs: number;
  batchConsumptionMs: number;
  batchProductionMs: number;
  hopperMs: number;
}

/**
 * The single cadence contract shared by auto-track scheduling and countdown UI.
 * Consumption remains quarter-batch internally so fractional inventory movement
 * stays visible; the UI labels that event as such rather than calling it a
 * full-batch completion.
 */
export function getAutoTrackTiming(
  ppm: number,
  pizzasPerCase: number,
  perTray: number,
  perBatch: number,
  machine?: { spinSec: number; hopperSec: number },
): AutoTrackTiming {
  const caseMs = ppm > 0 && pizzasPerCase > 0
    ? clampPeriodMs((pizzasPerCase / ppm) * 60000)
    : 0;
  const trayMs = ppm > 0 && perTray > 0
    ? clampPeriodMs((perTray / ppm) * 60000)
    : 0;
  const lineBatchMs = ppm > 0 && perBatch > 0
    ? (perBatch / ppm) * 60000
    : 0;
  const hopperMs = machine && Number.isFinite(machine.hopperSec) && machine.hopperSec > 0
    ? clampPeriodMs(machine.hopperSec * 1000)
    : 0;
  const effectiveDrainMs = Math.max(hopperMs, lineBatchMs);
  const batchConsumptionMs = effectiveDrainMs > 0
    ? clampPeriodMs(effectiveDrainMs / 4)
    : 0;
  const spinMs = machine && Number.isFinite(machine.spinSec) && machine.spinSec > 0
    ? machine.spinSec * 1000
    : 0;
  const batchProductionMs = spinMs > 0
    ? clampPeriodMs(spinMs)
    : (lineBatchMs > 0 ? clampPeriodMs(lineBatchMs) : 0);
  return {
    caseMs,
    trayMs,
    trayProductionMs: trayMs > 0 ? trayMs / 2 : 0,
    batchConsumptionMs,
    batchProductionMs,
    hopperMs,
  };
}

/**
 * Tracks expected progress automatically while running. Each counter updates
 * at its own natural production cadence instead of a fixed wall-clock interval:
 *
 *  • cases (and therefore skids): every time-to-run-one-case
 *    (pizzasPerCase / ppm). The skid counter is derived from the same total, so
 *    it rolls the moment the case count completes a skid.
 *  • trays: every time-to-consume-one-tray (perTray / ppm).
 *  • batches: every quarter-batch duration (perBatch / ppm / 4) — the integer
 *    count still drops once per full batch, via the fractional remainder carry.
 *
 * Skids/cases: applied INCREMENTALLY — each tick adds the production since the
 * last tick on top of the current (possibly manually-entered) value. This means
 * a manual correction by the operator becomes the new baseline and auto-track
 * continues forward from it instead of overwriting it with its own absolute
 * estimate. On the first tick after a (re)start/switch the absolute count is
 * seeded only when there is no existing progress, so reloads and run switches
 * never double-count saved progress.
 *
 * Trays/batches: incremental decrement per tick — subtracts consumption for the
 * actual duration since that counter's last tick (capped to 2 periods for
 * tray/batch; cases apply the full catch-up delta on wake).
 */
export function useAutoTrack({
  runId,
  runGeneration,
  runStatus,
  endedAt = null,
  packagingDrainActive = false,
  packagingDrainElapsedSec = 0,
  packagingAutoTrackActive = true,
  nowTime,
  elapsedBatchSec,
  calc,
  v,
  form,
  machine,
  disabled = false,
  externalAutoSuppressRef,
  onPackagingProgressAutoAdvance,
  autoTrackBlocked = false,
  autoTrackBlockedRef,
  // Preserve the established behavior for callers that only provide the
  // original boolean barrier. Home opts out explicitly for unchanged pulls.
  autoTrackRebaseAfterBlock = true,
  claimAutoTrackEvent,
}: AutoTrackParams): AutoTrackResult {
  const [autoTrackProgress, setAutoTrackProgress] = useState(true);
  // Independent dough-timer pause: non-zero = wall-clock ms when paused.
  // When set, tray/batch production and consumption ticks are suppressed
  // without affecting cases/skids or the global auto-track toggle.
  const doughTimerPausedRef = useRef<number>(0);
  const [isDoughTimerPaused, setIsDoughTimerPaused] = useState(false);
  const internalAutoSuppressRef = useRef<number>(0);
  // Prefer caller's ref so that suppression latches written by UI consumers
  // (e.g. Home's autoSuppressUntilRef) are seen by this hook's write loop.
  const autoSuppressUntilRef = externalAutoSuppressRef ?? internalAutoSuppressRef;
  // Per-counter "next tick due at" wall-clock timestamps (ms). 0 = fire on the
  // next tick (fresh baseline / forced resume).
  const caseNextDueMsRef = useRef<number>(0);
  const trayNextDueMsRef = useRef<number>(0);
  const batchNextDueMsRef = useRef<number>(0);
  // Production ("count up") tick schedules — the press/mixer keep MAKING dough
  // while the run still has a deficit, so the counters move up as well as down.
  // 0 = not scheduled yet (first encounter arms the schedule without writing).
  const trayProdNextDueMsRef = useRef<number>(0);
  const batchProdNextDueMsRef = useRef<number>(0);
  // Hopper cycle "next completion" timestamp — purely for the countdown display
  // (hopper does not write to any form field; this ref lets resumeDoughTimers()
  // restart the displayed countdown from the full hopper duration).
  // 0 = not yet armed; gets armed on the first tick once the run is running.
  const hopperProdNextDueMsRef = useRef<number>(0);
  // Stable container object for tickDueRefs — initialized once so the returned
  // object identity never changes across renders (prevents LiveRunContext's
  // value useMemo from firing on every LiveRunProvider re-render).
  const tickDueRefsRef = useRef({
    case: caseNextDueMsRef,
    tray: trayNextDueMsRef,
    trayProd: trayProdNextDueMsRef,
    batch: batchNextDueMsRef,
    batchProd: batchProdNextDueMsRef,
    hopperProd: hopperProdNextDueMsRef,
  });
  // Wall-clock ms of each consumption counter's last tick — drives the
  // incremental decrement (consumption for the actual elapsed duration).
  const trayLastMsRef = useRef<number>(0);
  const batchLastMsRef = useRef<number>(0);
  // expectedCases value at the last case tick — the baseline the incremental
  // skids/cases delta is measured from. -1 = "not baselined yet" (first tick
  // after a mount/reset).
  const lastExpectedCasesRef = useRef<number>(-1);
  // Fractional tray consumption carried between ticks so sub-unit depletion
  // per tick accumulates instead of being lost to Math.floor (which would
  // freeze a slow-depleting counter at its start value). Batches don't need a
  // carry: they are written as 2-decimal fractions so every quarter-batch tick
  // is visible on the counter.
  const traysRemainderRef = useRef<number>(0);
  // One-shot per run: when the operator never entered staged dough (counter is
  // 0 at that counter's first tick), seed it with the suggested staging so the
  // countdown has something to count down from. Without this the crew that
  // never types their dough counts sees trays/batches sit at 0 the whole run.
  const traySeededRef = useRef<boolean>(false);
  const batchSeededRef = useRef<boolean>(false);
  // Freezer-tunnel contents (whole cases) at the last case tick. During the
  // post-End drain window the case counter advances by EXACTLY what exited the
  // tunnel since the last tick (prev - now, never negative), so the count can
  // never run past what was actually pressed and stops on its own when the
  // tunnel is empty. -1 = not baselined yet: a device that opens mid-drain
  // baselines on its first tick instead of back-filling a catch-up jump.
  const drainFreezerRef = useRef<number>(-1);
  // Stale-delta catch-up guard. When the form is reset to 0 cases while
  // lastExpectedCasesRef still holds a positive value (e.g. after a long
  // pause or an SSE form-reset), the first delta tick would compute
  // deltaCases = expectedRaw − old_prevExpected and write that whole
  // accumulated amount on top of 0 — producing a wrong low count (e.g. 54
  // when the real count is 524). This ref allows a single re-baseline tick
  // (no write) when that pattern is detected; the NEXT tick can write
  // normally because prevExpected was updated to expectedRaw on the skipped
  // tick, so deltaCases is then ≈ 1 case.
  const formResetSkippedRef = useRef<boolean>(false);
  const caseClaimRetryRef = useRef<boolean>(false);
  const previousPackagingDrainActiveRef = useRef(false);
  const previousPackagingAutoTrackActiveRef = useRef(packagingAutoTrackActive);
  const previousPackagingClockMsRef = useRef(nowTime.getTime());
  const packagingClockRollbackUntilMsRef = useRef<number | null>(null);
  const previousRunStatusRef = useRef<RunStatus | null>(null);
  const resumeRearmPendingRef = useRef(false);
  const coordinationSequenceRef = useRef<Partial<Record<AutoTrackChannel, number>>>({});
  const coordinationRetryEventRef = useRef<Partial<Record<AutoTrackChannel, string>>>({});
  const coordinationPendingRef = useRef<Set<AutoTrackChannel>>(new Set());
  const [coordinationPendingCount, setCoordinationPendingCount] = useState(0);
  const [coordinationDelayed, setCoordinationDelayed] = useState(false);

  useEffect(() => {
    const adopt = (event: Event) => {
      const coordination = (event as CustomEvent<{
        runs?: Record<string, Partial<Record<AutoTrackChannel, {
          generation: string;
          sequence: number;
          nextDueAt: number;
        }>>>;
      }>).detail;
      const channels = coordination?.runs?.[runId];
      if (!channels) return;
      for (const [channel, state] of Object.entries(channels) as Array<[
        AutoTrackChannel,
        { generation: string; sequence: number; nextDueAt: number },
      ]>) {
        const generation = `${runId}:${runGeneration ?? `${runStatus}:${endedAt ?? 0}`}`.slice(0, 160);
        if (state.generation !== generation) {
          coordinationSequenceRef.current[channel] = 0;
          const dueRef = channel === "case"
            ? caseNextDueMsRef
            : channel === "tray-consume"
              ? trayNextDueMsRef
              : channel === "tray-produce"
                ? trayProdNextDueMsRef
                : channel === "batch-consume"
                  ? batchNextDueMsRef
                  : channel === "batch-produce"
                    ? batchProdNextDueMsRef
                    : hopperProdNextDueMsRef;
          dueRef.current = state.nextDueAt;
          continue;
        }
        coordinationSequenceRef.current[channel] = Math.max(
          coordinationSequenceRef.current[channel] ?? 0,
          state.sequence,
        );
        const dueRef = channel === "case"
          ? caseNextDueMsRef
          : channel === "tray-consume"
            ? trayNextDueMsRef
            : channel === "tray-produce"
              ? trayProdNextDueMsRef
              : channel === "batch-consume"
                ? batchNextDueMsRef
                : channel === "batch-produce"
                  ? batchProdNextDueMsRef
                  : hopperProdNextDueMsRef;
        dueRef.current = state.nextDueAt;
      }
    };
    window.addEventListener(AUTO_TRACK_COORDINATION_EVENT, adopt);
    return () => window.removeEventListener(AUTO_TRACK_COORDINATION_EVENT, adopt);
  }, [endedAt, runGeneration, runId, runStatus]);

  // Freezer-drain window: after End Run, packaging keeps casing product for as
  // long as the tunnel takes to empty. Case/skid auto-track keeps ticking
  // through this window; dough tray/batch tracking stays stopped (the dough
  // crew is on the next run). A run ended longer than freezerTime ago is fully
  // stopped — a page opened later must never tick it.
  const drainMs = Number(v.freezerTime) * 60000;
  const drainActive =
    runStatus === "ended" &&
    typeof endedAt === "number" &&
    endedAt > 0 &&
    drainMs > 0 &&
    nowTime.getTime() < endedAt + drainMs;

  const autoTrackSuggestion = useMemo(() => {
    const ok =
      (runStatus === "running" || runStatus === "paused" || drainActive) &&
      calc.ppm > 0 &&
      v.casesPerSkid > 0 &&
      v.pizzasPerCase > 0;
    if (!ok) return null;

    const maxSkids = Math.floor(v.casesNeeded / v.casesPerSkid);
    const elapsedMin = elapsedBatchSec / 60;
    const elapsedMinAfterTunnel = Math.max(0, elapsedMin - Number(v.freezerTime));
    // Clamp to the run's total need so skids/cases freeze at their final state
    // once production is complete instead of cycling past it (modulo wrap).
    const expectedCasesRaw = packagingDrainActive
      ? Math.floor((Math.max(0, packagingDrainElapsedSec) * calc.ppm) / (v.pizzasPerCase * 60))
      : Math.floor((elapsedMinAfterTunnel * calc.ppm) / v.pizzasPerCase);
    const expectedCases = v.casesNeeded > 0 ? Math.min(v.casesNeeded, expectedCasesRaw) : expectedCasesRaw;

    return {
      skids: Math.min(maxSkids, Math.floor(expectedCases / v.casesPerSkid)),
      casesOnSkid: Math.min(v.casesPerSkid, expectedCases % v.casesPerSkid),
      expectedCases,
      // Unclamped time-based total — drives the INCREMENTAL delta below so that a
      // downward manual correction (e.g. after the estimate ran ahead and hit the
      // casesNeeded clamp) can still climb again. The clamp lives only on what is
      // displayed/written, not on the delta source.
      expectedCasesRaw,
      // Tray/batch suggestions are handled incrementally in the write effect;
      // returning null here means the UI falls back to the calc-based suggestion.
      trays: null,
      batches: null,
    };
  }, [
    runStatus,
    drainActive,
    packagingDrainActive,
    packagingDrainElapsedSec,
    calc.ppm,
    calc.perTray,
    calc.perBatch,
    v.casesPerSkid,
    v.pizzasPerCase,
    v.casesNeeded,
    v.freezerTime,
    elapsedBatchSec,
  ]);

  const resetBookkeeping = useCallback(() => {
    caseNextDueMsRef.current = 0;
    trayNextDueMsRef.current = 0;
    batchNextDueMsRef.current = 0;
    trayProdNextDueMsRef.current = 0;
    batchProdNextDueMsRef.current = 0;
    hopperProdNextDueMsRef.current = 0;
    trayLastMsRef.current = 0;
    batchLastMsRef.current = 0;
    lastExpectedCasesRef.current = -1;
    traysRemainderRef.current = 0;
    traySeededRef.current = false;
    batchSeededRef.current = false;
    drainFreezerRef.current = -1;
    formResetSkippedRef.current = false;
    previousPackagingDrainActiveRef.current = false;
    previousPackagingAutoTrackActiveRef.current = packagingAutoTrackActive;
    coordinationSequenceRef.current = {};
    coordinationRetryEventRef.current = {};
    coordinationPendingRef.current.clear();
    setCoordinationPendingCount(0);
    setCoordinationDelayed(false);
    // Clear dough-timer pause on run change / stop so it never bleeds across runs.
    doughTimerPausedRef.current = 0;
    setIsDoughTimerPaused(false);
  }, []);

  const rearmCaseTimer = useCallback((nowMs: number) => {
    const timing = getAutoTrackTiming(
      calc.ppm,
      v.pizzasPerCase,
      calc.perTray,
      calc.perBatch,
      machine,
    );
    caseNextDueMsRef.current = timing.caseMs > 0 ? nowMs + timing.caseMs : 0;
  }, [calc.perBatch, calc.perTray, calc.ppm, machine, v.pizzasPerCase]);

  const rearmDoughTimers = useCallback((nowMs: number) => {
    const timing = getAutoTrackTiming(
      calc.ppm,
      v.pizzasPerCase,
      calc.perTray,
      calc.perBatch,
      machine,
    );
    // Rebase every dough channel at the same instant. Consumption anchors are
    // cleared so the first completed interval cannot replay paused elapsed time.
    doughTimerPausedRef.current = 0;
    setIsDoughTimerPaused(false);
    trayProdNextDueMsRef.current = timing.trayProductionMs > 0 ? nowMs + timing.trayProductionMs : 0;
    batchProdNextDueMsRef.current = timing.batchProductionMs > 0 ? nowMs + timing.batchProductionMs : 0;
    hopperProdNextDueMsRef.current = timing.hopperMs > 0 ? nowMs + timing.hopperMs : 0;
    trayNextDueMsRef.current = timing.trayMs > 0 ? nowMs + timing.trayMs : 0;
    trayLastMsRef.current = 0;
    batchNextDueMsRef.current = timing.batchConsumptionMs > 0 ? nowMs + timing.batchConsumptionMs : 0;
    batchLastMsRef.current = 0;
  }, [calc.perBatch, calc.perTray, calc.ppm, machine, v.pizzasPerCase]);

  // Restart the selected timer from its full duration. Unlike
  // resetBookkeeping this keeps the case-progress baseline and completed work
  // intact, so a manual "Resume auto tracking" cannot create a catch-up jump.
  const fireAutoTrackNow = useCallback((scope: "case" | "dough" | "all" = "all") => {
    const nowMs = Date.now();
    if (scope === "case" || scope === "all") {
      rearmCaseTimer(nowMs);
    }
    if (scope === "dough" || scope === "all") {
      rearmDoughTimers(nowMs);
    }
  }, [rearmCaseTimer, rearmDoughTimers]);

  const commitAutomatic = useCallback((
    channel: AutoTrackChannel,
    dueAt: number,
    nextDueAt: number,
    mutations: AutoTrackMutation[],
  ) => {
    const applyValues = (values: Partial<FormValues>) => {
      const nextSkids = values.skidsCompleted;
      const nextCases = values.casesOnCurrentSkid;
      if (typeof nextSkids === "number" && typeof nextCases === "number") {
        if (onPackagingProgressAutoAdvance?.(nextSkids, nextCases) === false) return;
        form.setValue("skidsCompleted", nextSkids, { shouldDirty: true });
        form.setValue("casesOnCurrentSkid", nextCases, { shouldDirty: true });
      }
      if (typeof values.traysOnLine === "number") {
        form.setValue("traysOnLine", values.traysOnLine, { shouldDirty: true });
      }
      if (typeof values.batchesReady === "number") {
        form.setValue("batchesReady", values.batchesReady, { shouldDirty: true });
      }
    };
    const localValues = Object.fromEntries(mutations.map((mutation) => [mutation.field, mutation.to])) as Partial<FormValues>;
    if (!claimAutoTrackEvent) {
      applyValues(localValues);
      return;
    }
    if (coordinationPendingRef.current.has(channel)) return;

    const sequence = (coordinationSequenceRef.current[channel] ?? 0) + 1;
    const generation = `${runId}:${runGeneration ?? `${runStatus}:${endedAt ?? 0}`}`.slice(0, 160);
    const eventId = coordinationRetryEventRef.current[channel]
      ?? `${sequence}:${channel}:${crypto.randomUUID()}`.slice(0, 160);
    coordinationRetryEventRef.current[channel] = eventId;
    coordinationPendingRef.current.add(channel);
    setCoordinationPendingCount(coordinationPendingRef.current.size);
    setCoordinationDelayed(false);
    void claimAutoTrackEvent({
      version: 1,
      runId,
      channel,
      generation,
      sequence,
      eventId,
      dueAt,
      nextDueAt,
      // Home replaces this placeholder with its last adopted canonical stamp.
      baseUpdatedAt: 0,
      mutations,
    }).then((result) => {
      // A concurrent channel or peer may have advanced the shared run-value
      // stamp after this claim was queued. Treat that canonical conflict like
      // a failed claim so the catch path retries from the newly adopted values
      // instead of accepting the unchanged server value and waiting for the
      // next production interval.
      if (result.outcome === "conflict") {
        throw new Error("Automatic tracking claim conflicted with a newer value");
      }
      coordinationSequenceRef.current[channel] = Math.max(
        coordinationSequenceRef.current[channel] ?? 0,
        result.state.sequence,
      );
      const dueRef = channel === "case"
        ? caseNextDueMsRef
        : channel === "tray-consume"
          ? trayNextDueMsRef
          : channel === "tray-produce"
            ? trayProdNextDueMsRef
            : channel === "batch-consume"
              ? batchNextDueMsRef
              : channel === "batch-produce"
                ? batchProdNextDueMsRef
                : hopperProdNextDueMsRef;
      dueRef.current = result.state.nextDueAt;
      coordinationRetryEventRef.current[channel] = undefined;
      applyValues(result.values);
    }).catch(() => {
      const dueRef = channel === "case"
        ? caseNextDueMsRef
        : channel === "tray-consume"
          ? trayNextDueMsRef
          : channel === "tray-produce"
            ? trayProdNextDueMsRef
            : channel === "batch-consume"
              ? batchNextDueMsRef
              : channel === "batch-produce"
                ? batchProdNextDueMsRef
                : hopperProdNextDueMsRef;
      dueRef.current = Math.min(dueRef.current || dueAt, dueAt);
      // A failed coordinated case claim did not actually apply the mutation.
      // Re-baseline so the next tick retries the same absolute catch-up rather
      // than mistaking the unchanged form value for an external reset.
      if (channel === "case") {
        lastExpectedCasesRef.current = -1;
        formResetSkippedRef.current = false;
        caseClaimRetryRef.current = true;
      }
      setCoordinationDelayed(true);
    }).finally(() => {
      coordinationPendingRef.current.delete(channel);
      setCoordinationPendingCount(coordinationPendingRef.current.size);
    });
  }, [
    claimAutoTrackEvent,
    endedAt,
    form,
    onPackagingProgressAutoAdvance,
    runGeneration,
    runId,
    runStatus,
  ]);

  // Freeze the dough-timer countdowns and suppress tray/batch tick writes.
  // Does not affect the cases/skids counter or the global auto-track toggle.
  const pauseDoughTimers = useCallback(() => {
    doughTimerPausedRef.current = Date.now();
    setIsDoughTimerPaused(true);
  }, []);

  // Resume dough-timer countdowns through the same re-arm path as automatic
  // resume so either action starts from a full, clean interval.
  const resumeDoughTimers = useCallback(() => {
    rearmDoughTimers(Date.now());
  }, [rearmDoughTimers]);

  // Baseline resets are declared BEFORE the tick-write effect below on purpose:
  // React runs effects in declaration order, so on mount (and on runId/toggle
  // changes) the refs are reset FIRST and the write effect then fires exactly once
  // with clean baselines. With the old order (write first, resets after), the
  // mount pass wrote, the resets then wiped the bookkeeping (losing the
  // fractional tray/batch remainder carry) and re-armed the SAME tick to fire
  // again on the next second — double-decrementing trays and freezing
  // slow-depleting batches whose per-tick consumption is < 1 unit.

  // Reset bookkeeping when the run stops so the next run starts fresh. An
  // ended run KEEPS its baselines while the freezer-drain window is open (the
  // case counter is still ticking product out of the tunnel); the reset fires
  // once the drain finishes (drainActive flips false) or immediately when
  // there is no drain window at all.
  useEffect(() => {
    if (runStatus === "pending" || (runStatus === "ended" && !drainActive)) {
      resetBookkeeping();
    }
  }, [runStatus, drainActive, resetBookkeeping]);

  // Re-baseline when the active run changes (switching runs / first mount) so the
  // incremental delta is never computed against another run's numbers, and a run
  // we switch or reload into is not double-counted.
  useEffect(() => {
    const rearmAfterResumeStamp =
      resumeRearmPendingRef.current && runStatus === "running";
    resetBookkeeping();
    // A resume updates the run lifecycle stamp asynchronously. If that stamp
    // arrives after the paused → running transition already re-armed the
    // timers, do not leave the second reset with zero due refs: that would
    // replay the paused interval on the next visible clock tick.
    if (rearmAfterResumeStamp) {
      const nowMs = Date.now();
      rearmCaseTimer(nowMs);
      rearmDoughTimers(nowMs);
      resumeRearmPendingRef.current = false;
    }
  }, [runGeneration, runId, resetBookkeeping]);

  // Re-baseline when auto-track is toggled off so stale bookkeeping cannot
  // carry across a manual-edit window. On the actual Manual → Auto
  // transition, re-arm every timer from a full configured interval instead
  // of resetting due refs to zero: React runs this effect after the toggle
  // handler's state update, and a zero due ref would make the next clock
  // render write immediately. Initial auto-enabled mount keeps the normal
  // first-tick setup behavior.
  const previousAutoTrackProgressRef = useRef(autoTrackProgress);
  useEffect(() => {
    const toggledOn = !previousAutoTrackProgressRef.current && autoTrackProgress;
    previousAutoTrackProgressRef.current = autoTrackProgress;
    if (!autoTrackProgress) {
      resetBookkeeping();
      return;
    }
    if (toggledOn) {
      // `nowTime` is a display clock that can be almost one second behind the
      // user interaction. Use the actual transition instant so the minimum
      // one-second cadence cannot become immediately due on the next render.
      const nowMs = Date.now();
      rearmCaseTimer(nowMs);
      rearmDoughTimers(nowMs);
    }
  }, [autoTrackProgress, nowTime, rearmCaseTimer, rearmDoughTimers, resetBookkeeping]);

  // Pause output and ordinary production use different clocks. Baseline each
  // clock at the physical transition and always start from a full case period:
  // entering a drain must not compare its zero-based clock with the run clock,
  // and Resume must not replay paused output as an immediate catch-up.
  useEffect(() => {
    const wasPackagingDrainActive = previousPackagingDrainActiveRef.current;
    if (packagingDrainActive && !wasPackagingDrainActive) {
      lastExpectedCasesRef.current = autoTrackSuggestion?.expectedCasesRaw ?? -1;
      rearmCaseTimer(nowTime.getTime());
    } else if (wasPackagingDrainActive && !packagingDrainActive) {
      lastExpectedCasesRef.current = autoTrackSuggestion?.expectedCasesRaw ?? -1;
      rearmCaseTimer(nowTime.getTime());
    }

    previousPackagingDrainActiveRef.current = packagingDrainActive;
  }, [
    autoTrackSuggestion?.expectedCasesRaw,
    nowTime,
    packagingDrainActive,
    rearmCaseTimer,
  ]);

  // While a resumed line is filling toward Packaging, keep the ordinary clock
  // baseline current without writing. When Packaging becomes physically ready,
  // start one complete case interval from that transition.
  useEffect(() => {
    const wasActive = previousPackagingAutoTrackActiveRef.current;
    const nowMs = nowTime.getTime();
    // A phase transition caused by a normal one-second clock tick represents
    // the line physically becoming ready for packaging, so its first case
    // should start on a fresh cadence. A large jump is a screen-off/wake
    // reconciliation: the line may have crossed the phase boundary while the
    // display was asleep, and re-arming here would discard the legitimate
    // hidden-time catch-up.
    const clockJumpedWhileHidden =
      nowMs > previousPackagingClockMsRef.current + 2_000;
    const clockMovedBackward =
      nowMs + 2_000 < previousPackagingClockMsRef.current;
    if (clockMovedBackward) {
      // A wall-clock correction must not turn the later correction back into
      // production time. Keep the existing production baseline and postpone
      // the next case until the clock has caught up to the old instant.
      packagingClockRollbackUntilMsRef.current = previousPackagingClockMsRef.current;
      rearmCaseTimer(nowMs);
    } else if (
      packagingClockRollbackUntilMsRef.current !== null
      && nowMs < packagingClockRollbackUntilMsRef.current
    ) {
      rearmCaseTimer(nowMs);
    } else {
      packagingClockRollbackUntilMsRef.current = null;
      if (runStatus === "running" && !packagingAutoTrackActive) {
        if (!clockJumpedWhileHidden) {
          lastExpectedCasesRef.current = autoTrackSuggestion?.expectedCasesRaw ?? -1;
          rearmCaseTimer(nowMs);
        }
      } else if (
        runStatus === "running"
        && packagingAutoTrackActive
        && !wasActive
      ) {
        if (!clockJumpedWhileHidden) {
          lastExpectedCasesRef.current = autoTrackSuggestion?.expectedCasesRaw ?? -1;
          rearmCaseTimer(nowMs);
        }
      }
    }
    previousPackagingAutoTrackActiveRef.current = packagingAutoTrackActive;
    previousPackagingClockMsRef.current = nowMs;
  }, [
    autoTrackSuggestion?.expectedCasesRaw,
    nowTime,
    packagingAutoTrackActive,
    rearmCaseTimer,
    runStatus,
  ]);

  // Clear the independent dough-timer pause whenever the run becomes globally
  // running (covers the paused → running resume transition). Without this, a
  // dough pause set before a global run pause would stay frozen after the run
  // is globally resumed even though the line is moving again.
  useEffect(() => {
    const resumed = previousRunStatusRef.current === "paused" && runStatus === "running";
    previousRunStatusRef.current = runStatus;
    if (resumed) {
      resumeRearmPendingRef.current = true;
      // See the Manual → Auto path above: resuming against a stale display
      // clock can shorten a one-second timer to nothing.
      const nowMs = Date.now();
      rearmCaseTimer(nowMs);
      rearmDoughTimers(nowMs);
    } else if (runStatus !== "running") {
      resumeRearmPendingRef.current = false;
    }
  }, [nowTime, rearmCaseTimer, rearmDoughTimers, runStatus]);

  // This barrier is declared before the tick-write effect below. React runs
  // effects in declaration order, so releasing a successful foreground sync
  // always establishes fresh baselines before the first visible clock tick can
  // turn hidden time into a new counter write.
  const previouslyBlockedRef = useRef(autoTrackBlocked);
  const foregroundRebaseRequestedRef = useRef(false);
  const rebaseAfterForegroundSync = useCallback(() => {
    const nowMs = nowTime.getTime();
    const timing = getAutoTrackTiming(calc.ppm, v.pizzasPerCase, calc.perTray, calc.perBatch, machine);
    caseNextDueMsRef.current = timing.caseMs > 0 ? nowMs + timing.caseMs : 0;
    trayNextDueMsRef.current = timing.trayMs > 0 ? nowMs + timing.trayMs : 0;
    trayProdNextDueMsRef.current = timing.trayProductionMs > 0 ? nowMs + timing.trayProductionMs : 0;
    batchNextDueMsRef.current = timing.batchConsumptionMs > 0 ? nowMs + timing.batchConsumptionMs : 0;
    batchProdNextDueMsRef.current = timing.batchProductionMs > 0 ? nowMs + timing.batchProductionMs : 0;
    hopperProdNextDueMsRef.current = timing.hopperMs > 0 ? nowMs + timing.hopperMs : 0;
    trayLastMsRef.current = nowMs;
    batchLastMsRef.current = nowMs;
    lastExpectedCasesRef.current = autoTrackSuggestion?.expectedCasesRaw ?? -1;
    drainFreezerRef.current = Math.max(0, Math.floor(calc.casesInFreezer));
    traysRemainderRef.current = 0;
    formResetSkippedRef.current = false;
    // A non-zero value received from the shared snapshot is already staged. A
    // zero remains eligible for the hook's existing one-shot Suggest behavior.
    traySeededRef.current = (Number(form.getValues("traysOnLine")) || 0) > 0;
    batchSeededRef.current = (Number(form.getValues("batchesReady")) || 0) > 0;
  }, [
    autoTrackSuggestion?.expectedCasesRaw,
    calc.casesInFreezer,
    calc.perBatch,
    calc.perTray,
    calc.ppm,
    form,
    machine,
    nowTime,
    v.pizzasPerCase,
  ]);

  useEffect(() => {
    if (autoTrackBlocked) {
      if (autoTrackRebaseAfterBlock) {
        foregroundRebaseRequestedRef.current = true;
        resetBookkeeping();
      }
    } else if (previouslyBlockedRef.current && foregroundRebaseRequestedRef.current) {
      rebaseAfterForegroundSync();
      foregroundRebaseRequestedRef.current = false;
    }
    previouslyBlockedRef.current = autoTrackBlocked;
  }, [
    autoTrackBlocked,
    autoTrackRebaseAfterBlock,
    rebaseAfterForegroundSync,
    resetBookkeeping,
  ]);

  // Apply expected values whenever a counter's own production-paced tick is due.
  useEffect(() => {
    const caseTrackingActive =
      (runStatus === "running" && packagingAutoTrackActive)
      || drainActive
      || packagingDrainActive;
    const doughTrackingActive = runStatus === "running";
    if (
      autoTrackBlockedRef?.current
      || autoTrackBlocked
      || disabled
      || !autoTrackProgress
      || (!caseTrackingActive && !doughTrackingActive)
      || !autoTrackSuggestion
    ) return;

    const nowMs = nowTime.getTime();
    // While the manual-edit suppression window is open, keep baselines current
    // but do not write — the operator is taking over. Bookkeeping still
    // advances so the window expiring never causes a catch-up jump that wipes
    // the operator's manual edit.
    const suppressed = Date.now() < autoSuppressUntilRef.current;

    // ── Cases (and skids, derived from the same total): tick once per case. ──
    if (
      caseTrackingActive
      && calc.ppm > 0
      && v.pizzasPerCase > 0
      && nowMs >= caseNextDueMsRef.current
    ) {
      const casePeriodMs = clampPeriodMs((v.pizzasPerCase / calc.ppm) * 60000);
      const prevExpected = lastExpectedCasesRef.current;
      // Baseline the incremental delta off the UNCLAMPED total so the count keeps
      // advancing even after the time-based estimate saturates at casesNeeded (e.g.
      // the estimate ran ahead, the operator corrected the count down, then hit
      // "Resume now"). Using the clamped value here would pin the delta at 0 and
      // the count would never climb again.
      const expectedRaw = autoTrackSuggestion.expectedCasesRaw;
      const expectedCases = autoTrackSuggestion.expectedCases;
      caseNextDueMsRef.current = nowMs + casePeriodMs;
      lastExpectedCasesRef.current = expectedRaw;
      // Freeze tunnel baseline advances on EVERY case tick (even suppressed / while
      // running) so the drain delta is always measured from the latest tunnel
      // state — a suppression window expiring or the running→ended transition
      // never causes a catch-up jump.
      const prevFreezer = drainFreezerRef.current;
      drainFreezerRef.current = Math.max(0, Math.floor(calc.casesInFreezer));

      if (!suppressed) {
        const cps = v.casesPerSkid;
        const curTotal =
          (Number(form.getValues("skidsCompleted")) || 0) * cps +
          (Number(form.getValues("casesOnCurrentSkid")) || 0);
        if (drainActive || packagingDrainActive) {
          // Ended runs use the Freeze tunnel WIP drop. During a paused packaging
          // drain, tunnel WIP is intentionally frozen at pause, so use the
          // pause-relative stage clock instead. Both paths baseline first,
          // preventing reload/sync adoption from replaying old output.
          const exited = packagingDrainActive
            ? (prevExpected >= 0 ? Math.max(0, expectedRaw - prevExpected) : 0)
            : (prevFreezer >= 0
              ? Math.max(0, prevFreezer - drainFreezerRef.current)
              : 0);
          if (exited > 0) {
            const target = curTotal + exited;
            const newTotal = v.casesNeeded > 0 ? Math.min(target, Math.max(curTotal, v.casesNeeded)) : target;
            if (newTotal !== curTotal) {
              const nextSkids = Math.floor(newTotal / cps);
              const nextCases = Math.round(newTotal % cps);
              commitAutomatic("case", nowMs, caseNextDueMsRef.current, [
                { field: "skidsCompleted", from: Number(form.getValues("skidsCompleted")) || 0, to: nextSkids },
                { field: "casesOnCurrentSkid", from: Number(form.getValues("casesOnCurrentSkid")) || 0, to: nextCases },
              ]);
            }
          }
        } else if (prevExpected < 0) {
          // First tick after a (re)start/switch: seed the absolute count only when
          // there is no progress yet. If progress already exists (reload / switching
          // into a run that's already going / a prior manual entry), just baseline so
          // we don't double-count.
          if ((curTotal === 0 || caseClaimRetryRef.current) && expectedCases > curTotal) {
            const seedTotal = v.casesNeeded > 0 ? Math.min(v.casesNeeded, expectedCases) : expectedCases;
            const nextSkids = Math.floor(seedTotal / cps);
            const nextCases = Math.round(seedTotal % cps);
            caseClaimRetryRef.current = false;
            commitAutomatic("case", nowMs, caseNextDueMsRef.current, [
              { field: "skidsCompleted", from: Number(form.getValues("skidsCompleted")) || 0, to: nextSkids },
              { field: "casesOnCurrentSkid", from: Number(form.getValues("casesOnCurrentSkid")) || 0, to: nextCases },
            ]);
          }
        } else {
          // Add the production since the last tick on top of the current value, so a
          // manual correction is preserved and tracking continues forward from it.
          // Floor to a whole number — cases are discrete; a fractional delta
          // (e.g. 0.1666 when ppm/pizzasPerCase doesn't divide evenly into the
          // tick interval) would store a float into casesOnCurrentSkid via the
          // modulo below and corrupt every subsequent curTotal read.
          const deltaCases = Math.floor(Math.max(0, expectedRaw - prevExpected));
          if (deltaCases > 0) {
            // Stale-delta catch-up guard: if the form shows 0 cases but
            // prevExpected is positive, the form was reset (SSE echo, run
            // switch, or operator correction to 0) while the expected-cases
            // baseline was still ahead. Applying the full accumulated delta
            // on top of 0 would write a wrong low count (e.g. 54 when the
            // real count is 524). Skip this one tick — lastExpectedCasesRef
            // was already updated above to expectedRaw, so the NEXT tick has
            // a fresh baseline and writes ≈ 1 case (normal increment). Set
            // formResetSkippedRef so the very next tick always proceeds even
            // if curTotal is still 0 (operator-corrected-to-0 resumes).
            if (!formResetSkippedRef.current && curTotal === 0 && prevExpected > cps) {
              formResetSkippedRef.current = true;
            } else {
              formResetSkippedRef.current = false;
              const target = curTotal + deltaCases;
              // Never pull a value down below what the operator already has on the floor.
              const newTotal = v.casesNeeded > 0 ? Math.min(target, Math.max(curTotal, v.casesNeeded)) : target;
              if (newTotal !== curTotal) {
                const nextSkids = Math.floor(newTotal / cps);
                const nextCases = Math.round(newTotal % cps);
                commitAutomatic("case", nowMs, caseNextDueMsRef.current, [
                  { field: "skidsCompleted", from: Number(form.getValues("skidsCompleted")) || 0, to: nextSkids },
                  { field: "casesOnCurrentSkid", from: Number(form.getValues("casesOnCurrentSkid")) || 0, to: nextCases },
                ]);
              }
            }
          } else {
            formResetSkippedRef.current = false;
          }
        }
      }
    }

    // Trays / batches: incremental decrement, each at its own cadence.
    // Works after page reloads and naturally handles mid-run replenishments.
    // Stop once the press has made everything the run needs — COUNT-based
    // (cased product + live Freeze tunnel contents ≥ casesNeeded, via calc.pressDone),
    // not an elapsed-time estimate. When the line runs slower or faster than
    // the configured speed, the real counts are what decide when dough stops
    // moving for this run; from that moment the dough crew is on the NEXT run.
    //
    // The independent dough-timer pause (staff pressed ⏸ on the Batch Pipeline
    // card) suppresses all tray/batch tick WRITES without touching cases/skids.
    const doughFeedComplete = calc.pressDone;

    // ── Hopper cycle display tick — purely for the countdown in the UI;
    // arms once and cycles every hopperSec so the display can restart from
    // full duration when dough timers are resumed. Runs BEFORE the pause
    // guard so the ref stays armed while dough timers are paused (the UI
    // shows "—:—" + "timers paused" anyway), and resets to 0 on resume so
    // the next tick re-arms from the current moment (full duration restart).
    if (runStatus === "running" && machine && machine.hopperSec > 0) {
      const hopperMs = getAutoTrackTiming(calc.ppm, v.pizzasPerCase, calc.perTray, calc.perBatch, machine).hopperMs;
      if (hopperProdNextDueMsRef.current === 0) {
        hopperProdNextDueMsRef.current = nowMs + hopperMs;
      } else if (nowMs >= hopperProdNextDueMsRef.current) {
        hopperProdNextDueMsRef.current = nowMs + hopperMs;
        commitAutomatic("hopper", nowMs, hopperProdNextDueMsRef.current, []);
      }
    }

    if (doughTimerPausedRef.current > 0) return;

    // ── Trays: count up while dough is still being pressed, down as the line
    // eats it. Production (+1 tray per tray-period, offset half a period from
    // consumption so the two visibly alternate) continues while the run still
    // has a dough DEFICIT (calc.traysNeeded > 0) OR while there are ready
    // batches still to be converted into trays (v.batchesReady > 0). The dough
    // crew keeps pulling trays from ready batches until every batch is
    // exhausted, so the counter keeps fluctuating until both conditions reach
    // zero. Once the deficit is closed AND no ready batches remain the press is
    // done and the counter only counts down; whatever is left at the end
    // carries over to the next run. Dough tracking NEVER runs for an ended run
    // (drain phase is case/skid-only — the dough crew is on the next run). ──
    // Tracks how many trays were auto-seeded this tick so the batch seed
    // below can subtract the tray coverage from its own seed amount — trays
    // and batches are additive in dough-on-hand, so seeding both at the
    // full deficit would double-count the supply (only the remaining deficit
    // after tray coverage gets seeded into batches).
    let traysSeededAmount = 0;

    if (runStatus === "running" && calc.perTray > 0 && calc.ppm > 0) {
      const timing = getAutoTrackTiming(calc.ppm, v.pizzasPerCase, calc.perTray, calc.perBatch, machine);
      const trayPeriodMs = timing.trayMs;
      let delta = 0;
      let traySeededThisTick = false;

      // Production tick.
      if (trayProdNextDueMsRef.current === 0) {
        // First encounter: arm the schedule half a period out of phase with
        // consumption; no write.
        trayProdNextDueMsRef.current = nowMs + trayPeriodMs / 2;
      } else if (nowMs >= trayProdNextDueMsRef.current) {
        trayProdNextDueMsRef.current = nowMs + trayPeriodMs;
        if (!suppressed && !doughFeedComplete && (calc.traysNeeded > 0 || v.batchesReady > 0)) {
          delta += 1;
        }
      }

      // Consumption tick.
      if (nowMs >= trayNextDueMsRef.current) {
        const prevMs = trayLastMsRef.current;
        // Consumption for the actual duration since this counter's last tick
        // (capped to 2 periods to avoid huge jumps); assume one full period on
        // the first tick.
        const durationMin = prevMs > 0
          ? Math.min((trayPeriodMs * 2) / 60000, (nowMs - prevMs) / 60000)
          : trayPeriodMs / 60000;
        trayNextDueMsRef.current = nowMs + trayPeriodMs;
        trayLastMsRef.current = nowMs;
        if (!suppressed && !doughFeedComplete) {
          // First tray tick of a run where the operator never entered staged
          // dough (counter still 0): seed the suggested staging (the same number
          // the "Suggest" button applies) so the counter has real stock to track
          // — otherwise a crew that never types their dough counts sees trays
          // sit at 0 the whole run. One-shot per run; a counter with a value
          // (manual or seeded) just tracks normally below.
          if (!traySeededRef.current) {
            traySeededRef.current = true;
            const seed = suggestedDoughStaging(calc.traysNeeded, calc.batchesNeeded).trays;
            if (v.traysOnLine === 0 && seed !== null) {
              commitAutomatic("tray-consume", nowMs, trayNextDueMsRef.current, [
                { field: "traysOnLine", from: Number(form.getValues("traysOnLine")) || 0, to: seed },
              ]);
              traySeededThisTick = true;
              traysSeededAmount = seed;
            }
          }
          if (!traySeededThisTick) {
            const traysExact = (durationMin * calc.ppm) / calc.perTray + traysRemainderRef.current;
            const traysConsumed = Math.floor(traysExact);
            traysRemainderRef.current = traysExact - traysConsumed;
            delta -= traysConsumed;
          }
        }
      }

      if (!traySeededThisTick && delta !== 0) {
        // traysOnLine is the aggregate across all physical tray sections.
        // Section capacity is advisory in the UI, so production must not stop
        // or rewrite this count at an arbitrary display threshold.
        const next = Math.max(0, v.traysOnLine + delta);
        if (next !== v.traysOnLine) {
          commitAutomatic(delta > 0 ? "tray-produce" : "tray-consume", nowMs, delta > 0
            ? trayProdNextDueMsRef.current
            : trayNextDueMsRef.current, [
            { field: "traysOnLine", from: Number(form.getValues("traysOnLine")) || 0, to: next },
          ]);
        }
      }
    }

    // ── Batches: +1 when the mixer finishes a batch (one per full batch-time,
    // while the run still has a batch deficit), down once per full batch
    // consumed (quarter-batch ticks with fractional remainder carry).
    // Never for an ended run — drain phase is case/skid-only. ──
    if (runStatus === "running" && calc.perBatch > 0 && calc.ppm > 0) {
      const timing = getAutoTrackTiming(calc.ppm, v.pizzasPerCase, calc.perTray, calc.perBatch, machine);
      const batchPeriodMs = timing.batchConsumptionMs;
      const fullBatchMs = timing.batchProductionMs;
      const effDrainMs = Math.max(
        machine && machine.hopperSec > 0 ? machine.hopperSec * 1000 : 0,
        (calc.perBatch / calc.ppm) * 60000,
      );
      let delta = 0;
      let batchSeededThisTick = false;

      // Production tick: the first mixed batch lands one full batch-time in.
      if (batchProdNextDueMsRef.current === 0) {
        batchProdNextDueMsRef.current = nowMs + fullBatchMs;
      } else if (nowMs >= batchProdNextDueMsRef.current) {
        batchProdNextDueMsRef.current = nowMs + fullBatchMs;
        if (!suppressed && !doughFeedComplete && calc.batchesNeeded > 0) {
          delta += 1;
        }
      }

      // Consumption tick.
      if (nowMs >= batchNextDueMsRef.current) {
        const prevMs = batchLastMsRef.current;
        const durationMin = prevMs > 0
          ? Math.min((batchPeriodMs * 2) / 60000, (nowMs - prevMs) / 60000)
          : batchPeriodMs / 60000;
        batchNextDueMsRef.current = nowMs + batchPeriodMs;
        batchLastMsRef.current = nowMs;
        if (!suppressed && !doughFeedComplete) {
          // Same one-shot seed as trays: an untouched 0 counter gets the
          // suggested staging on its first tick so it has stock to track.
          if (!batchSeededRef.current) {
            batchSeededRef.current = true;
            // If trays were auto-seeded this same tick, only seed the remaining
            // deficit not already covered by those trays — seeding both at the
            // full deficit would double-count dough-on-hand.
            const remainingBatchesNeeded = traysSeededAmount > 0 && calc.traysNeeded > 0
              ? Math.max(0, calc.batchesNeeded * (calc.traysNeeded - traysSeededAmount) / calc.traysNeeded)
              : calc.batchesNeeded;
            const seed = remainingBatchesNeeded > 0
              ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, remainingBatchesNeeded))))
              : null;
            if (v.batchesReady === 0 && seed !== null) {
              commitAutomatic("batch-consume", nowMs, batchNextDueMsRef.current, [
                { field: "batchesReady", from: Number(form.getValues("batchesReady")) || 0, to: seed },
              ]);
              batchSeededThisTick = true;
            }
          }
          if (!batchSeededThisTick) {
            // Fractional consumption, written directly (2 decimals) so the
            // operator SEES the counter fluctuate every quarter-batch tick
            // instead of thinking it's frozen until a whole batch drops.
            // Rate = 1 batch per effective-drain period (line demand, slowed
            // by the hopper when a hopper time has been measured).
            delta -= (durationMin * 60000) / effDrainMs;
          }
        }
      }

      if (!batchSeededThisTick && delta !== 0) {
        // Production never pushes past the stepper max (3) — but must never
        // clamp an already-higher value DOWN either. Rounded to 2 decimals so
        // the fractional drain shows cleanly (e.g. 1.75, 1.5).
        let next = v.batchesReady + delta;
        if (delta > 0) next = Math.min(next, Math.max(v.batchesReady, 3));
        next = Math.max(0, Math.round(next * 100) / 100);
        if (next !== v.batchesReady) {
          commitAutomatic(delta > 0 ? "batch-produce" : "batch-consume", nowMs, delta > 0
            ? batchProdNextDueMsRef.current
            : batchNextDueMsRef.current, [
            { field: "batchesReady", from: Number(form.getValues("batchesReady")) || 0, to: next },
          ]);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrackBlocked, autoTrackBlockedRef, coordinationDelayed, nowTime]);

  return {
    autoTrackProgress,
    setAutoTrackProgress,
    autoTrackSuggestion,
    autoSuppressUntilRef,
    fireAutoTrackNow,
    tickDueRefs: tickDueRefsRef.current,
    isDoughTimerPaused,
    pauseDoughTimers,
    resumeDoughTimers,
    coordinationStatus: coordinationDelayed
      ? "delayed"
      : coordinationPendingCount > 0
        ? "waiting"
        : "ready",
  };
}
