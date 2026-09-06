import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { type FormValues } from "../types";
import { AUTO_TRACK_COORDINATION_EVENT } from "../autoTrackCoordinationClient";
import {
  buildAppSlotClaimMutations,
  buildCaseClaimMutations,
  buildSauceClaimMutations,
  clampWebPeriodMs,
  computeAppSlotInfo,
  computeAutoTrackSuggestion,
  computeBatchTick,
  computeCaseTickWrite,
  computeNetSecondDue,
  computeTrayTick,
  getAutoTrackTiming,
  suggestedDoughStaging,
  type SuggestedDoughStagingReturn,
} from "@workspace/live-calc";

type RunStatus = "pending" | "running" | "paused" | "ended";

// Server schedule-verdict freshness window (Task 1 / step 7a). Server
// schedules arrive on the SSE heartbeat every 15s (step 6c); the server also
// executes net-second claims itself (step 7a). While a channel's verdict is
// fresh AND `dueNow:false`, the client skips its redundant local elapsed claim
// (fewer renders/requests); after this window (3 heartbeat cadences) or with
// no schedule at all, the local elapsed fallback resumes for offline devices.
const SERVER_SCHEDULE_TTL_MS = 45_000;

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
  /** Seconds per sauce barrel; 0/invalid disables the sauce channel. */
  sauceDepletionSec?: number;
  app1Batches?: number;
  app2Batches?: number;
  app3Batches?: number;
  app4Batches?: number;
}

// Re-exported from @workspace/live-calc so existing consumers (home.tsx,
// LiveRunContext.tsx, __mocks__/useAutoTrack.ts) keep importing from here.
export type { SuggestedDoughStagingReturn } from "@workspace/live-calc";
export { suggestedDoughStaging } from "@workspace/live-calc";

interface AutoTrackValues {
  casesPerSkid: number;
  pizzasPerCase: number;
  casesNeeded: number;
  freezerTime: number;
  traysOnLine: number;
  batchesReady: number;
  sauceBarrelsMade: number;
  sauceBarrelAnchorNetSec: number;
  sauceBarrelCorrectionGeneration: number;
  app1Type: string; app1OzPerPizza: number; app1BatchLbs: number; app1CheeseRecipe: Array<{ lbs: number }>;
  app1BatchesMade: number; app1BatchAnchorNetSec: number; app1BatchCorrectionGeneration: number;
  app2Type: string; app2OzPerPizza: number; app2BatchLbs: number; app2CheeseRecipe: Array<{ lbs: number }>;
  app2BatchesMade: number; app2BatchAnchorNetSec: number; app2BatchCorrectionGeneration: number;
  app3Type: string; app3OzPerPizza: number; app3BatchLbs: number; app3CheeseRecipe: Array<{ lbs: number }>;
  app3BatchesMade: number; app3BatchAnchorNetSec: number; app3BatchCorrectionGeneration: number;
  app4Type: string; app4OzPerPizza: number; app4BatchLbs: number; app4CheeseRecipe: Array<{ lbs: number }>;
  app4BatchesMade: number; app4BatchAnchorNetSec: number; app4BatchCorrectionGeneration: number;
}

export type AutoTrackChannel =
  | "case"
  | "tray-consume"
  | "tray-produce"
  | "batch-consume"
  | "batch-produce"
  | "hopper"
  | "sauce-barrel"
  | "app1-batch"
  | "app2-batch"
  | "app3-batch"
  | "app4-batch";

export type AutoTrackMutation = {
  field: "skidsCompleted" | "casesOnCurrentSkid" | "traysOnLine" | "batchesReady"
    | "sauceBarrelsMade" | "sauceBarrelAnchorNetSec" | "sauceBarrelCorrectionGeneration"
    | "app1BatchesMade" | "app1BatchAnchorNetSec" | "app1BatchCorrectionGeneration"
    | "app2BatchesMade" | "app2BatchAnchorNetSec" | "app2BatchCorrectionGeneration"
    | "app3BatchesMade" | "app3BatchAnchorNetSec" | "app3BatchCorrectionGeneration"
    | "app4BatchesMade" | "app4BatchAnchorNetSec" | "app4BatchCorrectionGeneration";
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
   * Manual-edit suppression for the dough pipeline. This is intentionally
   * separate from the packaging ref so a dough correction never pauses
   * case/skid tracking.
   */
  externalDoughAutoSuppressRef?: React.MutableRefObject<number>;
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
  /** Stop sauce completion once dough hands off to the next unstarted run. */
  nextRunPrepActive?: boolean;
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
  doughAutoSuppressUntilRef: React.MutableRefObject<number>;
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
  pauseDoughTimers: (durationMs?: number) => void;
  /** Restart dough countdowns from full duration and clear the paused state. */
  resumeDoughTimers: () => void;
  /** Server event acknowledgement state for accessible status messaging. */
  coordinationStatus: "ready" | "waiting" | "delayed";
}

