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

type MutableStartupState = {
  phase: StartupPhase;
  stage: StartupStage | null;
  startedAtMs: number;
  completedAtMs?: number;
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
};

export function beginStartup(nowMs = Date.now()): void {
  state = {
    phase: "starting",
    stage: null,
    startedAtMs: nowMs,
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
  };
}