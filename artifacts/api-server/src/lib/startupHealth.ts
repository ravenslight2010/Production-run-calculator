export type StartupStage =
  | "database_schema"
  | "seed_roles"
  | "data_heals"
  | "listen";

export type StartupPhase = "starting" | "ready" | "failed";

export type StartupHealthSnapshot = {
  phase: StartupPhase;
  stage: StartupStage | null;
  durationMs: number;
  failure?: {
    stage: StartupStage;
    errorCode: string;
  };
};

export const DEFAULT_STARTUP_WARNING_THRESHOLD_MS = 30_000;
const MAX_STARTUP_WARNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type MutableStartupState = {
  phase: StartupPhase;
  stage: StartupStage | null;
  startedAtMs: number;
  completedAtMs?: number;
  slowWarningEmitted: boolean;
  failure?: {
    stage: StartupStage;
    errorCode: string;
  };
};

// Direct app imports in unit/integration tests do not run index.ts. Treat those
// app-only instances as ready; the production entry point calls beginStartup()
// before it binds the port, so real boots always start in the "starting" phase.
let state: MutableStartupState = {
  phase: "ready",
  stage: null,
  startedAtMs: Date.now(),
  completedAtMs: Date.now(),
  slowWarningEmitted: false,
};

export function getStartupWarningThresholdMs(
  rawValue = process.env.STARTUP_WARNING_THRESHOLD_MS,
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STARTUP_WARNING_THRESHOLD_MS;
  }
  return Math.min(MAX_STARTUP_WARNING_THRESHOLD_MS, Math.max(1, Math.round(parsed)));
}

export function beginStartup(nowMs = Date.now()): void {
  state = {
    phase: "starting",
    stage: null,
    startedAtMs: nowMs,
    slowWarningEmitted: false,
  };
}

export function markStartupStage(stage: StartupStage): void {
  state.stage = stage;
}

export function markStartupReady(nowMs = Date.now()): void {
  state.phase = "ready";
  state.completedAtMs = nowMs;
  state.failure = undefined;
}

export function markStartupFailed(
  stage: StartupStage,
  errorCode: string,
  nowMs = Date.now(),
): void {
  state.phase = "failed";
  state.stage = stage;
  state.completedAtMs = nowMs;
  state.failure = { stage, errorCode };
}

export function claimStartupSlowWarning(
  nowMs = Date.now(),
  thresholdMs = getStartupWarningThresholdMs(),
): boolean {
  if (state.phase !== "starting" || state.slowWarningEmitted) return false;
  if (nowMs - state.startedAtMs < thresholdMs) return false;
  state.slowWarningEmitted = true;
  return true;
}

export function getStartupHealth(nowMs = Date.now()): StartupHealthSnapshot {
  const endMs = state.completedAtMs ?? nowMs;
  return {
    phase: state.phase,
    stage: state.stage,
    durationMs: Math.max(0, endMs - state.startedAtMs),
    ...(state.failure ? { failure: { ...state.failure } } : {}),
  };
}

export function resetStartupHealthForTests(): void {
  state = {
    phase: "ready",
    stage: null,
    startedAtMs: Date.now(),
    completedAtMs: Date.now(),
    slowWarningEmitted: false,
  };
}