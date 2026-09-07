import { describe, expect, it } from "vitest";
import {
  classifyOperationalDisplay,
  shouldAdoptOperationalSnapshot,
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