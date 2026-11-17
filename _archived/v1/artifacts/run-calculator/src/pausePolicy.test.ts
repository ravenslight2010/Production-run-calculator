import { describe, expect, it } from "vitest";
import {
  PAUSE_DECISION_TIMEOUT_MS,
  canChoosePauseTunnelPolicy,
  pauseDecisionRemainingMs,
  pauseStopsTunnel,
  shouldClosePauseDecision,
} from "./pausePolicy";

describe("pause tunnel policy", () => {
  it("defaults missing persisted policy to the safe stop-tunnel choice after reload or sync", () => {
    expect(pauseStopsTunnel(undefined)).toBe(true);
    expect(pauseStopsTunnel({ stopTunnel: undefined })).toBe(true);
    expect(pauseStopsTunnel({ stopTunnel: true })).toBe(true);
  });

  it("retains an explicit No policy from a synced pause record", () => {
    expect(pauseStopsTunnel({ stopTunnel: false })).toBe(false);
  });

  it("counts down from ten seconds and expires exactly at the decision deadline", () => {
    const pausedAt = 1_700_000_000_000;

    expect(pauseDecisionRemainingMs(pausedAt, pausedAt)).toBe(PAUSE_DECISION_TIMEOUT_MS);
    expect(pauseDecisionRemainingMs(pausedAt, pausedAt + 9_001)).toBe(999);
    expect(pauseDecisionRemainingMs(pausedAt, pausedAt + PAUSE_DECISION_TIMEOUT_MS)).toBe(0);
    expect(shouldClosePauseDecision(pausedAt, pausedAt + PAUSE_DECISION_TIMEOUT_MS, true)).toBe(true);
    expect(canChoosePauseTunnelPolicy(pausedAt, pausedAt + PAUSE_DECISION_TIMEOUT_MS - 1)).toBe(true);
    expect(canChoosePauseTunnelPolicy(pausedAt, pausedAt + PAUSE_DECISION_TIMEOUT_MS)).toBe(false);
  });

  it("closes the local prompt on a hidden screen without changing the persisted safe default", () => {
    const pausedAt = 1_700_000_000_000;
    expect(shouldClosePauseDecision(pausedAt, pausedAt + 1_000, false)).toBe(true);
    // A reload or screen wake derives the same policy from the saved pause.
    expect(pauseStopsTunnel({ stopTunnel: true })).toBe(true);
  });
});