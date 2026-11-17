import { describe, expect, it } from "vitest";
import { applyResumeToRun, computeResumedStartedAt } from "./utils";

describe("direct pause resume", () => {
  const START = 1_000_000;

  it("shifts startedAt by the full pause, preserving elapsed production time", () => {
    const pausedAt = START + 30 * 60_000;
    const resumeAt = pausedAt + 10 * 60_000;
    const resumedStartedAt = computeResumedStartedAt(START, pausedAt, resumeAt);

    expect(resumedStartedAt).toBe(START + 10 * 60_000);
    expect(resumeAt - resumedStartedAt).toBe(30 * 60_000);
  });

  it("never lets a future pausedAt move startedAt backward", () => {
    expect(computeResumedStartedAt(START, START + 10_000, START)).toBe(START);
  });

  it("keeps a long pause out of elapsed production time", () => {
    const pausedAt = START + 2 * 60 * 60_000;
    const resumeAt = pausedAt + 12 * 60 * 60_000;
    const resumedStartedAt = computeResumedStartedAt(START, pausedAt, resumeAt);

    expect(resumeAt - resumedStartedAt).toBe(2 * 60 * 60_000);
  });

  it("directly resumes, clears pausedAt, and closes only the active pause", () => {
    const pausedAt = START + 30 * 60_000;
    const resumeAt = pausedAt + 10 * 60_000;
    const resumed = applyResumeToRun({
      id: "run-1",
      startedAt: START,
      pausedAt,
      stoppages: [
        { id: "closed", reason: "", type: "pause", startedAt: START + 1_000, endedAt: START + 2_000, stopTunnel: false },
        { id: "orphan", reason: "", type: "pause", startedAt: START + 10_000, stopTunnel: true },
        { id: "open", reason: "", type: "pause", startedAt: pausedAt, stopTunnel: true },
      ],
    }, resumeAt);

    expect(resumed).toMatchObject({
      startedAt: START + 10 * 60_000,
      pausedAt: undefined,
    });
    expect(resumed?.stoppages?.[0]?.endedAt).toBe(START + 2_000);
    expect(resumed?.stoppages?.[1]?.id).toBe("orphan");
    expect(resumed?.stoppages?.[1]?.endedAt).toBeUndefined();
    expect(resumed?.stoppages?.[2]).toMatchObject({
      id: "open",
      endedAt: resumeAt,
      stopTunnel: true,
    });
  });

  it("uses the persisted pause identity when records share the same timestamp", () => {
    const pausedAt = START + 30 * 60_000;
    const resumeAt = pausedAt + 10 * 60_000;
    const resumed = applyResumeToRun({
      id: "run-1",
      startedAt: START,
      pausedAt,
      pausedStoppageId: "active-pause",
      stoppages: [
        { id: "duplicate-pause", reason: "", type: "pause", startedAt: pausedAt },
        { id: "active-pause", reason: "", type: "pause", startedAt: pausedAt },
      ],
    }, resumeAt);

    expect(resumed?.stoppages?.[0]?.endedAt).toBeUndefined();
    expect(resumed?.stoppages?.[1]?.endedAt).toBe(resumeAt);
    expect(resumed?.pausedStoppageId).toBeUndefined();
  });
});