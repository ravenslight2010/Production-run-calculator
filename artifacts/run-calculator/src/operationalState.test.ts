import { describe, expect, it } from "vitest";
import {
  LIVE_CALC_STALE_MS,
  classifyOperationalDisplay,
  shouldAdoptOperationalSnapshot,
  shouldUseServerCalc,
} from "./operationalState";

const receipt = (runId: string, snapshotId: string, capturedAt: number) => ({
  runId,
  snapshotId,
  capturedAt,
});

describe("operational snapshot adoption", () => {
  it("rejects a late response from a previous request or selected run", () => {
    const candidate = receipt("run-old", "old", 20);
    expect(shouldAdoptOperationalSnapshot({
      requestGeneration: 1,
      currentRequestGeneration: 2,
      selectedRunId: "run-new",
      responseRunId: candidate.runId,
      candidate,
      adopted: null,
    })).toBe(false);
    expect(shouldAdoptOperationalSnapshot({
      requestGeneration: 2,
      currentRequestGeneration: 2,
      selectedRunId: "run-new",
      responseRunId: candidate.runId,
      candidate,
      adopted: null,
    })).toBe(false);
  });

  it("keeps a newer adopted revision when an older response arrives", () => {
    expect(shouldAdoptOperationalSnapshot({
      requestGeneration: 3,
      currentRequestGeneration: 3,
      selectedRunId: "run-1",
      responseRunId: "run-1",
      candidate: receipt("run-1", "old", 10),
      adopted: receipt("run-1", "new", 20),
    })).toBe(false);
  });

  it("distinguishes confirmed, provisional, and offline live displays", () => {
    const current = receipt("run-1", "s1", 10);
    expect(classifyOperationalDisplay({
      online: true, syncConnected: true, selectedRunId: "run-1", receipt: current,
    })).toBe("confirmed");
    expect(classifyOperationalDisplay({
      online: true, syncConnected: true, selectedRunId: "run-2", receipt: current,
    })).toBe("provisional");
    expect(classifyOperationalDisplay({
      online: false, syncConnected: false, selectedRunId: "run-1", receipt: current,
    })).toBe("offline");
  });
});

describe("shouldUseServerCalc (freshness-window adoption)", () => {
  const fresh = receipt("run-1", "s1", 90_000);

  it("is false when offline or disconnected even with a fresh receipt", () => {
    expect(shouldUseServerCalc({
      online: false, syncConnected: true, receipt: fresh, nowMs: 95_000,
    })).toBe(false);
    expect(shouldUseServerCalc({
      online: true, syncConnected: false, receipt: fresh, nowMs: 95_000,
    })).toBe(false);
  });

  it("is false when there is no server calc receipt", () => {
    expect(shouldUseServerCalc({
      online: true, syncConnected: true, receipt: null, nowMs: 95_000,
    })).toBe(false);
  });

  it("is false when the receipt is older than the freshness window", () => {
    // capturedAt 90_000, now 100_001 -> 10_001ms of age > 10s window
    expect(shouldUseServerCalc({
      online: true, syncConnected: true, receipt: fresh, nowMs: 100_001,
    })).toBe(false);
  });

  it("is true while the receipt is fresh (at or inside the window)", () => {
    expect(shouldUseServerCalc({
      online: true, syncConnected: true, receipt: fresh, nowMs: 95_000,
    })).toBe(true);
    // exactly at the default window boundary is still fresh
    expect(shouldUseServerCalc({
      online: true, syncConnected: true, receipt: fresh, nowMs: 100_000,
    })).toBe(true);
  });

  it("honors an explicit windowMs override", () => {
    expect(shouldUseServerCalc({
      online: true, syncConnected: true, receipt: fresh, nowMs: 95_000, windowMs: 4_000,
    })).toBe(false);
    expect(shouldUseServerCalc({
      online: true, syncConnected: true, receipt: fresh, nowMs: 94_000, windowMs: 4_000,
    })).toBe(true);
  });

  it("exposes LIVE_CALC_STALE_MS as the 10s default window", () => {
    expect(LIVE_CALC_STALE_MS).toBe(10_000);
    expect(shouldUseServerCalc({
      online: true, syncConnected: true, receipt: fresh, nowMs: 95_000,
    })).toBe(true);
  });
});
