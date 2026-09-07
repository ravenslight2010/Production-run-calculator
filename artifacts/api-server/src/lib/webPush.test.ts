import { describe, expect, it, vi } from "vitest";
import { getServerJobDefinition } from "./serverJobs";

const mocks = vi.hoisted(() => ({
  calc: vi.fn(),
  elapsed: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  dailySyncTable: {}, usersTable: {}, webPushDeliveriesTable: {}, webPushSubscriptionsTable: {},
}));
vi.mock("@workspace/live-calc", () => ({ computeServerCalc: mocks.calc, computeAutoTrackElapsedMs: mocks.elapsed }));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

const {
  alertCandidates,
  deferredCandidate,
  freezerCandidates,
  pendingFreezerArms,
  scheduledEvaluationIdempotencyKey,
} = await import("./webPush");

describe("server web-push alert candidates", () => {
  it("does not emit live timing alerts while paused or ended", () => {
    mocks.calc.mockReturnValue({ runId: "run-a", calc: { ppm: 20, adjustedTimeSec: 300, pressDone: false, timePerBatchSec: 1, pressCasesLeft: 1 } });
    const base = { dayState: { currentIndex: 0, runs: [{ id: "run-a", startedAt: 1, pausedAt: 2 }] }, runValues: { "run-a": { freezerTime: 0 } } };
    expect(alertCandidates(base, "2026-01-01", 100_000)).toEqual([]);
    expect(alertCandidates({ ...base, dayState: { currentIndex: 0, runs: [{ id: "run-a", startedAt: 1, endedAt: 2 }] } }, "2026-01-01", 100_000)).toEqual([]);
  });

  it("uses bounded opaque stable ids for canonical timing milestones", () => {
    mocks.calc.mockReturnValue({ runId: "customer-visible-label", calc: { ppm: 20, adjustedTimeSec: 900, pressDone: true, timePerBatchSec: 0, pressCasesLeft: 0 } });
    const data = { dayState: { currentIndex: 0, runs: [{ id: "customer-visible-label", startedAt: 1 }] }, runValues: { "customer-visible-label": { freezerTime: 0 } } };
    const alerts = alertCandidates(data, "2026-01-01", 100_000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "fifteenMin" });
    expect(alerts[0]!.id).not.toContain("customer-visible-label");
    expect(alerts[0]!.id.length).toBeLessThan(96);
  });

  it("uses pause-aware shared elapsed time for batches and changes identity for a replacement run", () => {
    mocks.elapsed.mockReturnValue(2_000);
    mocks.calc.mockReturnValue({ runId: "first", calc: { ppm: 20, adjustedTimeSec: 2_000, pressDone: false, timePerBatchSec: 1, pressCasesLeft: 99 } });
    const first = { dayState: { currentIndex: 0, runs: [{ id: "first", startedAt: 1 }] }, runValues: { first: { freezerTime: 0 } } };
    expect(alertCandidates(first, "2026-01-01", 100_000).some((a) => a.kind === "batchDue")).toBe(true);
    expect(mocks.elapsed).toHaveBeenCalled();
    expect(alertCandidates({ ...first, dayState: { currentIndex: 0, runs: [{ id: "first", startedAt: 1, pausedAt: 50_000 }] } }, "2026-01-01", 100_000)).toEqual([]);
    const old = { dayState: { currentIndex: 1, runs: [{ id: "first", endedAt: 1 }, { id: "second", startedAt: 2 }] }, runValues: { first: { freezerTime: 1 } } };
    const replacement = { ...old, dayState: { currentIndex: 1, runs: [{ id: "replacement", endedAt: 1 }, { id: "second", startedAt: 2 }] }, runValues: { replacement: { freezerTime: 1 } } };
    expect(freezerCandidates(old, "2026-01-01", 61_000)[0]!.id).not.toEqual(freezerCandidates(replacement, "2026-01-01", 61_000)[0]!.id);
  });

  it("finds a freezer-empty milestone for an ended non-current run", () => {
    const data = {
      dayState: { currentIndex: 1, runs: [{ id: "old", endedAt: 1_000 }, { id: "current", startedAt: 2_000 }] },
      runValues: { old: { freezerTime: 1 }, current: { freezerTime: 0 } },
    };
    expect(freezerCandidates(data, "2026-01-01", 62_000)).toEqual([
      expect.objectContaining({ kind: "freezerEmpty" }),
    ]);
  });

  it("arms freezer completion only while the canonical drain is pending", () => {
    const data = {
      dayState: { currentIndex: 1, runs: [{ id: "old", startedAt: 100, endedAt: 1_000 }, { id: "current", startedAt: 2_000 }] },
      runValues: { old: { freezerTime: 1 }, current: { freezerTime: 0 } },
    };
    expect(pendingFreezerArms(data, 60_000)).toHaveLength(1);
    expect(pendingFreezerArms(data, 62_000)).toEqual([]);
    expect(freezerCandidates(data, "2026-01-01", 62_000)[0]).toMatchObject({
      kind: "freezerEmpty",
      dueAt: 61_000,
    });
  });

  it("deduplicates scheduled evaluation by date and time bucket", () => {
    const first = scheduledEvaluationIdempotencyKey("2026-01-01", 120_001, 60_000);
    expect(scheduledEvaluationIdempotencyKey("2026-01-01", 179_999, 60_000)).toBe(first);
    expect(scheduledEvaluationIdempotencyKey("2026-01-01", 180_000, 60_000)).not.toBe(first);
    expect(scheduledEvaluationIdempotencyKey("2026-01-02", 120_001, 60_000)).not.toBe(first);
  });

  it("registers scheduled evaluation as an executable bounded server job", () => {
    const definition = getServerJobDefinition("scheduled-evaluation");
    expect(definition?.handler).toBeTypeOf("function");
    expect(definition).toMatchObject({ maxAttempts: 3, timeoutMs: 60_000 });
  });

  it("preserves a quiet-hour alert's deliverable identity for later delivery", () => {
    expect(deferredCandidate({
      alertId: "opaque-alert",
      alertKind: "freezerEmpty",
      dueAt: new Date(123_000),
    })).toEqual({ id: "opaque-alert", kind: "freezerEmpty", dueAt: 123_000 });
    expect(deferredCandidate({ alertId: "opaque-alert", alertKind: "unknown", dueAt: null })).toBeNull();
  });
});
