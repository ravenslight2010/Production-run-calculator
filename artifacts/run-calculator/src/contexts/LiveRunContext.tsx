import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  type FormValues,
  type RunMeta,
  type DayState,
  DEFAULT_VALUES,
  DEFAULT_PEP_TYPES,
} from "../types";
import { computeCalc, type Calc } from "@workspace/live-calc";
import { useClock } from "../hooks/useClock";
import { useNotifications } from "../hooks/useNotifications";
import {
  useAutoTrack,
  suggestedDoughStaging,
  type AutoTrackEventClaim,
  type AutoTrackEventResult,
} from "../hooks/useAutoTrack";
import { detectStallFromDelta } from "@workspace/downtime-trends";
import { loadRunValues, saveRunValues, markRunValuesUpdated } from "../storage";
import type { NotificationPrefs } from "../notificationPrefs";
import { getSauceBarrelEntry } from "../sauceBarrelStore";
import { recordPerformance } from "../performanceDiagnostics";
import { calcRef } from "../liveRunCalc";
import {
  computeLinePhases,
  computePackagingDrainElapsedSec,
  lineHasPackagingDrain,
} from "../linePhases";
import { pauseStopsTunnel } from "../pausePolicy";
import {
  acceptPackagingSpeedNudge,
  canDetectPackagingSpeedNudge,
  createPackagingSpeedNudgeTracking,
  dismissPackagingSpeedNudge,
  evaluatePackagingSpeedNudge,
  recordPackagingSpeedCorrection,
  type PackagingSpeedNudge,
  type PackagingSpeedNudgeFeedbackStatus,
} from "../packagingSpeedNudge";
import { isolatePendingRunPackagingProgress } from "../runProgressIsolation";

type RunStatus = "pending" | "running" | "paused" | "ended";
type RunStoppage = NonNullable<RunMeta["stoppages"]>[number];

// ── Calc output type ─────────────────────────────────────────────────────────
// Calc type is re-exported from @workspace/live-calc (imported above).

// ── Context value ────────────────────────────────────────────────────────────
export interface LiveRunContextValue {
  nowTime: Date;
  calc: Calc;
  liveFreezerMin: number;
  elapsedBatchSec: number;
  currentRunDowntimeMs: number;
  casesPct: number;
  casesFreezerPct: number;
  casesPctWithFreezer: number;
  currentBatchNum: number;
  secUntilNextBatch: number;
  totalBatchesNeeded: number;
  showBatchDue: boolean;
  setShowBatchDue: React.Dispatch<React.SetStateAction<boolean>>;
  autoTrackProgress: boolean;
  setAutoTrackProgress: React.Dispatch<React.SetStateAction<boolean>>;
  autoTrackSuggestion: ReturnType<typeof useAutoTrack>["autoTrackSuggestion"];
  autoSuppressUntilRef: React.MutableRefObject<number>;
  doughAutoSuppressUntilRef: React.MutableRefObject<number>;
  fireAutoTrackNow: (scope?: "case" | "dough" | "all") => void;
  tickDueRefs: ReturnType<typeof useAutoTrack>["tickDueRefs"];
  coordinationStatus: ReturnType<typeof useAutoTrack>["coordinationStatus"];
  speedNudge: PackagingSpeedNudge | null;
  speedNudgeStatus: PackagingSpeedNudgeFeedbackStatus;
  detectPackagingSpeedDrift: (correctionDeltaCases: number) => void;
  acceptPackagingSpeedNudge: (nowMs?: number) => void;
  dismissPackagingSpeedNudge: () => void;
  isDoughTimerPaused: boolean;
  pauseDoughTimers: (durationMs?: number) => void;
  resumeDoughTimers: () => void;
  stallPrompt: boolean;
  setStallPrompt: React.Dispatch<React.SetStateAction<boolean>>;
  stallCheck: ReturnType<typeof detectStallFromDelta>;
  /**
   * True when the current run's press is done (casesNeeded met) AND an
   * unstarted dough run follows in today's schedule. Signals the Dough/Sauce
   * tabs to switch from "late-run" tracking to "prep for next run" mode.
   */
  nextRunPrepActive: boolean;
  /** True while the behind-pace in-app banner should be visible. */
  showPaceAlert: boolean;
  setShowPaceAlert: React.Dispatch<React.SetStateAction<boolean>>;
  /** Human-readable pace alert message (rate / shortfall / time remaining). */
  paceAlertMsg: string;
  packagingDrainActive: boolean;
}

