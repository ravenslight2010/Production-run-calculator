import {
  createContext,
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
import { computeCasesInFreezer } from "@workspace/inventory-math";
import { useClock } from "../hooks/useClock";
import { useNotifications } from "../hooks/useNotifications";
import { useAutoTrack, suggestedDoughStaging } from "../hooks/useAutoTrack";
import { detectStallFromDelta } from "@workspace/downtime-trends";
import { loadRunValues, saveRunValues, markRunValuesUpdated } from "../storage";
import type { NotificationPrefs } from "../notificationPrefs";

type RunStatus = "pending" | "running" | "paused" | "ended";

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
  fireAutoTrackNow: () => void;
  tickDueRefs: ReturnType<typeof useAutoTrack>["tickDueRefs"];
  stallPrompt: boolean;
  setStallPrompt: React.Dispatch<React.SetStateAction<boolean>>;
  stallCheck: ReturnType<typeof detectStallFromDelta>;
}

// ── Module-level calc ref (readable by Home without subscribing to context) ──
export const calcRef: { current: Calc | null } = { current: null };

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
  v,
  ve,
  form,
  dayState,
  doughSubTab,
  upcomingRunLabels,
  prefs,
  screenMode,
  machine,
  externalAutoSuppressRef,
}: LiveRunProviderProps) {
  const nowTime = useClock(runStatus);

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
    const ppm =
      Math.round(
        (doughSubTab === "crusts"
          ? v.approxLineSpeed
          : ve.crustsPerCycle * ve.cycleSpeed * v.speedAdjustment) * 100,
      ) / 100;

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

    const freezerTime = liveFreezerMin;
    const casesOnLine = ppm > 0 ? Math.floor((ppm * freezerTime) / v.pizzasPerCase) : 0;

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

    const timePressHzSec = ppm > 0 ? (60 / ve.cycleSpeed) / v.speedAdjustment : 0;
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
      paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
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

    return {
      ppm, traysPerSkid, traysPerBatch, batchesPerSkid, casesOnLine, casesInFreezer,
      casesLeftToRun, casesLeftToOpen, stacksNeededTotal, casesForTiming, batchesNeeded,
      traysNeeded, buffer, doughShortCases, doughDepletionSec, casesOnLastSkid,
      timePressHzSec, timePerTraySec, timePerBatchSec, timePerSkidSec, timePerCaseSec,
      totalTimeSec, adjustedTimeSec, pressCasesLeft, pressDone, extraCases, doughMadeTimeSec,
      rackTimes, sauceBatches,
      app1Lbs, app1Batches, app2Lbs, app2Batches, app3Lbs, app3Batches, app4Lbs, app4Batches,
      pep1Lbs, pep1Batches, pep2Lbs, pep2Batches,
      pep1LbsB, pep1BatchesB, pep2LbsB, pep2BatchesB,
      casesCompleted, paceStatus, paceDelta, catchUpPpm,
      perTray, perBatch, sauceEffBarrel,
    };
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

  // ── Notifications ────────────────────────────────────────────────────────
  const { showBatchDue, setShowBatchDue } = useNotifications({
    runStatus,
    nowTime,
    currentRun,
    calc,
    v: ve,
    isCrust: doughSubTab === "crusts",
    nextRunLabels: upcomingRunLabels,
    prefs,
  });

  // ── Stall detection ───────────────────────────────────────────────────────
  const stallCheck = detectStallFromDelta({
    running: !!currentRun?.startedAt && !currentRun?.endedAt && !currentRun?.pausedAt,
    hasOpenStoppage: (currentRun?.stoppages ?? []).some(s => !s.endedAt),
    ppm: calc.ppm,
    pizzasPerCase: v.pizzasPerCase,
    paceDelta: calc.paceDelta,
  });
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
  const { autoTrackProgress, setAutoTrackProgress, autoTrackSuggestion, autoSuppressUntilRef, fireAutoTrackNow, tickDueRefs } =
    useAutoTrack({
      runId: currentRunId,
      runStatus,
      endedAt: currentRun?.endedAt ?? null,
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
    });

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

  const value: LiveRunContextValue = {
    nowTime, calc, liveFreezerMin, elapsedBatchSec, currentRunDowntimeMs,
    casesPct, casesFreezerPct, casesPctWithFreezer,
    currentBatchNum, secUntilNextBatch, totalBatchesNeeded,
    showBatchDue, setShowBatchDue,
    autoTrackProgress, setAutoTrackProgress,
    autoTrackSuggestion, autoSuppressUntilRef, fireAutoTrackNow, tickDueRefs,
    stallPrompt, setStallPrompt, stallCheck,
  };

  return <LiveRunContext.Provider value={value}>{children}</LiveRunContext.Provider>;
}
