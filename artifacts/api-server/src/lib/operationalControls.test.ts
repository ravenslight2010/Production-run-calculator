import { describe, expect, it } from "vitest";
import { applyOperationalIntent, parseOperationalIntent, type OperationalIntent } from "./operationalIntents";

const state = () => ({ dayState: { date: "2026-10-23", runs: [{ id: "run", startedAt: 100, metaUpdatedAt: 101 }] }, runValues: { run: {} } });
const command = (control: OperationalIntent["control"]): OperationalIntent => ({
  version: 1, id: "control:1", date: "2026-10-23", runId: "run", action: "control",
  observedGeneration: "run:101", effectiveAt: 120, resetEpoch: 0, baseRevision: 4, control,
});
describe("canonical run controls", () => {
  it("issues dough hold anchors from server time and preserves the lifecycle generation", () => {
    const intent = command({ kind: "dough-timer", paused: true, durationMs: 60000 });
    expect(parseOperationalIntent(intent, 200)).toEqual(intent);
    const result = applyOperationalIntent(state(), intent, 200, 4);
    expect(result.outcome).toBe("accepted");
    expect(result.data.doughTimerControls.run).toEqual({
      generation: "run:101", pausedAt: 200, resumeAt: 60200, updatedAt: 200,
      controlRevision: 5,
    });
    expect(result.data.dayState.runs[0].metaUpdatedAt).toBe(101);
    expect(applyOperationalIntent(state(), intent, 200, 5).outcome).toBe("accepted");
  });
  it("rebases a Dough timer over counter revisions but fences older competing controls", () => {
    const intent = { ...command({ kind: "dough-timer", paused: true, durationMs: 60000 }), baseRevision: 4 };
    const afterCounterWrites = applyOperationalIntent(state(), intent, 200, 7);
    expect(afterCounterWrites).toMatchObject({
      outcome: "accepted",
      data: { doughTimerControls: { run: { controlRevision: 8 } } },
    });

    const staleCompetingControl = {
      ...intent,
      id: "control:stale",
      control: { kind: "dough-timer" as const, paused: false },
    };
    expect(applyOperationalIntent(afterCounterWrites.data, staleCompetingControl, 250, 8).outcome)
      .toBe("conflicted");

    expect(applyOperationalIntent(state(), {
      ...intent,
      id: "control:stale-generation",
      observedGeneration: "run:100",
    }, 250, 7).outcome).toBe("conflicted");
    expect(applyOperationalIntent(state(), {
      ...intent,
      id: "control:future-revision",
      baseRevision: 8,
    }, 250, 7).outcome).toBe("conflicted");
    expect(applyOperationalIntent(state(), {
      ...intent,
      id: "control:missing-base",
      baseRevision: undefined,
    }, 250, 7).outcome).toBe("conflicted");
  });
  it("changes auto mode through a revision-bound intent, not client stamps", () => {
    const intent = command({ kind: "auto-track", enabled: false });
    expect(applyOperationalIntent(state(), intent, 200, 4).data.dayState.runs[0].autoTrackDisabled).toBe(true);
    expect(applyOperationalIntent(state(), intent, 200, 3).outcome).toBe("conflicted");
  });
  it.each([
    { kind: "dough-timer", paused: false, durationMs: 100 },
    { kind: "dough-timer", paused: true, durationMs: 86400001 },
    { kind: "auto-track", enabled: true, extra: 1 },
    { kind: "stoppages", values: [{ id: "a", reason: "", startedAt: 30, endedAt: 20 }] },
    { kind: "stoppages", values: [{ id: "a", reason: "", startedAt: 30 }, { id: "a", reason: "", startedAt: 30 }] },
  ])("rejects malformed control %j", (control) => {
    expect(parseOperationalIntent({ ...command(undefined), control }, 200)).toBeNull();
  });
  it("will not remove an open lifecycle pause through a log edit", () => {
    const data = state();
    Object.assign(data.dayState.runs[0], { pausedAt: 150, stoppages: [{ id: "pause", type: "pause", reason: "", startedAt: 150 }] });
    expect(applyOperationalIntent(data, command({ kind: "stoppages", values: [] }), 200, 4).outcome).toBe("review-required");
  });
  it("retains unsupported legacy corrections as review evidence", () => {
    const intent = { ...command(undefined), action: "correction" as const, values: { traysOnLine: 9 } };
    const result = applyOperationalIntent(state(), intent, 200, 4);
    expect(result.outcome).toBe("review-required");
    expect(result.data.runValues.run).toEqual({});
  });
});
