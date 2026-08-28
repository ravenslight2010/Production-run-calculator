import type { RunMeta } from "./types";

export type ForegroundStopIntent = {
  action: "stop";
  runId: string;
};

export type ForegroundStopResolution =
  | { kind: "apply"; runId: string }
  | {
      kind: "not-applied";
      reason: "changed" | "paused" | "ended" | "not-started";
    };

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