// Module-level calcRef is kept as a compatibility export for existing callers.
// The owning implementation lives in ../liveRunCalc so this provider module
// only exposes component-facing context behavior.
export { calcRef } from "../liveRunCalc";

// ── Provider props ───────────────────────────────────────────────────────────
export interface LiveRunProviderProps {
  children: ReactNode;
  runStatus: RunStatus;
  currentRun: RunMeta | undefined;
  currentRunId: string;
  v: FormValues;
  ve: FormValues;
  form: UseFormReturn<FormValues>;
  dayState: DayState;
  doughSubTab: string;
  upcomingRunLabels: string[];
  prefs: NotificationPrefs | undefined;
  screenMode: string | null;
  machine: { spinSec: number; hopperSec: number };
  externalAutoSuppressRef?: React.MutableRefObject<number>;
  externalDoughAutoSuppressRef?: React.MutableRefObject<number>;
  onPackagingProgressAutoAdvance?: (
    skidsCompleted: number,
    casesOnCurrentSkid: number,
  ) => boolean;
  autoTrackBlocked?: boolean;
  autoTrackBlockedRef?: React.MutableRefObject<boolean>;
  autoTrackRebaseAfterBlock?: boolean;
  claimAutoTrackEvent?: (claim: AutoTrackEventClaim) => Promise<AutoTrackEventResult>;
}

// ── Context ──────────────────────────────────────────────────────────────────
const LiveRunContext = createContext<LiveRunContextValue | null>(null);

