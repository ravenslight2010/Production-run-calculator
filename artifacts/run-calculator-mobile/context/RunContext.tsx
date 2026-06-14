import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "run-calc-mobile-v2";

export interface RunSettings {
  brand: string;
  flavor: string;
  dieType: string;
  casesNeeded: number;
  pizzasPerCase: number;
  casesPerSkid: number;
  casesPerLayer: number;
  // Line speed: computed = crustsPerCycle * cycleSpeed * speedAdjustment
  // If crustsPerCycle === 0, lineSpeedPPM is used directly
  lineSpeedPPM: number;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  // Sauce
  sauceOzPerPizza: number;
  sauceBarrelLbs: number;
  // Applicators 1–4
  app1Type: string;
  app1OzPerPizza: number;
  app1BatchLbs: number;
  app2Type: string;
  app2OzPerPizza: number;
  app2BatchLbs: number;
  app3Type: string;
  app3OzPerPizza: number;
  app3BatchLbs: number;
  app4Type: string;
  app4OzPerPizza: number;
  app4BatchLbs: number;
  // Pepperoni 1–2
  pep1Type: string;
  pep1OzPerPizza: number;
  pep1Sticks: number;
  pep1BatchLbs: number;
  pep2Type: string;
  pep2OzPerPizza: number;
  pep2Sticks: number;
  pep2BatchLbs: number;
  // Dough
  doughBatchLbs: number;
  doughballWeightOz: number;
  // Notes
  notes: string;
}

export interface RunProgress {
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  traysOnLine: number;
  batchesReady: number;
  carryOverDone: boolean;
}

export interface Stoppage {
  id: string;
  type: "jam" | "changeover" | "break" | "other";
  startedAt: number;
  endedAt?: number;
  reason?: string;
}

export interface RunState {
  id: string;
  settings: RunSettings;
  progress: RunProgress;
  stoppages: Stoppage[];
  startedAt?: number;
  endedAt?: number;
  isRunning: boolean;
}

export interface RunCalc {
  casesLeft: number;
  pizzasLeft: number;
  ppm: number;
  minutesRemaining: number | null;
  estCompletionMs: number | null;
  sauceLbs: number;
  sauceBatches: number;
  app1Lbs: number;
  app1Batches: number;
  app2Lbs: number;
  app2Batches: number;
  app3Lbs: number;
  app3Batches: number;
  app4Lbs: number;
  app4Batches: number;
  pep1Lbs: number;
  pep1Batches: number;
  pep2Lbs: number;
  pep2Batches: number;
  doughLbs: number;
  doughBatches: number;
  totalDowntimeSec: number;
  netElapsedSec: number;
}

const DEFAULT_SETTINGS: RunSettings = {
  brand: "",
  flavor: "",
  dieType: "",
  casesNeeded: 0,
  pizzasPerCase: 12,
  casesPerSkid: 48,
  casesPerLayer: 6,
  lineSpeedPPM: 0,
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  sauceOzPerPizza: 0,
  sauceBarrelLbs: 0,
  app1Type: "",
  app1OzPerPizza: 0,
  app1BatchLbs: 0,
  app2Type: "",
  app2OzPerPizza: 0,
  app2BatchLbs: 0,
  app3Type: "",
  app3OzPerPizza: 0,
  app3BatchLbs: 0,
  app4Type: "",
  app4OzPerPizza: 0,
  app4BatchLbs: 0,
  pep1Type: "",
  pep1OzPerPizza: 0,
  pep1Sticks: 0,
  pep1BatchLbs: 25,
  pep2Type: "",
  pep2OzPerPizza: 0,
  pep2Sticks: 0,
  pep2BatchLbs: 25,
  doughBatchLbs: 0,
  doughballWeightOz: 0,
  notes: "",
};

const DEFAULT_PROGRESS: RunProgress = {
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  carryOverDone: false,
};

export function runLabel(r: RunState, index: number): string {
  const { brand, flavor } = r.settings;
  if (brand && flavor) return `${brand} – ${flavor}`;
  if (brand) return brand;
  if (flavor) return flavor;
  return `Run ${index + 1}`;
}

function makeNewRun(): RunState {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    settings: { ...DEFAULT_SETTINGS },
    progress: { ...DEFAULT_PROGRESS },
    stoppages: [],
    isRunning: false,
  };
}

