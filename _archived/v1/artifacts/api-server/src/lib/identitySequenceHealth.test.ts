import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentitySequenceHealthResult } from "@workspace/db/identity-sequence-health";
import {
  IDENTITY_SEQUENCE_HEALTH_INTERVAL_MS,
  IDENTITY_SEQUENCE_HEALTH_STARTUP_DELAY_MS,
  startIdentitySequenceHealthScheduler,
} from "./identitySequenceHealth";

const cleanResult: IdentitySequenceHealthResult = {
  checked: 37,
  driftedCount: 0,
  driftedTargets: [],
  targetsTruncated: false,
  hadDrift: false,
  warningStarted: false,
  warningCleared: false,
};

describe("identity sequence health scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("checks on startup delay and then at a bounded maintenance cadence", async () => {
    vi.useFakeTimers();
    const runCheck = vi.fn(async () => cleanResult);
    const scheduler = startIdentitySequenceHealthScheduler({
      runCheck,
      startupDelayMs: 1_000,
      intervalMs: 60 * 60 * 1000,
      log: { info: vi.fn(), warn: vi.fn() },
    });
    try {
      await vi.advanceTimersByTimeAsync(999);
      expect(runCheck).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(runCheck).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(runCheck).toHaveBeenCalledTimes(2);
    } finally {
      scheduler.stop();
    }
    expect(IDENTITY_SEQUENCE_HEALTH_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(IDENTITY_SEQUENCE_HEALTH_STARTUP_DELAY_MS).toBe(10_000);
  });

  it("logs sanitized warning and recovery transitions, not repeated drift samples", async () => {
    vi.useFakeTimers();
    const result = (hadDrift: boolean, warningStarted: boolean, warningCleared: boolean) => ({
      checked: 37,
      driftedCount: hadDrift ? 1 : 0,
      driftedTargets: hadDrift ? ["audit_logs.id"] : [],
      targetsTruncated: false,
      hadDrift,
      warningStarted,
      warningCleared,
    });
    const runCheck = vi.fn()
      .mockResolvedValueOnce(result(true, true, false))
      .mockResolvedValueOnce(result(true, false, false))
      .mockResolvedValueOnce(result(false, false, true));
    const log = { info: vi.fn(), warn: vi.fn() };
    const scheduler = startIdentitySequenceHealthScheduler({
      runCheck,
      startupDelayMs: 1_000,
      intervalMs: 60 * 60 * 1000,
      log,
    });
    try {
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    } finally {
      scheduler.stop();
    }
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith({
      event: "identity_sequence_health",
      outcome: "warning",
      safeCounts: {
        checked: 37,
        drifted: 1,
        targets: ["audit_logs.id"],
        targetsTruncated: false,
      },
    }, "Identity sequence drift detected");
    expect(log.info).toHaveBeenCalledWith({
      event: "identity_sequence_health",
      outcome: "recovered",
      safeCounts: {
        checked: 37,
        drifted: 0,
        targets: [],
        targetsTruncated: false,
      },
    }, "Identity sequence drift cleared");
    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/sequenceLastValue|tableMax|nextGeneratedId/i);
  });

  it("keeps check failures generic and does not leak database error details", async () => {
    vi.useFakeTimers();
    const runCheck = vi.fn().mockRejectedValue(new Error("private host and query details"));
    const log = { info: vi.fn(), warn: vi.fn() };
    const scheduler = startIdentitySequenceHealthScheduler({
      runCheck,
      startupDelayMs: 1_000,
      intervalMs: 60 * 60 * 1000,
      log,
    });
    try {
      await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      scheduler.stop();
    }
    expect(log.warn).toHaveBeenCalledWith({
      event: "identity_sequence_health",
      outcome: "unavailable",
      errorCode: "identity_sequence_health_check_failed",
    }, "Identity sequence health check unavailable");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("private host and query details");
  });
});
