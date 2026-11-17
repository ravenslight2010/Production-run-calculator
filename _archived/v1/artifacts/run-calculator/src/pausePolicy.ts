import type { Stoppage } from "./types";

/** The operator has ten seconds to override the safe stop-tunnel default. */
export const PAUSE_DECISION_TIMEOUT_MS = 10_000;

/**
 * Legacy pause records predate the policy field. Treating an absent value as
 * `true` keeps old paused runs safe after a reload or on another tablet.
 */
export function pauseStopsTunnel(
  stoppage: Pick<Stoppage, "stopTunnel"> | null | undefined,
): boolean {
  return stoppage?.stopTunnel !== false;
}

/** A display-only countdown; persistence never depends on this reaching zero. */
export function pauseDecisionRemainingMs(pausedAt: number, nowMs: number): number {
  return Math.max(0, PAUSE_DECISION_TIMEOUT_MS - Math.max(0, nowMs - pausedAt));
}

/**
 * UI prompt lifecycle only. The policy has already been persisted safely before
 * this is consulted, so hiding/waking a screen cannot alter a chosen policy.
 */
export function shouldClosePauseDecision(
  pausedAt: number,
  nowMs: number,
  isVisible: boolean,
): boolean {
  return !isVisible || pauseDecisionRemainingMs(pausedAt, nowMs) === 0;
}

/** Prevent a late click from overriding the persisted safe default. */
export function canChoosePauseTunnelPolicy(pausedAt: number, nowMs: number): boolean {
  return pauseDecisionRemainingMs(pausedAt, nowMs) > 0;
}