// Freeze a run at a time boundary so archived history is immutable: stop the
// clock, close any open stoppages, and clear the running flag.
function closeOutRun(run: RunState, boundaryMs: number): RunState {
  return {
    ...run,
    isRunning: false,
    endedAt: run.endedAt ?? (run.startedAt != null ? boundaryMs : undefined),
    stoppages: run.stoppages.map((s) =>
      s.endedAt == null ? { ...s, endedAt: boundaryMs } : s,
    ),
  };
}

export function computeCalc(state: RunState, nowMs: number): RunCalc {
  const { settings: s, progress: p } = state;

  const casesLeft = Math.max(
    0,
    s.casesNeeded -
      p.skidsCompleted * s.casesPerSkid -
      p.casesOnCurrentSkid,
  );
  const pizzasLeft = casesLeft * s.pizzasPerCase;

  // PPM: prefer machine params; fall back to direct entry
  const computedPPM = s.crustsPerCycle > 0 && s.cycleSpeed > 0
    ? s.crustsPerCycle * s.cycleSpeed * s.speedAdjustment
    : s.lineSpeedPPM;
  const ppm = computedPPM;

  let minutesRemaining: number | null = null;
  let estCompletionMs: number | null = null;
  if (ppm > 0) {
    minutesRemaining = pizzasLeft > 0 ? pizzasLeft / ppm : 0;
    estCompletionMs = nowMs + minutesRemaining * 60 * 1000;
  }

  // Ingredient calculations (matching web formula: include buffer layer)
  const bufferPizzas = s.casesPerLayer * s.pizzasPerCase;
  const pizzasForIngredients = pizzasLeft + bufferPizzas;

  const sauceLbs =
    s.sauceOzPerPizza > 0
      ? (pizzasForIngredients * s.sauceOzPerPizza) / 16 + 30
      : 0;
  const sauceBatches =
    sauceLbs > 0 && s.sauceBarrelLbs > 0
      ? Math.ceil(sauceLbs / s.sauceBarrelLbs)
      : 0;

  const app1Lbs =
    s.app1Type && s.app1OzPerPizza > 0
      ? (pizzasForIngredients * s.app1OzPerPizza) / 16 + 20
      : 0;
  const app1Batches =
    app1Lbs > 0 && s.app1BatchLbs > 0 ? Math.ceil(app1Lbs / s.app1BatchLbs) : 0;

  const app2Lbs =
    s.app2Type && s.app2OzPerPizza > 0
      ? (pizzasForIngredients * s.app2OzPerPizza) / 16 + 20
      : 0;
  const app2Batches =
    app2Lbs > 0 && s.app2BatchLbs > 0 ? Math.ceil(app2Lbs / s.app2BatchLbs) : 0;

  const app3Lbs =
    s.app3Type && s.app3OzPerPizza > 0
      ? (pizzasForIngredients * s.app3OzPerPizza) / 16 + 20
      : 0;
  const app3Batches =
    app3Lbs > 0 && s.app3BatchLbs > 0 ? Math.ceil(app3Lbs / s.app3BatchLbs) : 0;

  const app4Lbs =
    s.app4Type && s.app4OzPerPizza > 0
      ? (pizzasForIngredients * s.app4OzPerPizza) / 16 + 20
      : 0;
  const app4Batches =
    app4Lbs > 0 && s.app4BatchLbs > 0 ? Math.ceil(app4Lbs / s.app4BatchLbs) : 0;

  // Pepperoni: lbs = (pizzas * oz/pizza) / 16 + sticks (flat buffer)
  const pep1Lbs =
    s.pep1Type && s.pep1OzPerPizza > 0
      ? (pizzasForIngredients * s.pep1OzPerPizza) / 16 + s.pep1Sticks
      : 0;
  const pep1Batches =
    pep1Lbs > 0 && s.pep1BatchLbs > 0 ? Math.ceil(pep1Lbs / s.pep1BatchLbs) : 0;

  const pep2Lbs =
    s.pep2Type && s.pep2OzPerPizza > 0
      ? (pizzasForIngredients * s.pep2OzPerPizza) / 16 + s.pep2Sticks
      : 0;
  const pep2Batches =
    pep2Lbs > 0 && s.pep2BatchLbs > 0 ? Math.ceil(pep2Lbs / s.pep2BatchLbs) : 0;

  // Dough
  const doughLbs =
    s.doughballWeightOz > 0
      ? (pizzasLeft * s.doughballWeightOz) / 16
      : 0;
  const doughBatches =
    doughLbs > 0 && s.doughBatchLbs > 0 ? Math.ceil(doughLbs / s.doughBatchLbs) : 0;

  // Time boundary: a finished run's clock stops at endedAt; otherwise "now".
  const boundaryMs = state.endedAt ?? nowMs;

  // Downtime
  const completedStoppages = state.stoppages.filter((s) => s.endedAt != null);
  const activeStoppage = state.stoppages.find((s) => s.endedAt == null);
  const completedDowntimeSec = completedStoppages.reduce(
    (acc, s) => acc + (s.endedAt! - s.startedAt) / 1000,
    0,
  );
  // An open stoppage only accrues up to the run's boundary (now, or end time).
  const activeDowntimeSec = activeStoppage
    ? Math.max(0, (boundaryMs - activeStoppage.startedAt) / 1000)
    : 0;
  const totalDowntimeSec = completedDowntimeSec + activeDowntimeSec;
  const grossElapsedSec = state.startedAt
    ? Math.max(0, (boundaryMs - state.startedAt) / 1000)
    : 0;
  const netElapsedSec = Math.max(0, grossElapsedSec - totalDowntimeSec);

  return {
    casesLeft,
    pizzasLeft,
    ppm,
    minutesRemaining,
    estCompletionMs,
    sauceLbs,
    sauceBatches,
    app1Lbs,
    app1Batches,
    app2Lbs,
    app2Batches,
    app3Lbs,
    app3Batches,
    app4Lbs,
    app4Batches,
    pep1Lbs,
    pep1Batches,
    pep2Lbs,
    pep2Batches,
    doughLbs,
    doughBatches,
    totalDowntimeSec,
    netElapsedSec,
  };
}