export function useLiveRun(): LiveRunContextValue {
  const ctx = useContext(LiveRunContext);
  if (!ctx) throw new Error("useLiveRun must be used within LiveRunProvider");
  return ctx;
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function LiveRunProvider({
  children,
  runStatus,
  currentRun,
  currentRunId,
  v: liveValues,
  ve,
  form,
  dayState,
  doughSubTab,
  upcomingRunLabels,
  prefs,
  screenMode,
  machine,
  externalAutoSuppressRef,
  externalDoughAutoSuppressRef,
  onPackagingProgressAutoAdvance,
  autoTrackBlocked = false,
  autoTrackBlockedRef,
  autoTrackRebaseAfterBlock = false,
  claimAutoTrackEvent,
}: LiveRunProviderProps) {
  const nowTime = useClock(runStatus);
  // A selected pending run must never inherit Packaging, Sauce, or Frontline
  // applicator completion from the previously viewed/active run while
  // react-hook-form settles a run switch. Staged Dough values remain intact
  // because they may be intentionally seeded before Start.
  const v = isolatePendingRunPackagingProgress(currentRun, liveValues);

  // Freezer-fill ramp: rises over elapsed run time, capped to freezerTime.
  // Pausing freezes the ramp at the paused-at moment.
  const liveFreezerMin = (() => {
    if (!currentRun?.startedAt) return 0;
    if (currentRun.endedAt) return Number(ve.freezerTime);
    const refTime = currentRun.pausedAt ?? nowTime.getTime();
    const elapsed = (refTime - currentRun.startedAt) / 60000;
    return Math.min(elapsed, Number(ve.freezerTime));
  })();

  // ── Core production calc ─────────────────────────────────────────────────
  // ── Core production calc ─────────────────────────────────────────────────
  // Computed by the shared pure engine in @workspace/live-calc so the SAME
  // formulas run on the server (Step 3 of the server-side refactor) and the
  // client can't drift. Telemetry for the local computation stays here.
  const calc = useMemo((): Calc => {
    const calcStartedAt = typeof performance === "undefined" ? null : performance.now();
    const result = computeCalc({
      v,
      ve,
      currentRun,
      nowTimeMs: nowTime.getTime(),
      doughSubTab,
      defaultPepTypes: DEFAULT_PEP_TYPES,
    });
    if (calcStartedAt !== null && typeof performance !== "undefined") {
      recordPerformance("live-calculation", performance.now() - calcStartedAt, "calculation");
    }
    return result;
  }, [v, ve, currentRun, nowTime, doughSubTab]);

  const currentRunDowntimeMs = useMemo(
    () =>
      (currentRun?.stoppages ?? [])
        .filter(s => s.endedAt && s.type !== "pause")
        .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0),
    [currentRun?.stoppages],
  );

  const elapsedBatchSec = currentRun?.startedAt
    ? Math.max(0, ((currentRun.pausedAt ?? nowTime.getTime()) - currentRun.startedAt - currentRunDowntimeMs)) / 1000
    : 0;

  const linePhases = useMemo(() => {
    const pauses = (currentRun?.stoppages ?? []).filter((s) => s.type === "pause");
    const openPause = pauses
      .filter((s) => !s.endedAt)
      .reduce<typeof pauses[number] | undefined>(
        (latest, s) => (!latest || s.startedAt > latest.startedAt ? s : latest),
        undefined,
      );
    const lastClosedPause = pauses
      .filter((s) => !!s.endedAt)
      .reduce<typeof pauses[number] | undefined>(
        (latest, s) => (!latest || (s.endedAt ?? 0) > (latest.endedAt ?? 0) ? s : latest),
        undefined,
      );
    return computeLinePhases({
      elapsedBatchSec,
      pausedAt: currentRun?.pausedAt,
      lastResumeWallMs: lastClosedPause?.endedAt ?? 0,
      lastPauseStartWallMs: lastClosedPause?.startedAt ?? 0,
      pauseStopsTunnel: pauseStopsTunnel(openPause),
      lastPauseStopsTunnel: pauseStopsTunnel(lastClosedPause),
      runStatus,
      preTunnelMin: Number(ve.preTunnelMin) > 0 ? Number(ve.preTunnelMin) : 2.5,
      postTunnelMin: Number(ve.postTunnelMin) > 0 ? Number(ve.postTunnelMin) : 2.5,
      freezerTime: Number(ve.freezerTime),
      nowMs: nowTime.getTime(),
      endedAt: currentRun?.endedAt,
    });
  }, [
    currentRun?.endedAt,
    currentRun?.pausedAt,
    currentRun?.stoppages,
    elapsedBatchSec,
    nowTime,
    runStatus,
    ve.freezerTime,
    ve.preTunnelMin,
    ve.postTunnelMin,
  ]);
  const packagingDrainActive =
    runStatus === "paused" && lineHasPackagingDrain(linePhases);
  const packagingAutoTrackActive =
    runStatus !== "running" || linePhases.stage3.state === "active";
  const packagingDrainElapsedSec = computePackagingDrainElapsedSec({
    elapsedBatchSec,
    pausedAt: currentRun?.pausedAt,
    lastResumeWallMs: 0,
    lastPauseStartWallMs: 0,
    pauseStopsTunnel: (() => {
      const openPause = (currentRun?.stoppages ?? [])
        .filter((s) => s.type === "pause" && !s.endedAt)
        .reduce<RunStoppage | undefined>(
          (latest, s) => (!latest || s.startedAt > latest.startedAt ? s : latest),
          undefined,
        );
      return pauseStopsTunnel(openPause);
    })(),
    runStatus,
    preTunnelMin: Number(ve.preTunnelMin) > 0 ? Number(ve.preTunnelMin) : 2.5,
    postTunnelMin: Number(ve.postTunnelMin) > 0 ? Number(ve.postTunnelMin) : 2.5,
    freezerTime: Number(ve.freezerTime),
    nowMs: nowTime.getTime(),
  });

  const casesPct = v.casesNeeded > 0 ? Math.min(1, calc.casesCompleted / v.casesNeeded) : 0;
  const casesFreezerPct =
    v.casesNeeded > 0
      ? Math.max(0, Math.min(1, (calc.casesCompleted + calc.casesInFreezer) / v.casesNeeded) - casesPct)
      : 0;
  const casesPctWithFreezer = Math.min(1, casesPct + casesFreezerPct);

  const currentBatchNum = calc.timePerBatchSec > 0 ? Math.floor(elapsedBatchSec / calc.timePerBatchSec) : 0;
  const secUntilNextBatch =
    calc.timePerBatchSec > 0 ? calc.timePerBatchSec - (elapsedBatchSec % calc.timePerBatchSec) : 0;
  const totalBatchesNeeded =
    calc.timePerBatchSec > 0 && calc.totalTimeSec > 0
      ? Math.ceil(calc.totalTimeSec / calc.timePerBatchSec)
      : 0;
  // Both the Sauce tab and batch-alert suppression measure the active barrel
  // on this net-production clock. The stored anchor is updated when the crew
  // starts a replacement barrel, so paused time never depletes sauce and a new
  // barrel immediately resumes the batch cycle.
  const sauceBarrelElapsedSec = Math.max(
    0,
    elapsedBatchSec - getSauceBarrelEntry(currentRunId).lastBarrelNetSec,
  );

  // ── Next-run prep handoff detection ─────────────────────────────────────
  // When the current run's press is done AND an unstarted dough run follows in
  // today's schedule, the Dough/Sauce tabs should switch to "prep for next run"
  // mode instead of showing late-run countdown timers.
  const nextRun = dayState.runs[dayState.currentIndex + 1];
  const nextRunPrepActive =
    runStatus === "running" &&
    calc.pressDone &&
    !!nextRun &&
    !nextRun.startedAt &&
    (nextRun.subTab ?? "dough") !== "crusts";

  // ── Notifications ────────────────────────────────────────────────────────
  const { showBatchDue, setShowBatchDue, showPaceAlert, setShowPaceAlert, paceAlertMsg } = useNotifications({
    runStatus,
    nowTime,
    currentRun,
    calc,
    sauceBarrelElapsedSec,
    v: ve,
    isCrust: doughSubTab === "crusts",
    nextRunLabels: upcomingRunLabels,
    prefs,
  });

  // ── Stall detection ───────────────────────────────────────────────────────
  const stallCheck = useMemo(
    () =>
      detectStallFromDelta({
        running: !!currentRun?.startedAt && !currentRun?.endedAt && !currentRun?.pausedAt,
        hasOpenStoppage: (currentRun?.stoppages ?? []).some(s => !s.endedAt),
        ppm: calc.ppm,
        pizzasPerCase: v.pizzasPerCase,
        paceDelta: calc.paceDelta,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      currentRun?.startedAt, currentRun?.endedAt, currentRun?.pausedAt,
      currentRun?.stoppages, calc.ppm, v.pizzasPerCase, calc.paceDelta,
    ],
  );
  const [stallPrompt, setStallPrompt] = useState(false);
  const stallEpisodeShownRef = useRef(false);
  useEffect(() => {
    if (stallCheck.stalled) {
      if (!stallEpisodeShownRef.current && screenMode === null) {
        stallEpisodeShownRef.current = true;
        setStallPrompt(true);
      }
    } else {
      stallEpisodeShownRef.current = false;
      setStallPrompt(false);
    }
  }, [stallCheck.stalled, screenMode]);
  useEffect(() => {
    stallEpisodeShownRef.current = false;
    setStallPrompt(false);
  }, [currentRunId]);

  // Keep module-level calcRef up-to-date so Home can read calc without
  // subscribing to this context (avoids per-second re-renders in Home).
  calcRef.current = calc;

  // ── Auto-track ───────────────────────────────────────────────────────────
  const { autoTrackProgress, setAutoTrackProgress, autoTrackSuggestion, autoSuppressUntilRef, doughAutoSuppressUntilRef, fireAutoTrackNow, tickDueRefs, isDoughTimerPaused, pauseDoughTimers, resumeDoughTimers, coordinationStatus } =
    useAutoTrack({
      runId: currentRunId,
      runGeneration: String(currentRun?.metaUpdatedAt ?? currentRun?.startedAt ?? 0),
      runStatus,
      endedAt: currentRun?.endedAt ?? null,
      packagingDrainActive,
      packagingDrainElapsedSec,
      packagingAutoTrackActive,
      nowTime,
      elapsedBatchSec,
      calc,
      v: ve,
      form,
      machine,
      disabled: screenMode !== null,
      // Pass Home's ref so the hook's own suppression check reads from it —
      // manual-edit latches written by UI consumers are honoured by the write loop.
      externalAutoSuppressRef,
      externalDoughAutoSuppressRef,
      onPackagingProgressAutoAdvance,
      autoTrackBlocked,
      autoTrackBlockedRef,
      autoTrackRebaseAfterBlock,
      claimAutoTrackEvent,
      nextRunPrepActive,
    });

  // Packaging speed feedback is shared by the Packaging tab and the quick
  // check cards on Dough/Sauce. Keep the lifecycle in this always-mounted
  // provider so switching tabs cannot discard correction evidence.
  const speedNudgeTrackingRef = useRef(createPackagingSpeedNudgeTracking(""));
  const [speedNudge, setSpeedNudge] = useState<PackagingSpeedNudge | null>(null);
  const [speedNudgeStatus, setSpeedNudgeStatus] =
    useState<PackagingSpeedNudgeFeedbackStatus>(null);

  if (speedNudgeTrackingRef.current.runId !== currentRunId) {
    speedNudgeTrackingRef.current = createPackagingSpeedNudgeTracking(currentRunId);
  }

  useEffect(() => {
    setSpeedNudge(null);
    setSpeedNudgeStatus(null);
  }, [currentRunId]);

  const detectPackagingSpeedDrift = useCallback((correctionDeltaCases: number) => {
    const now = Date.now();
    const tracking = speedNudgeTrackingRef.current;
    if (!canDetectPackagingSpeedNudge(tracking, now)) return;
    if (!autoTrackProgress) {
      setSpeedNudge(null);
      setSpeedNudgeStatus("auto-disabled");
      return;
    }
    if (runStatus !== "running") {
      setSpeedNudge(null);
      setSpeedNudgeStatus("run-not-running");
      return;
    }

    const elapsedOutputMin = Math.max(
      0,
      elapsedBatchSec / 60 - Number(ve.freezerTime),
    );
    const nextTracking = recordPackagingSpeedCorrection(
      tracking,
      correctionDeltaCases,
    );
    speedNudgeTrackingRef.current = nextTracking;
    if (nextTracking.corrections.length === 0) {
      setSpeedNudge(null);
      setSpeedNudgeStatus(null);
      return;
    }

    const evaluation = evaluatePackagingSpeedNudge({
      elapsedOutputMin,
      configuredPpm: calc.ppm,
      pizzasPerCase: v.pizzasPerCase,
      casesPerSkid: v.casesPerSkid,
      speedAdjustment: v.speedAdjustment,
      isCrust: doughSubTab === "crusts",
      corrections: nextTracking.corrections,
    });
    setSpeedNudge(evaluation.nudge);
    setSpeedNudgeStatus(evaluation.reason);
  }, [
    autoTrackProgress,
    calc.ppm,
    doughSubTab,
    elapsedBatchSec,
    runStatus,
    v.casesPerSkid,
    v.pizzasPerCase,
    v.speedAdjustment,
    ve.freezerTime,
  ]);

  const acceptSharedPackagingSpeedNudge = useCallback((nowMs = Date.now()) => {
    if (speedNudge) {
      const field = speedNudge.isCrust ? "approxLineSpeed" : "speedAdjustment";
      form.setValue(field, speedNudge.value, { shouldDirty: true });
    }
    speedNudgeTrackingRef.current = acceptPackagingSpeedNudge(
      speedNudgeTrackingRef.current,
      nowMs,
    );
    setSpeedNudge(null);
    setSpeedNudgeStatus(null);
  }, [form, speedNudge]);

  const dismissSharedPackagingSpeedNudge = useCallback(() => {
    speedNudgeTrackingRef.current = dismissPackagingSpeedNudge(
      speedNudgeTrackingRef.current,
    );
    setSpeedNudge(null);
    setSpeedNudgeStatus(null);
  }, []);

  // ── Pre-seed next run's dough counters when this run's press is done ─────
  const nextRunSeededRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (screenMode !== null || !autoTrackProgress) return;
    if (runStatus !== "running" || !calc.pressDone) return;
    const nextRun = dayState.runs[dayState.currentIndex + 1];
    if (!nextRun || nextRun.startedAt) return;
    if ((nextRun.subTab ?? "dough") === "crusts") return;
    const key = `${currentRunId}->${nextRun.id}`;
    if (nextRunSeededRef.current.has(key)) return;
    const nv = { ...DEFAULT_VALUES, ...loadRunValues(nextRun.id) };
    if ((Number(nv.traysOnLine) || 0) > 0 || (Number(nv.batchesReady) || 0) > 0) {
      nextRunSeededRef.current.add(key);
      return;
    }
    const totalPizzas = (Number(nv.casesNeeded) || 0) * (Number(nv.pizzasPerCase) || 0);
    if (totalPizzas <= 0) return;
    const perTray = Number(nv.doughballsPerTray) || 0;
    const recipeLbs = (nv.doughRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const yieldPerBatch =
      recipeLbs > 0 && Number(nv.targetDoughballWeight) > 0
        ? (recipeLbs * 16) / Number(nv.targetDoughballWeight)
        : Number(nv.doughBatchYield) || 0;
    const traysNeeded = perTray > 0 ? totalPizzas / perTray : 0;
    const batchesNeeded = yieldPerBatch > 0 ? totalPizzas / yieldPerBatch : 0;
    const seed = suggestedDoughStaging(traysNeeded, batchesNeeded);
    if (seed.trays === null && seed.batches === null) return;
    nextRunSeededRef.current.add(key);
    saveRunValues(nextRun.id, { ...nv, traysOnLine: seed.trays ?? 0, batchesReady: seed.batches ?? 0 });
    markRunValuesUpdated(nextRun.id, Date.now());
  }, [runStatus, calc.pressDone, autoTrackProgress, screenMode, dayState.runs, dayState.currentIndex, currentRunId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo<LiveRunContextValue>(
    () => ({
      nowTime, calc, liveFreezerMin, elapsedBatchSec, currentRunDowntimeMs,
      casesPct, casesFreezerPct, casesPctWithFreezer,
      currentBatchNum, secUntilNextBatch, totalBatchesNeeded,
      showBatchDue, setShowBatchDue,
      autoTrackProgress, setAutoTrackProgress,
      autoTrackSuggestion, autoSuppressUntilRef, doughAutoSuppressUntilRef, fireAutoTrackNow, tickDueRefs,
      coordinationStatus,
      speedNudge, speedNudgeStatus, detectPackagingSpeedDrift,
      acceptPackagingSpeedNudge: acceptSharedPackagingSpeedNudge,
      dismissPackagingSpeedNudge: dismissSharedPackagingSpeedNudge,
      isDoughTimerPaused, pauseDoughTimers, resumeDoughTimers,
      stallPrompt, setStallPrompt, stallCheck,
      nextRunPrepActive,
      packagingDrainActive,
      showPaceAlert, setShowPaceAlert, paceAlertMsg,
    }),
    [
      nowTime, calc, liveFreezerMin, elapsedBatchSec, currentRunDowntimeMs,
      casesPct, casesFreezerPct, casesPctWithFreezer,
      currentBatchNum, secUntilNextBatch, totalBatchesNeeded,
      showBatchDue, setShowBatchDue,
      autoTrackProgress, setAutoTrackProgress,
      autoTrackSuggestion, autoSuppressUntilRef, doughAutoSuppressUntilRef, fireAutoTrackNow, tickDueRefs,
      coordinationStatus,
      speedNudge, speedNudgeStatus, detectPackagingSpeedDrift,
      acceptSharedPackagingSpeedNudge, dismissSharedPackagingSpeedNudge,
      isDoughTimerPaused, pauseDoughTimers, resumeDoughTimers,
      stallPrompt, setStallPrompt, stallCheck,
      nextRunPrepActive,
      packagingDrainActive,
      showPaceAlert, setShowPaceAlert, paceAlertMsg,
    ],
  );

  return <LiveRunContext.Provider value={value}>{children}</LiveRunContext.Provider>;
}
