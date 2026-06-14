import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "run-calc-mobile-v1";

export interface RunSettings {
  casesNeeded: number;
  pizzasPerCase: number;
  casesPerSkid: number;
  lineSpeedPPM: number;
  sauceOzPerPizza: number;
  sauceBarrelLbs: number;
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
  doughBatchLbs: number;
  doughballWeightOz: number;
}

export interface RunProgress {
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  batchesReady: number;
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
  label: string;
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
  doughLbs: number;
  doughBatches: number;
  totalDowntimeSec: number;
  netElapsedSec: number;
}

const DEFAULT_SETTINGS: RunSettings = {
  casesNeeded: 0,
  pizzasPerCase: 12,
  casesPerSkid: 48,
  lineSpeedPPM: 0,
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
  doughBatchLbs: 0,
  doughballWeightOz: 0,
};

function makeNewRun(): RunState {
  return {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
    label: "Run 1",
    settings: { ...DEFAULT_SETTINGS },
    progress: { skidsCompleted: 0, casesOnCurrentSkid: 0, batchesReady: 0 },
    stoppages: [],
    isRunning: false,
  };
}

function computeCalc(state: RunState, nowMs: number): RunCalc {
  const { settings, progress } = state;

  const casesLeft = Math.max(
    0,
    settings.casesNeeded -
      progress.skidsCompleted * settings.casesPerSkid -
      progress.casesOnCurrentSkid,
  );
  const pizzasLeft = casesLeft * settings.pizzasPerCase;
  const ppm = settings.lineSpeedPPM;

  let minutesRemaining: number | null = null;
  let estCompletionMs: number | null = null;
  if (ppm > 0) {
    minutesRemaining = pizzasLeft > 0 ? pizzasLeft / ppm : 0;
    estCompletionMs = nowMs + minutesRemaining * 60 * 1000;
  }

  const sauceLbs =
    settings.sauceOzPerPizza > 0 ? (pizzasLeft * settings.sauceOzPerPizza) / 16 : 0;
  const sauceBatches =
    sauceLbs > 0 && settings.sauceBarrelLbs > 0
      ? Math.ceil(sauceLbs / settings.sauceBarrelLbs)
      : 0;

  const app1Lbs =
    settings.app1Type && settings.app1OzPerPizza > 0
      ? (pizzasLeft * settings.app1OzPerPizza) / 16
      : 0;
  const app1Batches =
    app1Lbs > 0 && settings.app1BatchLbs > 0
      ? Math.ceil(app1Lbs / settings.app1BatchLbs)
      : 0;

  const app2Lbs =
    settings.app2Type && settings.app2OzPerPizza > 0
      ? (pizzasLeft * settings.app2OzPerPizza) / 16
      : 0;
  const app2Batches =
    app2Lbs > 0 && settings.app2BatchLbs > 0
      ? Math.ceil(app2Lbs / settings.app2BatchLbs)
      : 0;

  const app3Lbs =
    settings.app3Type && settings.app3OzPerPizza > 0
      ? (pizzasLeft * settings.app3OzPerPizza) / 16
      : 0;
  const app3Batches =
    app3Lbs > 0 && settings.app3BatchLbs > 0
      ? Math.ceil(app3Lbs / settings.app3BatchLbs)
      : 0;

  const app4Lbs =
    settings.app4Type && settings.app4OzPerPizza > 0
      ? (pizzasLeft * settings.app4OzPerPizza) / 16
      : 0;
  const app4Batches =
    app4Lbs > 0 && settings.app4BatchLbs > 0
      ? Math.ceil(app4Lbs / settings.app4BatchLbs)
      : 0;

  const doughLbs =
    settings.doughballWeightOz > 0
      ? (pizzasLeft * settings.doughballWeightOz) / 16
      : 0;
  const doughBatches =
    doughLbs > 0 && settings.doughBatchLbs > 0
      ? Math.ceil(doughLbs / settings.doughBatchLbs)
      : 0;

  const completedStoppages = state.stoppages.filter((s) => s.endedAt != null);
  const activeStoppage = state.stoppages.find((s) => s.endedAt == null);
  const completedDowntimeSec = completedStoppages.reduce(
    (acc, s) => acc + (s.endedAt! - s.startedAt) / 1000,
    0,
  );
  const activeDowntimeSec = activeStoppage
    ? (nowMs - activeStoppage.startedAt) / 1000
    : 0;
  const totalDowntimeSec = completedDowntimeSec + activeDowntimeSec;
  const grossElapsedSec = state.startedAt
    ? (nowMs - state.startedAt) / 1000
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
    doughLbs,
    doughBatches,
    totalDowntimeSec,
    netElapsedSec,
  };
}

interface RunContextValue {
  run: RunState;
  calc: RunCalc;
  tick: number;
  activeStoppage: Stoppage | null;
  updateSettings: (partial: Partial<RunSettings>) => void;
  updateProgress: (partial: Partial<RunProgress>) => void;
  updateLabel: (label: string) => void;
  startRun: () => void;
  endRun: () => void;
  addStoppage: (type: Stoppage["type"], reason?: string) => void;
  endActiveStoppage: () => void;
  resetRun: () => void;
}

const RunContext = createContext<RunContextValue | null>(null);

export function RunContextProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<RunState>(makeNewRun());
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setRun(JSON.parse(raw) as RunState);
        } catch {
          /* corrupt, use defaults */
        }
      }
    });
  }, []);

  const persist = useCallback((state: RunState) => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, 400);
  }, []);

  useEffect(() => {
    if (run.isRunning) {
      timerRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [run.isRunning]);

  const update = useCallback(
    (updater: (prev: RunState) => RunState) => {
      setRun((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateSettings = useCallback(
    (partial: Partial<RunSettings>) =>
      update((p) => ({ ...p, settings: { ...p.settings, ...partial } })),
    [update],
  );

  const updateProgress = useCallback(
    (partial: Partial<RunProgress>) =>
      update((p) => ({ ...p, progress: { ...p.progress, ...partial } })),
    [update],
  );

  const updateLabel = useCallback(
    (label: string) => update((p) => ({ ...p, label })),
    [update],
  );

  const startRun = useCallback(
    () =>
      update((p) => ({
        ...p,
        isRunning: true,
        startedAt: p.startedAt ?? Date.now(),
      })),
    [update],
  );

  const endRun = useCallback(
    () => update((p) => ({ ...p, isRunning: false, endedAt: Date.now() })),
    [update],
  );

  const addStoppage = useCallback(
    (type: Stoppage["type"], reason?: string) => {
      const s: Stoppage = {
        id:
          Date.now().toString() +
          Math.random().toString(36).substring(2, 5),
        type,
        startedAt: Date.now(),
        reason,
      };
      update((p) => ({ ...p, stoppages: [...p.stoppages, s] }));
    },
    [update],
  );

  const endActiveStoppage = useCallback(
    () =>
      update((p) => ({
        ...p,
        stoppages: p.stoppages.map((s) =>
          s.endedAt == null ? { ...s, endedAt: Date.now() } : s,
        ),
      })),
    [update],
  );

  const resetRun = useCallback(() => {
    const fresh = makeNewRun();
    setRun(fresh);
    persist(fresh);
  }, [persist]);

  const activeStoppage = run.stoppages.find((s) => s.endedAt == null) ?? null;
  const calc = computeCalc(run, Date.now());

  return (
    <RunContext.Provider
      value={{
        run,
        calc,
        tick,
        activeStoppage,
        updateSettings,
        updateProgress,
        updateLabel,
        startRun,
        endRun,
        addStoppage,
        endActiveStoppage,
        resetRun,
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
