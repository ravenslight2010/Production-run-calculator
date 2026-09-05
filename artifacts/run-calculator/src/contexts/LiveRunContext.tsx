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
import { computeCasesInFreezer, computeCasesOnLine } from "@workspace/inventory-math";
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
import { computeEffectiveLineSpeed } from "../lineSpeed";

type RunStatus = "pending" | "running" | "paused" | "ended";
type RunStoppage = NonNullable<RunMeta["stoppages"]>[number];

// ── Calc output type ─────────────────────────────────────────────────────────
export type Calc = {
  ppm: number;
  traysPerSkid: number;
  traysPerBatch: number;
  batchesPerSkid: number;
  casesOnLine: number;
  casesInFreezer: number;
  casesLeftToRun: number;
  casesLeftToOpen: number;
  stacksNeededTotal: number;
  casesForTiming: number;
  batchesNeeded: number;
  traysNeeded: number;
  buffer: number;
  doughShortCases: number;
  doughDepletionSec: number;
  casesOnLastSkid: number;
  timePressHzSec: number;
  timePerTraySec: number;
  timePerBatchSec: number;
  timePerSkidSec: number;
  timePerCaseSec: number;
  totalTimeSec: number;
  adjustedTimeSec: number;
  pressCasesLeft: number;
  pressDone: boolean;
  extraCases: number;
  doughMadeTimeSec: number;
  rackTimes: { trays: number; sec: number }[];
  sauceBatches: number;
  /**
   * Seconds to consume one sauce barrel at current PPM — the cadence at which
   * the sauce crew must complete batches. 0 when PPM / sauce oz or barrel lbs
   * are unset. Exposed for the sauce tab's upcoming batch timer (task #569) and
   * for depletion-guard logic in the Sauce tab.
   */
  sauceDepletionSec: number;
  app1Lbs: number; app1Batches: number;
  app2Lbs: number; app2Batches: number;
  app3Lbs: number; app3Batches: number;
  app4Lbs: number; app4Batches: number;
  pep1Lbs: number; pep1Batches: number;
  pep2Lbs: number; pep2Batches: number;
  pep1LbsB: number; pep1BatchesB: number;
  pep2LbsB: number; pep2BatchesB: number;
  casesCompleted: number;
  paceStatus: "on-pace" | "ahead" | "behind" | null;
  paceDelta: number;
  catchUpPpm: number | null;
  perTray: number;
  perBatch: number;
  sauceEffBarrel: number;
};

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
  const calc = useMemo((): Calc => {
    const calcStartedAt = typeof performance === "undefined" ? null : performance.now();
    const ppm = computeEffectiveLineSpeed({
      mode: doughSubTab === "crusts" ? "crusts" : "dough",
      approxLineSpeed: v.approxLineSpeed,
      crustsPerCycle: ve.crustsPerCycle,
      cycleSpeed: ve.cycleSpeed,
      speedAdjustment: v.speedAdjustment,
    });

    const perTray = doughSubTab === "crusts" ? v.crustsPerStack : v.doughballsPerTray;

    const doughRecipeLbs = (v.doughRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const effectiveDoughBatchYield =
      doughRecipeLbs > 0 && v.targetDoughballWeight > 0
        ? (doughRecipeLbs * 16) / v.targetDoughballWeight
        : v.doughBatchYield;

    const traysPerSkid = (v.casesPerSkid * v.pizzasPerCase) / perTray;
    const perBatch = doughSubTab === "crusts" ? v.crustsPerCase : effectiveDoughBatchYield;
    const traysPerBatch = effectiveDoughBatchYield / perTray;
    const batchesPerSkid = traysPerSkid / traysPerBatch;

    const casesOnLine = computeCasesOnLine({
      startedAt: currentRun?.startedAt,
      endedAt: currentRun?.endedAt,
      pausedAt: currentRun?.pausedAt,
      stoppages: currentRun?.stoppages,
      now: nowTime.getTime(),
      ppm,
      pizzasPerCase: v.pizzasPerCase,
      freezerTimeMin: Number(ve.freezerTime),
    });

    const casesInFreezer = computeCasesInFreezer({
      startedAt: currentRun?.startedAt,
      endedAt: currentRun?.endedAt,
      pausedAt: currentRun?.pausedAt,
      stoppages: currentRun?.stoppages,
      now: nowTime.getTime(),
      ppm,
      pizzasPerCase: v.pizzasPerCase,
      freezerTimeMin: Number(ve.freezerTime),
    });

    const casesLeftToRun =
      v.casesNeeded - v.skidsCompleted * v.casesPerSkid - v.casesOnCurrentSkid - casesOnLine + v.casesPerLayer;
    const casesForTiming =
      v.casesNeeded - v.skidsCompleted * v.casesPerSkid - v.casesOnCurrentSkid - casesOnLine;

    const totalPizzasLeft = casesLeftToRun * v.pizzasPerCase;
    const doughOnHand = v.traysOnLine * perTray + v.batchesReady * effectiveDoughBatchYield;
    const doughDeficit = Math.max(0, totalPizzasLeft - doughOnHand);
    const batchesNeeded = doughDeficit / effectiveDoughBatchYield;
    const traysNeeded = doughDeficit / perTray;
    const pizzasNetOfStaged = Math.max(0, totalPizzasLeft - v.traysOnLine * perTray);
    const casesLeftToOpen = v.crustsPerCase > 0 ? Math.ceil(pizzasNetOfStaged / v.crustsPerCase) : 0;
    const stacksNeededTotal = perTray > 0 ? Math.ceil(pizzasNetOfStaged / perTray) : 0;
    const buffer = Math.max(0, doughOnHand - totalPizzasLeft) / v.pizzasPerCase;
    const doughShortCases = doughDeficit / v.pizzasPerCase;
    const doughDepletionSec = ppm > 0 ? (doughOnHand / ppm) * 60 : 0;

    const casesOnLastSkid = Math.ceil(Math.max(0, v.casesPerSkid - casesOnLine));

    const timePressHzSec =
      doughSubTab !== "crusts" && ppm > 0 && ve.crustsPerCycle > 0
        ? (ve.crustsPerCycle / ppm) * 60
        : 0;
    const timePerTraySec = ppm > 0 ? (perTray / ppm) * 60 : 0;
    const timePerBatchSec = ppm > 0 ? (perBatch / ppm) * 60 : 0;
    const timePerSkidSec = ppm > 0 ? ((v.casesPerSkid * v.pizzasPerCase) / ppm) * 60 : 0;
    const timePerCaseSec = ppm > 0 ? (v.pizzasPerCase / ppm) * 60 : 0;
    const totalTimeSec = ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : 0;
    const doughMadeTimeSec =
      ppm > 0
        ? ((v.traysOnLine * perTray + v.batchesReady * effectiveDoughBatchYield) / ppm) * 60
        : 0;

    const rackTimes = [10, 12, 16, 18, 20, 22].map((n) => ({
      trays: n,
      sec: ppm > 0 ? (n * perTray * 60) / ppm : 0,
    }));

    // Frontline
    const totalPizzasRun = casesLeftToRun * v.pizzasPerCase;
    const totalPizzasForSauce = totalPizzasRun + v.casesPerLayer * v.pizzasPerCase;
    const frontlineRecipeLbs = (v.frontlineRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const sauceEffBarrel = frontlineRecipeLbs > 0 ? frontlineRecipeLbs : v.sauceBarrelLbs;
    const sauceLbs = (totalPizzasForSauce * v.sauceOzPerPizza) / 16 + 30;
    const sauceBatches = sauceEffBarrel > 0 ? sauceLbs / sauceEffBarrel : 0;
    // Time to consume one sauce barrel at current PPM: sauceEffBarrel × 16 ÷ sauceOzPerPizza ÷ PPM × 60
    const sauceDepletionSec =
      ppm > 0 && sauceEffBarrel > 0 && v.sauceOzPerPizza > 0
        ? (sauceEffBarrel * 16 / v.sauceOzPerPizza / ppm) * 60
        : 0;

    // Applicators
    const app1RecipeLbs = (v.app1CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const app1Lbs = (totalPizzasForSauce * v.app1OzPerPizza) / 16 + 20;
    const app1IsMix = v.app1Type.trim().toLowerCase().includes("mix");
    const app1EffBatch = app1RecipeLbs > 0 ? app1RecipeLbs : v.app1BatchLbs;
    const app1Batches = !app1IsMix && app1EffBatch > 0 ? app1Lbs / app1EffBatch : 0;
    const app2RecipeLbs = (v.app2CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const app2Lbs = (totalPizzasForSauce * v.app2OzPerPizza) / 16 + 20;
    const app2IsMix = v.app2Type.trim().toLowerCase().includes("mix");
    const app2EffBatch = app2RecipeLbs > 0 ? app2RecipeLbs : v.app2BatchLbs;
    const app2Batches = !app2IsMix && app2EffBatch > 0 ? app2Lbs / app2EffBatch : 0;
    const app3RecipeLbs = (v.app3CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const app3Lbs = (totalPizzasForSauce * v.app3OzPerPizza) / 16 + 20;
    const app3IsMix = v.app3Type.trim().toLowerCase().includes("mix");
    const app3EffBatch = app3RecipeLbs > 0 ? app3RecipeLbs : v.app3BatchLbs;
    const app3Batches = !app3IsMix && app3EffBatch > 0 ? app3Lbs / app3EffBatch : 0;
    const app4RecipeLbs = (v.app4CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
    const app4Lbs = (totalPizzasForSauce * v.app4OzPerPizza) / 16 + 20;
    const app4IsMix = v.app4Type.trim().toLowerCase().includes("mix");
    const app4EffBatch = app4RecipeLbs > 0 ? app4RecipeLbs : v.app4BatchLbs;
    const app4Batches = !app4IsMix && app4EffBatch > 0 ? app4Lbs / app4EffBatch : 0;

    // Pepperoni
    const pepCombined = v.pep1Combined === true;
    const pepStickMult = pepCombined ? 2 : 1;
    const pep1Lbs = (totalPizzasForSauce * v.pep1OzPerPizza) / 16 + v.pep1Sticks * pepStickMult;
    const pep1Batches =
      !DEFAULT_PEP_TYPES.includes(v.pep1Type ?? "") && v.pep1BatchLbs > 0
        ? pep1Lbs / v.pep1BatchLbs
        : 0;
    const pep1TypeBTrim = (v.pep1TypeB ?? "").trim();
    const pep1LbsB = pep1TypeBTrim
      ? (totalPizzasForSauce * (v.pep1OzPerPizzaB ?? 0)) / 16 + (v.pep1SticksB ?? 0) * pepStickMult
      : 0;
    const pep1BatchesB =
      pep1TypeBTrim && !DEFAULT_PEP_TYPES.includes(pep1TypeBTrim) && (v.pep1BatchLbsB ?? 0) > 0
        ? pep1LbsB / (v.pep1BatchLbsB ?? 1)
        : 0;
    const pep2Lbs = pepCombined ? 0 : (totalPizzasForSauce * v.pep2OzPerPizza) / 16 + v.pep2Sticks;
    const pep2Batches =
      !pepCombined && !DEFAULT_PEP_TYPES.includes(v.pep2Type ?? "") && v.pep2BatchLbs > 0
        ? pep2Lbs / v.pep2BatchLbs
        : 0;
    const pep2TypeBTrim = (v.pep2TypeB ?? "").trim();
    const pep2LbsB =
      !pepCombined && pep2TypeBTrim
        ? (totalPizzasForSauce * (v.pep2OzPerPizzaB ?? 0)) / 16 + (v.pep2SticksB ?? 0)
        : 0;
    const pep2BatchesB =
      !pepCombined && pep2TypeBTrim && !DEFAULT_PEP_TYPES.includes(pep2TypeBTrim) && (v.pep2BatchLbsB ?? 0) > 0
        ? pep2LbsB / (v.pep2BatchLbsB ?? 1)
        : 0;

    // Pace
    const casesCompleted = v.skidsCompleted * v.casesPerSkid + v.casesOnCurrentSkid;
    const extraCases = Math.max(0, casesCompleted - v.casesNeeded);
    const pressCasesLeft = v.casesNeeded > 0 ? Math.max(0, v.casesNeeded - casesCompleted - casesInFreezer) : 0;
    const pressDone = v.casesNeeded > 0 && casesCompleted + casesInFreezer >= v.casesNeeded;
    const isLiveRun = !!currentRun?.startedAt && !currentRun?.endedAt;
    const adjustedTimeSec =
      ppm > 0
        ? isLiveRun && v.casesNeeded > 0
          ? (pressCasesLeft * v.pizzasPerCase * 60) / ppm
          : (casesForTiming * v.pizzasPerCase * 60) / ppm
        : totalTimeSec;

    let paceStatus: "on-pace" | "ahead" | "behind" | null = null;
    let paceDelta = 0;
    if (currentRun?.startedAt && !currentRun?.endedAt && ppm > 0 && v.pizzasPerCase > 0) {
      const refTime = currentRun.pausedAt ?? Date.now();
      const downtimeMs = (currentRun.stoppages ?? [])
        .filter(s => s.endedAt && s.type !== "pause")
        .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
      const elapsedMin = Math.max(0, refTime - currentRun.startedAt - downtimeMs) / 60000;
      const elapsedMinAfterTunnel = Math.max(0, elapsedMin - Number(ve.freezerTime));
      const expectedCases = Math.floor((ppm * elapsedMinAfterTunnel) / v.pizzasPerCase);
      paceDelta = casesCompleted - expectedCases;
      // Don't show a verdict until elapsed >= freezerTime (the tunnel window).
      if (elapsedMin >= Number(ve.freezerTime)) {
        paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
      }
    }

    let catchUpPpm: number | null = null;
    if (
      paceStatus === "behind" &&
      currentRun?.startedAt &&
      !currentRun?.endedAt &&
      ppm > 0 &&
      v.pizzasPerCase > 0 &&
      v.casesNeeded > 0
    ) {
      const refTime = currentRun.pausedAt ?? Date.now();
      const downtimeMs = (currentRun.stoppages ?? [])
        .filter(s => s.endedAt && s.type !== "pause")
        .reduce((acc, s) => acc + (s.endedAt! - s.startedAt), 0);
      const elapsedSec = Math.max(0, refTime - currentRun.startedAt - downtimeMs) / 1000;
      const remainingCases = v.casesNeeded - casesCompleted;
      const originalTotalSec = ppm > 0 ? (v.casesNeeded * v.pizzasPerCase * 60) / ppm : 0;
      const remainingSec = Math.max(60, originalTotalSec - elapsedSec);
      if (remainingSec > 0 && remainingCases > 0) {
        catchUpPpm = Math.round((remainingCases * v.pizzasPerCase * 60) / remainingSec);
      }
    }

    const result = {
      ppm, traysPerSkid, traysPerBatch, batchesPerSkid, casesOnLine, casesInFreezer,
      casesLeftToRun, casesLeftToOpen, stacksNeededTotal, casesForTiming, batchesNeeded,
      traysNeeded, buffer, doughShortCases, doughDepletionSec, casesOnLastSkid,
      timePressHzSec, timePerTraySec, timePerBatchSec, timePerSkidSec, timePerCaseSec,
      totalTimeSec, adjustedTimeSec, pressCasesLeft, pressDone, extraCases, doughMadeTimeSec,
      rackTimes, sauceBatches, sauceDepletionSec,
      app1Lbs, app1Batches, app2Lbs, app2Batches, app3Lbs, app3Batches, app4Lbs, app4Batches,
      pep1Lbs, pep1Batches, pep2Lbs, pep2Batches,
      pep1LbsB, pep1BatchesB, pep2LbsB, pep2BatchesB,
      casesCompleted, paceStatus, paceDelta, catchUpPpm,
      perTray, perBatch, sauceEffBarrel,
    };
    if (calcStartedAt !== null && typeof performance !== "undefined") {
      recordPerformance("live-calculation", performance.now() - calcStartedAt, "calculation");
    }
    return result;
  }, [v, ve, liveFreezerMin, currentRun, nowTime, doughSubTab]);

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