export const DEFAULT_DIE_TYPES = ["7in", "11in", "12in", "Argus", "Mystic"];

export interface RunTemplate {
  id: string;
  name: string;
  settings: RunSettings;
  createdAt: number;
}

export interface HistoryDay {
  date: string;
  runs: RunState[];
}

const MAX_TEMPLATES = 20;
const MAX_HISTORY_DAYS = 14;

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

interface AppState {
  runs: RunState[];
  currentIndex: number;
  shiftNotes: string;
  date: string;
  templates: RunTemplate[];
  history: HistoryDay[];
  autoTrack: boolean;
}

interface RunContextValue {
  run: RunState;
  runIndex: number;
  runCount: number;
  allRuns: RunState[];
  calc: RunCalc;
  tick: number;
  activeStoppage: Stoppage | null;
  updateSettings: (partial: Partial<RunSettings>) => void;
  updateProgress: (partial: Partial<RunProgress>) => void;
  startRun: () => void;
  endRun: () => void;
  addStoppage: (type: Stoppage["type"], reason?: string) => void;
  endActiveStoppage: () => void;
  addRun: () => void;
  switchRun: (index: number) => void;
  deleteRun: (index: number) => void;
  resetRun: () => void;
  shiftNotes: string;
  setShiftNotes: (notes: string) => void;
  templates: RunTemplate[];
  history: HistoryDay[];
  saveTemplate: (name: string) => void;
  applyTemplate: (id: string) => void;
  deleteTemplate: (id: string) => void;
  autoTrack: boolean;
  setAutoTrack: (on: boolean) => void;
  suppressAutoTrack: () => void;
}

const RunContext = createContext<RunContextValue | null>(null);

const INITIAL_STATE: AppState = {
  runs: [makeNewRun()],
  currentIndex: 0,
  shiftNotes: "",
  date: todayStr(),
  templates: [],
  history: [],
  autoTrack: true,
};

