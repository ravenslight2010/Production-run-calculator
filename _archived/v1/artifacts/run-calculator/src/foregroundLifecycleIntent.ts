import type { RunMeta } from "./types";

export type ForegroundStopIntent = {
  action: "stop";
  runId: string;
};

export type ForegroundRunControlIntent = {
  action: "pause" | "resume";
  runId: string;
};

export type ForegroundRunControlResolution =
  | { kind: "apply"; action: ForegroundRunControlIntent["action"]; runId: string }
  | { kind: "already-applied"; action: ForegroundRunControlIntent["action"]; runId: string }
  | { kind: "not-applied"; reason: "changed" | "ended" | "not-started" };

export type ForegroundStopResolution =
  | { kind: "apply"; runId: string }
  | {
      kind: "not-applied";
      reason: "changed" | "paused" | "ended" | "not-started";
    };

export type EndRunRoute = "online-consume" | "offline-intent";

/** Fail closed to the durable offline path when browser connectivity is absent or unavailable. */
export function resolveEndRunRoute(online: boolean | undefined): EndRunRoute {
  return online === true ? "online-consume" : "offline-intent";
}

export function browserIsOnline(
  browserNavigator: Pick<Navigator, "onLine"> | null | undefined =
    typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  return resolveEndRunRoute(browserNavigator?.onLine) === "online-consume";
}

/**
 * Resolve a Stop request against the run that was displayed when the operator
 * tapped it. This deliberately does not search for another running run:
 * recovery must never redirect a lifecycle command after a remote switch.
 */
export function resolveForegroundStopIntent(
  intent: ForegroundStopIntent,
  displayedRunId: string | undefined,
  displayedRun: RunMeta | undefined,
): ForegroundStopResolution {
  if (!displayedRun || displayedRunId !== intent.runId || displayedRun.id !== intent.runId) {
    return { kind: "not-applied", reason: "changed" };
  }
  if (displayedRun.endedAt) return { kind: "not-applied", reason: "ended" };
  if (displayedRun.pausedAt) return { kind: "not-applied", reason: "paused" };
  if (!displayedRun.startedAt) return { kind: "not-applied", reason: "not-started" };
  return { kind: "apply", runId: intent.runId };
}

/**
 * Resolve a Pause/Resume request against the run visible when it was tapped.
 * A peer may already have completed the requested transition; never redirect
 * the request to a different current run after wake adoption.
 */
export function resolveForegroundRunControlIntent(
  intent: ForegroundRunControlIntent,
  displayedRunId: string | undefined,
  displayedRun: RunMeta | undefined,
): ForegroundRunControlResolution {
  if (!displayedRun || displayedRunId !== intent.runId || displayedRun.id !== intent.runId) {
    return { kind: "not-applied", reason: "changed" };
  }
  if (displayedRun.endedAt) return { kind: "not-applied", reason: "ended" };
  if (!displayedRun.startedAt) return { kind: "not-applied", reason: "not-started" };

  const isPaused = !!displayedRun.pausedAt;
  if (intent.action === "pause") {
    return isPaused
      ? { kind: "already-applied", action: intent.action, runId: intent.runId }
      : { kind: "apply", action: intent.action, runId: intent.runId };
  }
  return isPaused
    ? { kind: "apply", action: intent.action, runId: intent.runId }
    : { kind: "already-applied", action: intent.action, runId: intent.runId };
}