/** Exported return type — shared with __mocks__/useAutoTrack.ts for compile-time drift detection. */
export type UseAutoTrackReturn = AutoTrackResult;

// Re-exported from @workspace/live-calc so countdown/display consumers
// (home.tsx, LiveRunContext.tsx) keep importing from here.
export type { AutoTrackTiming } from "@workspace/live-calc";
export { getAutoTrackTiming } from "@workspace/live-calc";

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
  externalDoughAutoSuppressRef,
  onPackagingProgressAutoAdvance,
  autoTrackBlocked = false,
  autoTrackBlockedRef,
  // Preserve the established behavior for callers that only provide the
  // original boolean barrier. Home opts out explicitly for unchanged pulls.
  autoTrackRebaseAfterBlock = true,
  claimAutoTrackEvent,
  nextRunPrepActive = false,
}: AutoTrackParams): AutoTrackResult {
  const [autoTrackProgress, setAutoTrackProgress] = useState(true);
  // Latest client-clock mirror so event handlers (SSE adopts) and effects can
  // read "now" without capturing a stale prop in a stale closure or re-running
  // on every clock tick. Updated during render, like coordinationIdentityRef.
  const nowTimeRef = useRef(nowTime.getTime());
  nowTimeRef.current = nowTime.getTime();
  // Independent dough-timer pause: non-zero = wall-clock ms when paused.
  // When set, tray/batch production and consumption ticks are suppressed
  // without affecting cases/skids or the global auto-track toggle.
  const doughTimerPausedRef = useRef<number>(0);
  // Non-zero only for a timed correction pause. A manual pause leaves this at
  // zero and waits for the operator's explicit Resume timers action.
  const doughTimerResumeAtRef = useRef<number>(0);
  const [isDoughTimerPaused, setIsDoughTimerPaused] = useState(false);
  const internalAutoSuppressRef = useRef<number>(0);
  const internalDoughAutoSuppressRef = useRef<number>(0);
  // Prefer caller's ref so that suppression latches written by UI consumers
  // (e.g. Home's autoSuppressUntilRef) are seen by this hook's write loop.
  const autoSuppressUntilRef = externalAutoSuppressRef ?? internalAutoSuppressRef;
  const doughAutoSuppressUntilRef =
    externalDoughAutoSuppressRef ?? internalDoughAutoSuppressRef;
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
  // Server auto-track schedule verdicts (Step 6b): one-shot per fresh SSE/claim
  // schedule — true means the server says this net-second channel's claim is
  // due RIGHT NOW. The sauce/applicator effects fire on it immediately and
  // clear it; the local elapsed check remains the fallback (offline / no
  // schedule yet). Wall-clock channels are NOT verdict-driven (the server only
  // echoes their canonical due refs).
  const serverDueNowRef = useRef<Partial<Record<AutoTrackChannel, boolean>>>({});
  // Server schedule-verdict freshness latch (Task 1 / step 7a). Each adopt of
  // a per-channel entry stamps the client clock. Because the server NOW owns
  // net-second claim execution (it runs the same unref'd tick loop whether or
  // not any device is open), a FRESH verdict of `dueNow:false` means the server
  // has already decided not to claim at this net-second — a redundant local
  // elapsed-armed claim here would double-write the same barrel/batch and lose
  // the row-lock race (or duplicate splat on an idle peer). We therefore skip
  // the local net-second check while the latch is fresh AND the verdict is
  // `false`. The latch expires after SERVER_SCHEDULE_TTL_MS (3 heartbeat
  // cadences, ~45s) so a server that stalls or goes silent (offline) degrades
  // back to the local elapsed fallback instead of leaving the run untracked.
  // A fresh `true` still fires immediately through the existing one-shot
  // serverVerdictDue path. Explicit `false` is required — an absent verdict +
  // fresh schedule (wall-clock channels) must NOT suppress the local fallback.
  const serverScheduleAtMsRef = useRef<Partial<Record<AutoTrackChannel, number>>>({});
  const coordinationPendingRef = useRef<Set<AutoTrackChannel>>(new Set());
  // Claims for different channels can become due in the same render. Keep
  // them FIFO so the later claim is built from the first acknowledgement's
  // form values instead of racing the shared run-value stamp.
  const coordinationClaimQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [coordinationPendingCount, setCoordinationPendingCount] = useState(0);
  const [coordinationDelayed, setCoordinationDelayed] = useState(false);
  // Net-elapsed seconds (not a wall-clock display due time) for sauce claims.
  const sauceNextDueNetSecRef = useRef(0);
  const appNextDueNetSecRefs = {
    app1: useRef(0),
    app2: useRef(0),
    app3: useRef(0),
    app4: useRef(0),
  };
  const coordinationIdentity =
    `${runId}:${runGeneration ?? `${runStatus}:${endedAt ?? 0}`}`.slice(0, 160);
  const coordinationIdentityRef = useRef(coordinationIdentity);
  coordinationIdentityRef.current = coordinationIdentity;
  const dueRefForChannel = (channel: AutoTrackChannel) => {
    if (channel === "case") return caseNextDueMsRef;
    if (channel === "tray-consume") return trayNextDueMsRef;
    if (channel === "tray-produce") return trayProdNextDueMsRef;
    if (channel === "batch-consume") return batchNextDueMsRef;
    if (channel === "batch-produce") return batchProdNextDueMsRef;
    if (channel === "sauce-barrel") return sauceNextDueNetSecRef;
    if (channel === "app1-batch") return appNextDueNetSecRefs.app1;
    if (channel === "app2-batch") return appNextDueNetSecRefs.app2;
    if (channel === "app3-batch") return appNextDueNetSecRefs.app3;
    if (channel === "app4-batch") return appNextDueNetSecRefs.app4;
    return hopperProdNextDueMsRef;
  };

  useEffect(() => {
    const adopt = (event: Event) => {
      const coordination = (event as CustomEvent<{
        runs?: Record<string, Partial<Record<AutoTrackChannel, {
          generation: string;
          sequence: number;
          nextDueAt: number;
          dueNow?: boolean;
        }>>>;
      }>).detail;
      const channels = coordination?.runs?.[runId];
      if (!channels) return;
      for (const [channel, state] of Object.entries(channels) as Array<[
        AutoTrackChannel,
        { generation: string; sequence: number; nextDueAt: number; dueNow?: boolean },
      ]>) {
        const generation = `${runId}:${runGeneration ?? `${runStatus}:${endedAt ?? 0}`}`.slice(0, 160);
        if (state.generation !== generation) {
          coordinationSequenceRef.current[channel] = 0;
          const dueRef = dueRefForChannel(channel);
          dueRef.current = state.nextDueAt;
          // A generation mismatch means the verdict belongs to a different run
          // identity — never let it fire claims against this run, and do NOT
          // stamp the freshness latch (a stale-identity schedule must not
          // suppress this run's local fallback).
          serverDueNowRef.current[channel] = false;
          continue;
        }
        coordinationSequenceRef.current[channel] = Math.max(
          coordinationSequenceRef.current[channel] ?? 0,
          state.sequence,
        );
        serverDueNowRef.current[channel] = state.dueNow === true;
        serverScheduleAtMsRef.current[channel] = nowTimeRef.current;
        const dueRef = dueRefForChannel(channel);
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

  const autoTrackSuggestion = useMemo(() => computeAutoTrackSuggestion({
    runStatus,
    drainActive,
    packagingDrainActive,
    packagingDrainElapsedSec,
    ppm: calc.ppm,
    casesPerSkid: v.casesPerSkid,
    pizzasPerCase: v.pizzasPerCase,
    casesNeeded: v.casesNeeded,
    freezerTime: v.freezerTime,
    elapsedBatchSec,
  }), [
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
    serverDueNowRef.current = {};
    serverScheduleAtMsRef.current = {};
    sauceNextDueNetSecRef.current = 0;
    appNextDueNetSecRefs.app1.current = 0;
    appNextDueNetSecRefs.app2.current = 0;
    appNextDueNetSecRefs.app3.current = 0;
    appNextDueNetSecRefs.app4.current = 0;
    setCoordinationPendingCount(0);
    setCoordinationDelayed(false);
    // Clear dough-timer pause on run change / stop so it never bleeds across runs.
    doughTimerPausedRef.current = 0;
    doughTimerResumeAtRef.current = 0;
    doughAutoSuppressUntilRef.current = 0;
    setIsDoughTimerPaused(false);
  }, [doughAutoSuppressUntilRef]);

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
    doughTimerResumeAtRef.current = 0;
    doughAutoSuppressUntilRef.current = 0;
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
      if (typeof values.sauceBarrelsMade === "number") {
        form.setValue("sauceBarrelsMade", values.sauceBarrelsMade, { shouldDirty: true });
      }
      if (typeof values.sauceBarrelAnchorNetSec === "number") {
        form.setValue("sauceBarrelAnchorNetSec", values.sauceBarrelAnchorNetSec, { shouldDirty: true });
      }
      if (typeof values.sauceBarrelCorrectionGeneration === "number") {
        form.setValue("sauceBarrelCorrectionGeneration", values.sauceBarrelCorrectionGeneration, { shouldDirty: true });
      }
      (["app1", "app2", "app3", "app4"] as const).forEach((slot) => {
        const made = values[`${slot}BatchesMade` as keyof FormValues];
        const anchor = values[`${slot}BatchAnchorNetSec` as keyof FormValues];
        const generation = values[`${slot}BatchCorrectionGeneration` as keyof FormValues];
        if (typeof made === "number") form.setValue(`${slot}BatchesMade` as keyof FormValues, made as never, { shouldDirty: true });
        if (typeof anchor === "number") form.setValue(`${slot}BatchAnchorNetSec` as keyof FormValues, anchor as never, { shouldDirty: true });
        if (typeof generation === "number") form.setValue(`${slot}BatchCorrectionGeneration` as keyof FormValues, generation as never, { shouldDirty: true });
      });
    };
    const localValues = Object.fromEntries(mutations.map((mutation) => [mutation.field, mutation.to])) as Partial<FormValues>;
    if (!claimAutoTrackEvent) {
      applyValues(localValues);
      return;
    }
    if (coordinationPendingRef.current.has(channel)) return;

    const claimIdentity = coordinationIdentity;
    const correctionMutation = mutations.find((mutation) =>
      mutation.field === "sauceBarrelCorrectionGeneration" || mutation.field.endsWith("BatchCorrectionGeneration"),
    );
    coordinationPendingRef.current.add(channel);
    setCoordinationPendingCount(coordinationPendingRef.current.size);
    const queuedClaim = coordinationClaimQueueRef.current
      .catch(() => {})
      .then(async () => {
        // A new run may have been selected while this claim waited behind an
        // older channel. resetBookkeeping() clears the old pending marker; do
        // not send the stale queued event into the new run.
        if (coordinationIdentityRef.current !== claimIdentity) return;

        const sequence = (coordinationSequenceRef.current[channel] ?? 0) + 1;
        const generation = claimIdentity;
        const eventId = coordinationRetryEventRef.current[channel]
          ?? `${sequence}:${channel}:${crypto.randomUUID()}`.slice(0, 160);
        // Rebase simple counter mutations at send time. A same-tick tray
        // acknowledgement can update the form before the queued batch claim
        // starts; sending the original `from` would make that second claim
        // stale even though it touches a different dough counter.
        const claimMutations = correctionMutation
          ? mutations
          : mutations.map((mutation) => {
              const from = Number(form.getValues(mutation.field as keyof FormValues)) || 0;
              const delta = mutation.to - mutation.from;
              return {
                ...mutation,
                from,
                to: Math.max(0, Math.round((from + delta) * 100) / 100),
              };
            });
        const correctionGeneration = correctionMutation?.from;
        coordinationRetryEventRef.current[channel] = eventId;
        setCoordinationDelayed(false);
        try {
          const result = await claimAutoTrackEvent({
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
            correctionGeneration,
            mutations: claimMutations,
          });
          // The hook shares one form across selected runs. A response from the
          // previously selected run must not write into the new run or advance
          // its coordination bookkeeping.
          if (coordinationIdentityRef.current !== claimIdentity) return;
          // A manual correction can happen while this request is in flight. Its
          // incremented generation is the local authority until that snapshot
          // reaches the server, so never let the older acknowledgement restore
          // the pre-correction made count or net-time anchor.
          if (
            correctionMutation
            && Number(form.getValues(correctionMutation.field as keyof FormValues)) !== correctionMutation.from
          ) {
            coordinationRetryEventRef.current[channel] = undefined;
            return;
          }
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
          const dueRef = dueRefForChannel(channel);
          dueRef.current = result.state.nextDueAt;
          coordinationRetryEventRef.current[channel] = undefined;
          applyValues(result.values);
        } catch {
          if (coordinationIdentityRef.current !== claimIdentity) return;
          const dueRef = dueRefForChannel(channel);
          dueRef.current = Math.min(dueRef.current || dueAt, dueAt);
          // A failed coordinated case claim did not actually apply the mutation.
          // Re-baseline so the next tick retries the same absolute catch-up
          // rather than mistaking the unchanged form value for an external reset.
          if (channel === "case") {
            lastExpectedCasesRef.current = -1;
            formResetSkippedRef.current = false;
            caseClaimRetryRef.current = true;
          }
          setCoordinationDelayed(true);
        } finally {
          // A new run may already have an in-flight claim on this same channel.
          // Only the owner that inserted the pending marker may remove it.
          if (coordinationIdentityRef.current !== claimIdentity) return;
          coordinationPendingRef.current.delete(channel);
          setCoordinationPendingCount(coordinationPendingRef.current.size);
        }
      });
    coordinationClaimQueueRef.current = queuedClaim.then(() => {}, () => {});
  }, [
    claimAutoTrackEvent,
    coordinationIdentity,
    endedAt,
    form,
    onPackagingProgressAutoAdvance,
    runGeneration,
    runId,
    runStatus,
  ]);

  // Freeze the dough-timer countdowns and suppress tray/batch tick writes.
  // Does not affect the cases/skids counter or the global auto-track toggle.
  const pauseDoughTimers = useCallback((durationMs?: number) => {
    const nowMs = Date.now();
    doughTimerPausedRef.current = nowMs;
    doughTimerResumeAtRef.current =
      typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
        ? nowMs + durationMs
        : 0;
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

  // A speed adjustment changes every line-demand cadence. Re-arm active
  // countdowns from the edit instant so an old due timestamp cannot make the
  // next tick fire at the previous speed. The initial ref baseline preserves
  // the established first-tick behavior on mount.
  const timingBasisRef = useRef({
    ppm: calc.ppm,
    pizzasPerCase: v.pizzasPerCase,
    perTray: calc.perTray,
    perBatch: calc.perBatch,
    spinSec: machine?.spinSec ?? 0,
    hopperSec: machine?.hopperSec ?? 0,
  });
  useEffect(() => {
    const nextBasis = {
      ppm: calc.ppm,
      pizzasPerCase: v.pizzasPerCase,
      perTray: calc.perTray,
      perBatch: calc.perBatch,
      spinSec: machine?.spinSec ?? 0,
      hopperSec: machine?.hopperSec ?? 0,
    };
    const previous = timingBasisRef.current;
    const changed =
      previous.ppm !== nextBasis.ppm
      || previous.pizzasPerCase !== nextBasis.pizzasPerCase
      || previous.perTray !== nextBasis.perTray
      || previous.perBatch !== nextBasis.perBatch
      || previous.spinSec !== nextBasis.spinSec
      || previous.hopperSec !== nextBasis.hopperSec;
    timingBasisRef.current = nextBasis;
    if (changed && runStatus === "running") {
      const nowMs = Date.now();
      rearmCaseTimer(nowMs);
      rearmDoughTimers(nowMs);
    }
  }, [
    calc.perBatch,
    calc.perTray,
    calc.ppm,
    machine?.hopperSec,
    machine?.spinSec,
    rearmCaseTimer,
    rearmDoughTimers,
    runStatus,
    v.pizzasPerCase,
  ]);

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

  const previousSauceCorrectionGenerationRef = useRef(v.sauceBarrelCorrectionGeneration);
  useEffect(() => {
    const cadence = Number(calc.sauceDepletionSec) || 0;
    const anchor = Math.max(0, Number(v.sauceBarrelAnchorNetSec) || 0);
    sauceNextDueNetSecRef.current =
      Number.isFinite(cadence) && cadence > 0 ? anchor + cadence : 0;
    if (previousSauceCorrectionGenerationRef.current !== v.sauceBarrelCorrectionGeneration) {
      // Manual corrections invalidate the server channel generation. Restart
      // its sequence and discard any failed pre-correction event identity.
      coordinationSequenceRef.current["sauce-barrel"] = 0;
      coordinationRetryEventRef.current["sauce-barrel"] = undefined;
      previousSauceCorrectionGenerationRef.current = v.sauceBarrelCorrectionGeneration;
    }
  }, [
    calc.sauceDepletionSec,
    v.sauceBarrelAnchorNetSec,
    v.sauceBarrelCorrectionGeneration,
  ]);

  // Sauce uses the same sequenced claim protocol as every other automatic
  // counter. Its due values are net-run seconds, so pauses consume no sauce.
  // A claim is exactly one barrel; successful form adoption triggers the next
  // overdue identity rather than folding a screen-off gap into one mutation.
  useEffect(() => {
    if (
      !claimAutoTrackEvent ||
      disabled ||
      autoTrackBlocked ||
      autoTrackBlockedRef?.current ||
      !autoTrackProgress ||
      runStatus !== "running" ||
      calc.pressDone ||
      nextRunPrepActive
    ) return;
    const cadence = Number(calc.sauceDepletionSec) || 0;
    if (!Number.isFinite(cadence) || cadence <= 0 || !Number.isFinite(elapsedBatchSec)) return;
    const anchor = Math.max(0, Number(v.sauceBarrelAnchorNetSec) || 0);
    const dueAtNetSec = computeNetSecondDue({
      currentDue: sauceNextDueNetSecRef.current,
      anchor,
      cadence,
    });
    // Step 6b/7a: the server's due-now verdict (fresh schedule) fires the claim
    // immediately; the local elapsed check is the fallback for devices without
    // a live schedule (offline) or once the verdict latch goes stale. Task 1:
    // while a FRESH verdict says explicitly NOT due, the server owns the next
    // claim (it executes the same claim in its tick loop) — skip the local
    // net-second check so a connected tab stops re-firing redundant claims.
    const serverVerdictDue = serverDueNowRef.current["sauce-barrel"] === true;
    const serverOwnsNextClaim =
      serverDueNowRef.current["sauce-barrel"] === false &&
      nowTimeRef.current - (serverScheduleAtMsRef.current["sauce-barrel"] ?? 0) <= SERVER_SCHEDULE_TTL_MS;
    if (serverOwnsNextClaim) return;
    if (!serverVerdictDue && elapsedBatchSec < dueAtNetSec) return;
    serverDueNowRef.current["sauce-barrel"] = false;
    const currentCount = Math.max(0, Number(v.sauceBarrelsMade) || 0);
    const correctionGeneration = Math.max(0, Number(v.sauceBarrelCorrectionGeneration) || 0);
    sauceNextDueNetSecRef.current = dueAtNetSec;
    commitAutomatic("sauce-barrel", dueAtNetSec, dueAtNetSec + cadence, buildSauceClaimMutations({
      countFrom: currentCount,
      countTo: currentCount + 1,
      anchorFrom: anchor,
      anchorTo: dueAtNetSec,
      correctionGeneration,
    }));
  }, [
    autoTrackBlocked,
    autoTrackBlockedRef,
    autoTrackProgress,
    calc.pressDone,
    calc.sauceDepletionSec,
    commitAutomatic,
    disabled,
    elapsedBatchSec,
    endedAt,
    nextRunPrepActive,
    runGeneration,
    runId,
    runStatus,
    v.sauceBarrelAnchorNetSec,
    v.sauceBarrelCorrectionGeneration,
    v.sauceBarrelsMade,
  ]);

  // Persisted anchors are the authoritative rebase points. In particular, a
  // manual +/- may happen while a prior automatic event is due: resetting this
  // slot's due time to the new anchor prevents that stale event from writing
  // the old anchor back after the suppression fence expires.
  useEffect(() => {
    (["app1", "app2", "app3", "app4"] as const).forEach((slot) => {
      const values = v as FormValues;
      const info = computeAppSlotInfo({
        type: String(values[`${slot}Type` as keyof FormValues]),
        recipe: values[`${slot}CheeseRecipe` as keyof FormValues] as FormValues["app1CheeseRecipe"],
        batchLbs: Number(values[`${slot}BatchLbs` as keyof FormValues]) || 0,
        ozPerPizza: Number(values[`${slot}OzPerPizza` as keyof FormValues]) || 0,
        required: Number(calc[`${slot}Batches`]),
        ppm: calc.ppm,
      });
      const channel = `${slot}-batch` as AutoTrackChannel;
      dueRefForChannel(channel).current = info.cadence > 0
        ? Math.max(0, Number(values[`${slot}BatchAnchorNetSec` as keyof FormValues]) || 0) + info.cadence
        : 0;
    });
  }, [calc.ppm, v]);

  // Applicator batches use the same provider-owned, net-production clock as
  // Sauce. Each slot has its own effective batch and therefore its own cadence;
  // this deliberately does not use the dough batch cadence or add controls to
  // mix/lb-only rows.
  useEffect(() => {
    if (
      !claimAutoTrackEvent ||
      disabled ||
      autoTrackBlocked ||
      autoTrackBlockedRef?.current ||
      !autoTrackProgress ||
      runStatus !== "running" ||
      calc.pressDone ||
      Date.now() < autoSuppressUntilRef.current ||
      !Number.isFinite(elapsedBatchSec)
    ) return;
    const formValues = v as FormValues;
    const slots = (["app1", "app2", "app3", "app4"] as const).map((slot) => {
      const info = computeAppSlotInfo({
        type: String(formValues[`${slot}Type` as keyof FormValues]),
        recipe: formValues[`${slot}CheeseRecipe` as keyof FormValues] as FormValues["app1CheeseRecipe"],
        batchLbs: Number(formValues[`${slot}BatchLbs` as keyof FormValues]),
        ozPerPizza: Number(formValues[`${slot}OzPerPizza` as keyof FormValues]),
        required: Number(calc[`${slot}Batches`]),
        ppm: calc.ppm,
      });
      const required = Number(calc[`${slot}Batches`]);
      return {
        slot,
        channel: `${slot}-batch` as AutoTrackChannel,
        madeField: `${slot}BatchesMade` as keyof FormValues,
        anchorField: `${slot}BatchAnchorNetSec` as keyof FormValues,
        correctionField: `${slot}BatchCorrectionGeneration` as keyof FormValues,
        valid: info.validForClaim,
        cadence: info.cadence,
        required,
      };
    });
    for (const slot of slots) {
      if (!slot.valid || !Number.isFinite(slot.cadence) || slot.cadence <= 0) continue;
      const made = Math.max(0, Number(formValues[slot.madeField]) || 0);
      const anchor = Math.max(0, Number(formValues[slot.anchorField]) || 0);
      const correctionGeneration = Math.max(0, Number(formValues[slot.correctionField]) || 0);
      const dueAt = dueRefForChannel(slot.channel).current || anchor + slot.cadence;
      // At most one sequenced event is claimed at a time. The canonical
      // acknowledgement advances the persisted anchor, then this effect claims
      // the next overdue fractional cadence without losing accumulated time.
      // Step 6b/7a: a fresh server due-now verdict fires immediately; the local
      // elapsed check is the fallback. Task 1: a FRESH explicit not-due verdict
      // means the server owns this slot's next claim — skip the redundant local
      // net-second check while that latch is fresh.
      const serverOwnsNextClaim =
        serverDueNowRef.current[slot.channel] === false &&
        nowTimeRef.current - (serverScheduleAtMsRef.current[slot.channel] ?? 0) <= SERVER_SCHEDULE_TTL_MS;
      if (serverOwnsNextClaim) continue;
      const serverVerdictDue = serverDueNowRef.current[slot.channel] === true;
      if ((!serverVerdictDue && elapsedBatchSec < dueAt) || made >= Math.ceil(slot.required)) continue;
      serverDueNowRef.current[slot.channel] = false;
      dueRefForChannel(slot.channel).current = dueAt;
      commitAutomatic(slot.channel, dueAt, dueAt + slot.cadence, buildAppSlotClaimMutations({
        slot: slot.slot,
        madeFrom: made,
        madeTo: Math.min(Math.ceil(slot.required), made + 1),
        anchorFrom: anchor,
        anchorTo: dueAt,
        correctionGeneration,
      }));
    }
  }, [
    autoSuppressUntilRef,
    autoTrackBlocked,
    autoTrackBlockedRef,
    autoTrackProgress,
    calc,
    claimAutoTrackEvent,
    commitAutomatic,
    disabled,
    elapsedBatchSec,
    runStatus,
    v,
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
    const caseSuppressed = Date.now() < autoSuppressUntilRef.current;
    // Keep legacy packaging/manual suppression behavior for Dough while
    // allowing a Dough-only correction to leave case tracking untouched.
    const doughSuppressed =
      Date.now() < doughAutoSuppressUntilRef.current
      || Date.now() < autoSuppressUntilRef.current;

    // ── Cases (and skids, derived from the same total): tick once per case. ──
    if (
      caseTrackingActive
      && calc.ppm > 0
      && v.pizzasPerCase > 0
      && nowMs >= caseNextDueMsRef.current
    ) {
      const casePeriodMs = clampWebPeriodMs((v.pizzasPerCase / calc.ppm) * 60000);
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

      if (!caseSuppressed) {
        const cps = v.casesPerSkid;
        const curTotal =
          (Number(form.getValues("skidsCompleted")) || 0) * cps +
          (Number(form.getValues("casesOnCurrentSkid")) || 0);
        const decision = computeCaseTickWrite({
          prevExpected,
          expectedRaw,
          expectedCases,
          prevFreezer,
          nextFreezer: drainFreezerRef.current,
          curTotal,
          casesPerSkid: cps,
          casesNeeded: v.casesNeeded,
          drainActive,
          packagingDrainActive,
          caseClaimRetry: caseClaimRetryRef.current,
          formResetSkipped: formResetSkippedRef.current,
        });
        if (decision.caseClaimRetryReset) caseClaimRetryRef.current = false;
        formResetSkippedRef.current = decision.formResetSkippedNew;
        // Seed fires exactly when the seed branch is entered (matching the
        // original), and write fires when the engine computed a new total.
        const fired = decision.action !== "none" && decision.action !== "reset-skip";
        if (fired) {
          const nextSkids = Math.floor(decision.newTotal / cps);
          const nextCases = Math.round(decision.newTotal % cps);
          commitAutomatic("case", nowMs, caseNextDueMsRef.current, buildCaseClaimMutations({
            skidsFrom: Number(form.getValues("skidsCompleted")) || 0,
            skidsTo: nextSkids,
            casesFrom: Number(form.getValues("casesOnCurrentSkid")) || 0,
            casesTo: nextCases,
          }));
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

    // A timed manual correction pause ends by re-arming every dough channel.
    // Return without writing in this render so the next clock tick starts from
    // a clean, full cadence and cannot replay the paused interval.
    if (
      doughTimerPausedRef.current > 0
      && doughTimerResumeAtRef.current > 0
      && nowMs >= doughTimerResumeAtRef.current
    ) {
      rearmDoughTimers(nowMs);
      return;
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
      const trayTick = computeTrayTick({
        nowMs,
        prodDueMs: trayProdNextDueMsRef.current,
        consDueMs: trayNextDueMsRef.current,
        lastMs: trayLastMsRef.current,
        periodMs: timing.trayMs,
        suppressed: doughSuppressed,
        feedComplete: doughFeedComplete,
        deficitOpen: calc.traysNeeded > 0 || v.batchesReady > 0,
        seeded: traySeededRef.current,
        current: Number(form.getValues("traysOnLine")) || 0,
        seed: suggestedDoughStaging(calc.traysNeeded, calc.batchesNeeded).trays,
        ppm: calc.ppm,
        perTray: calc.perTray,
        remainder: traysRemainderRef.current,
      });
      trayProdNextDueMsRef.current = trayTick.prodDueMsNew;
      trayNextDueMsRef.current = trayTick.consDueMsNew;
      trayLastMsRef.current = trayTick.lastMsNew;
      traysRemainderRef.current = trayTick.remainderNew;
      traySeededRef.current = trayTick.seededNew;
      if (trayTick.seed) {
        traysSeededAmount = trayTick.seed.to;
        commitAutomatic("tray-consume", nowMs, trayNextDueMsRef.current, [
          { field: "traysOnLine", from: trayTick.seed.from, to: trayTick.seed.to },
        ]);
      } else if (trayTick.delta !== 0) {
        const next = Math.max(0, v.traysOnLine + trayTick.delta);
        if (next !== v.traysOnLine) {
          commitAutomatic(trayTick.delta > 0 ? "tray-produce" : "tray-consume", nowMs, trayTick.delta > 0
            ? trayProdNextDueMsRef.current
            : trayNextDueMsRef.current, [
            { field: "traysOnLine", from: Number(form.getValues("traysOnLine")) || 0, to: next },
          ]);
        }
      }
    }

    if (runStatus === "running" && calc.perBatch > 0 && calc.ppm > 0) {
      const timing = getAutoTrackTiming(calc.ppm, v.pizzasPerCase, calc.perTray, calc.perBatch, machine);
      const batchTick = computeBatchTick({
        nowMs,
        prodDueMs: batchProdNextDueMsRef.current,
        consDueMs: batchNextDueMsRef.current,
        lastMs: batchLastMsRef.current,
        periodMs: timing.batchConsumptionMs,
        fullBatchMs: timing.batchProductionMs,
        effDrainMs: Math.max(
          machine && machine.hopperSec > 0 ? machine.hopperSec * 1000 : 0,
          (calc.perBatch / calc.ppm) * 60000,
        ),
        suppressed: doughSuppressed,
        feedComplete: doughFeedComplete,
        deficitOpen: calc.batchesNeeded > 0,
        seeded: batchSeededRef.current,
        current: Number(form.getValues("batchesReady")) || 0,
        traysSeededAmount,
        traysNeeded: calc.traysNeeded,
        batchesNeeded: calc.batchesNeeded,
      });
      batchProdNextDueMsRef.current = batchTick.prodDueMsNew;
      batchNextDueMsRef.current = batchTick.consDueMsNew;
      batchLastMsRef.current = batchTick.lastMsNew;
      batchSeededRef.current = batchTick.seededNew;
      if (batchTick.seed) {
        commitAutomatic("batch-consume", nowMs, batchNextDueMsRef.current, [
          { field: "batchesReady", from: batchTick.seed.from, to: batchTick.seed.to },
        ]);
      } else if (batchTick.delta !== 0) {
        let next = v.batchesReady + batchTick.delta;
        if (batchTick.delta > 0) next = Math.min(next, Math.max(v.batchesReady, 3));
        next = Math.max(0, Math.round(next * 100) / 100);
        if (next !== v.batchesReady) {
          commitAutomatic(batchTick.delta > 0 ? "batch-produce" : "batch-consume", nowMs, batchTick.delta > 0
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
    doughAutoSuppressUntilRef,
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