export function RunContextProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<AppState>(INITIAL_STATE);
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoBucketRef = useRef<number>(-1);
  const autoSuppressRef = useRef<number>(0);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as AppState;
          if (parsed.runs && parsed.runs.length > 0) {
            const today = todayStr();
            const templates = parsed.templates ?? [];
            const history = parsed.history ?? [];
            if (parsed.date && parsed.date !== today) {
              // Calendar day rolled over: archive the prior day's runs,
              // frozen at the prior day's end so history is immutable.
              const boundaryMs = new Date(`${today}T00:00:00`).getTime();
              const archived: HistoryDay = {
                date: parsed.date,
                runs: parsed.runs.map((r) => closeOutRun(r, boundaryMs)),
              };
              const next: AppState = {
                runs: [makeNewRun()],
                currentIndex: 0,
                shiftNotes: "",
                date: today,
                templates,
                history: [
                  archived,
                  ...history.filter((h) => h.date !== parsed.date),
                ].slice(0, MAX_HISTORY_DAYS),
                autoTrack: parsed.autoTrack ?? true,
              };
              setAppState(next);
              AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } else {
              setAppState({
                ...parsed,
                shiftNotes: parsed.shiftNotes ?? "",
                date: parsed.date ?? today,
                templates,
                history,
                autoTrack: parsed.autoTrack ?? true,
              });
            }
          }
        } catch {
          /* corrupt, keep defaults */
        }
      }
    });
  }, []);

  const persist = useCallback((state: AppState) => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, 400);
  }, []);

  const currentRun = appState.runs[appState.currentIndex];

  useEffect(() => {
    if (currentRun?.isRunning) {
      timerRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentRun?.isRunning]);

  const updateCurrentRun = useCallback(
    (updater: (prev: RunState) => RunState) => {
      setAppState((prev) => {
        const runs = [...prev.runs];
        runs[prev.currentIndex] = updater(runs[prev.currentIndex]);
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateSettings = useCallback(
    (partial: Partial<RunSettings>) =>
      updateCurrentRun((r) => ({ ...r, settings: { ...r.settings, ...partial } })),
    [updateCurrentRun],
  );

  const updateProgress = useCallback(
    (partial: Partial<RunProgress>) =>
      updateCurrentRun((r) => ({ ...r, progress: { ...r.progress, ...partial } })),
    [updateCurrentRun],
  );

  const startRun = useCallback(
    () =>
      updateCurrentRun((r) => ({
        ...r,
        isRunning: true,
        startedAt: r.startedAt ?? Date.now(),
        endedAt: undefined,
      })),
    [updateCurrentRun],
  );

  const endRun = useCallback(
    () => updateCurrentRun((r) => ({ ...r, isRunning: false, endedAt: Date.now() })),
    [updateCurrentRun],
  );

  const addStoppage = useCallback(
    (type: Stoppage["type"], reason?: string) => {
      const s: Stoppage = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        type,
        startedAt: Date.now(),
        reason,
      };
      updateCurrentRun((r) => ({ ...r, stoppages: [...r.stoppages, s] }));
    },
    [updateCurrentRun],
  );

  const endActiveStoppage = useCallback(
    () =>
      updateCurrentRun((r) => ({
        ...r,
        stoppages: r.stoppages.map((s) =>
          s.endedAt == null ? { ...s, endedAt: Date.now() } : s,
        ),
      })),
    [updateCurrentRun],
  );

  const addRun = useCallback(() => {
    setAppState((prev) => {
      const newRun = makeNewRun();
      const runs = [...prev.runs, newRun];
      const next = { ...prev, runs, currentIndex: runs.length - 1 };
      persist(next);
      return next;
    });
  }, [persist]);

  const switchRun = useCallback(
    (index: number) => {
      setAppState((prev) => {
        if (index < 0 || index >= prev.runs.length) return prev;
        const next = { ...prev, currentIndex: index };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const deleteRun = useCallback(
    (index: number) => {
      setAppState((prev) => {
        if (prev.runs.length <= 1) return prev;
        const runs = prev.runs.filter((_, i) => i !== index);
        const currentIndex = Math.min(prev.currentIndex, runs.length - 1);
        const next = { ...prev, runs, currentIndex };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const resetRun = useCallback(() => {
    updateCurrentRun(() => makeNewRun());
  }, [updateCurrentRun]);

  const setShiftNotes = useCallback(
    (notes: string) => {
      setAppState((prev) => {
        const next = { ...prev, shiftNotes: notes };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const saveTemplate = useCallback(
    (name: string) => {
      setAppState((prev) => {
        const cur = prev.runs[prev.currentIndex];
        const tpl: RunTemplate = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: name.trim() || `Template ${prev.templates.length + 1}`,
          settings: { ...cur.settings },
          createdAt: Date.now(),
        };
        const next = {
          ...prev,
          templates: [tpl, ...prev.templates].slice(0, MAX_TEMPLATES),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const applyTemplate = useCallback(
    (id: string) => {
      setAppState((prev) => {
        const tpl = prev.templates.find((t) => t.id === id);
        if (!tpl) return prev;
        const runs = [...prev.runs];
        runs[prev.currentIndex] = {
          ...runs[prev.currentIndex],
          settings: { ...tpl.settings },
        };
        const next = { ...prev, runs };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      setAppState((prev) => {
        const next = {
          ...prev,
          templates: prev.templates.filter((t) => t.id !== id),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setAutoTrack = useCallback(
    (on: boolean) => {
      setAppState((prev) => {
        const next = { ...prev, autoTrack: on };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const suppressAutoTrack = useCallback(() => {
    autoSuppressRef.current = Date.now() + 10 * 60 * 1000;
  }, []);

  // Reset the bucket marker whenever the active run changes or its running state
  // flips, so the next auto-track write fires immediately instead of being
  // blocked until the next wall-clock bucket boundary.
  useEffect(() => {
    autoBucketRef.current = -1;
  }, [currentRun?.id, currentRun?.isRunning]);

  // Auto-track: once per 5-minute bucket while running, derive skids completed
  // and cases on the current skid from expected output (net elapsed × ppm).
  // Suppressed for 10 minutes after the user manually edits either stepper, so
  // it never fights a supervisor who is taking over. Tray/batch are not auto-
  // tracked because the mobile model has no per-tray/per-batch consumption rate.
  useEffect(() => {
    if (!appState.autoTrack) return;
    const r = appState.runs[appState.currentIndex];
    if (!r?.isRunning) return;
    if (Date.now() < autoSuppressRef.current) return;
    const c = computeCalc(r, Date.now());
    if (
      c.ppm <= 0 ||
      r.settings.casesPerSkid <= 0 ||
      r.settings.pizzasPerCase <= 0
    )
      return;
    const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
    if (bucket === autoBucketRef.current) return;
    autoBucketRef.current = bucket;

    const expectedCases = Math.floor(
      ((c.netElapsedSec / 60) * c.ppm) / r.settings.pizzasPerCase,
    );
    const maxSkids =
      r.settings.casesNeeded > 0
        ? Math.floor(r.settings.casesNeeded / r.settings.casesPerSkid)
        : Number.MAX_SAFE_INTEGER;
    const skids = Math.min(
      maxSkids,
      Math.floor(expectedCases / r.settings.casesPerSkid),
    );
    const casesOnSkid = Math.min(
      r.settings.casesPerSkid,
      expectedCases % r.settings.casesPerSkid,
    );
    if (
      skids !== r.progress.skidsCompleted ||
      casesOnSkid !== r.progress.casesOnCurrentSkid
    ) {
      updateProgress({ skidsCompleted: skids, casesOnCurrentSkid: casesOnSkid });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const activeStoppage = currentRun?.stoppages.find((s) => s.endedAt == null) ?? null;
  const calc = computeCalc(currentRun ?? makeNewRun(), Date.now());

  return (
    <RunContext.Provider
      value={{
        run: currentRun,
        runIndex: appState.currentIndex,
        runCount: appState.runs.length,
        allRuns: appState.runs,
        calc,
        tick,
        activeStoppage,
        updateSettings,
        updateProgress,
        startRun,
        endRun,
        addStoppage,
        endActiveStoppage,
        addRun,
        switchRun,
        deleteRun,
        resetRun,
        shiftNotes: appState.shiftNotes,
        setShiftNotes,
        templates: appState.templates,
        history: appState.history,
        saveTemplate,
        applyTemplate,
        deleteTemplate,
        autoTrack: appState.autoTrack,
        setAutoTrack,
        suppressAutoTrack,
      }}
    >
      {children}
    </RunContext.Provider>
  );
}

export function useRun() {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error("useRun must be used within RunContextProvider");
  return ctx;
}
