import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VALUES, type HistoryDay, type RunMeta } from "./types";
import {
  COMPLETED_HISTORY_OUTBOX_KEY,
  completedHistoryDays,
  flushCompletedHistoryOutbox,
  loadCompletedHistoryForActiveScope,
  mergeCanonicalCompletedHistory,
  flushApplicatorEvidenceOutbox,
  loadApplicatorBatchEvidenceForActiveScope,
  pendingApplicatorBatchFinalizations,
  pendingCompletedHistoryCount,
  queueApplicatorBatchFinalization,
  reconcileApplicatorBatchEvidence,
  queueCompletedRun,
  setCompletedHistoryScope,
  startRunAndQueueCompetingCompletions,
  unresolvedApplicatorEvidenceConflicts,
} from "./completedHistorySync";

const run = (id: string, endedAt = 2): RunMeta => ({
  id,
  brand: "Acme",
  flavor: "Cheese",
  startedAt: 1,
  endedAt,
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  setCompletedHistoryScope("live");
});

describe("completed history outbox", () => {
  it("queues a completion immediately and idempotently", () => {
    queueCompletedRun("2026-09-06", run("run-1"), DEFAULT_VALUES);
    queueCompletedRun("2026-09-06", run("run-1"), DEFAULT_VALUES);
    expect(pendingCompletedHistoryCount()).toBe(1);
    const queued = JSON.parse(localStorage.getItem(`${COMPLETED_HISTORY_OUTBOX_KEY}.live`) ?? "[]");
    expect(queued[0].operationId).toBe("completed:2026-09-06:run-1");
    expect(queued[0].snapshot.dayState.runs[0].endedAt).toBe(2);
  });

  it("never drains a completion through a different authenticated scope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    queueCompletedRun("2026-09-06", run("live-run"), DEFAULT_VALUES);
    setCompletedHistoryScope("sandbox");
    await flushCompletedHistoryOutbox();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`${COMPLETED_HISTORY_OUTBOX_KEY}.live`)).toContain("live-run");
    expect(localStorage.getItem(`${COMPLETED_HISTORY_OUTBOX_KEY}.sandbox`)).toBeNull();
  });

  it("switches displayed offline history to only the active scope", () => {
    queueCompletedRun("2026-09-06", run("live-run"), DEFAULT_VALUES);
    expect(loadCompletedHistoryForActiveScope()[0].runs[0].id).toBe("live-run");
    setCompletedHistoryScope("sandbox");
    expect(loadCompletedHistoryForActiveScope()).toEqual([]);
    queueCompletedRun("2026-09-06", run("sandbox-run"), DEFAULT_VALUES);
    expect(loadCompletedHistoryForActiveScope()[0].runs[0].id).toBe("sandbox-run");
  });

  it("retries a transient server failure without requiring another online event", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })));
    queueCompletedRun("2026-09-06", run("retry-run"), DEFAULT_VALUES);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pendingCompletedHistoryCount()).toBe(0);
    vi.useRealTimers();
  });

  it("queues a competing active run immediately when another run starts", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const prior = run("prior-run");
    prior.startedAt = 100;
    prior.endedAt = undefined;
    const next = run("next-run");
    const result = startRunAndQueueCompetingCompletions({
      date: "2026-09-06",
      runs: [prior, next],
      currentIndex: 1,
      now: 500,
      loadValues: () => ({ ...DEFAULT_VALUES, casesNeeded: 18 }),
    });
    expect(result.autoEnded).toEqual([expect.objectContaining({ id: "prior-run", endedAt: 500 })]);
    const queued = JSON.parse(localStorage.getItem(`${COMPLETED_HISTORY_OUTBOX_KEY}.live`) ?? "[]");
    expect(queued).toEqual([
      expect.objectContaining({
        operationId: "completed:2026-09-06:prior-run",
        snapshot: expect.objectContaining({
          runValues: { "prior-run": expect.objectContaining({ casesNeeded: 18 }) },
        }),
      }),
    ]);
  });

  it("removes work only after an explicit server acknowledgement", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })));
    queueCompletedRun("2026-09-06", run("run-1"), DEFAULT_VALUES);
    await flushCompletedHistoryOutbox();
    expect(pendingCompletedHistoryCount()).toBe(1);
    await flushCompletedHistoryOutbox();
    expect(pendingCompletedHistoryCount()).toBe(0);
  });
});

describe("canonical completed history", () => {
  it("reconstructs days and lets immutable server records win over local cache", () => {
    const canonicalRun = { ...run("run-1"), notes: "server canonical" };
    const canonical = completedHistoryDays([{
      date: "2026-09-06",
      runId: "run-1",
      snapshot: {
        dayState: { date: "2026-09-06", runs: [canonicalRun] },
        runValues: { "run-1": { ...DEFAULT_VALUES, casesNeeded: 25 } },
      },
    }]);
    const local: HistoryDay[] = [{
      date: "2026-09-06",
      runs: [{ ...run("run-1"), notes: "stale local" }, run("pending")],
      runValues: {
        "run-1": { ...DEFAULT_VALUES, casesNeeded: 10 },
        pending: { ...DEFAULT_VALUES, casesNeeded: 5 },
      },
    }];
    const merged = mergeCanonicalCompletedHistory(local, canonical);
    expect(merged[0].runs.find((candidate) => candidate.id === "run-1")?.notes).toBe("server canonical");
    expect(merged[0].runValues["run-1"].casesNeeded).toBe(25);
    expect(merged[0].runs.some((candidate) => candidate.id === "pending")).toBe(true);
  });
});

describe("applicator evidence reconciliation", () => {
  it("keeps latest automatic progress, prefers latest confirmed correction, and exposes provenance", () => {
    const result = reconcileApplicatorBatchEvidence([
      {
        operationId: "auto-1", date: "2026-09-06", runId: "run-1", slot: 1,
        source: "automatic-observation", observedTotal: 3, evidenceHash: "a", createdAt: "2026-09-06T10:00:00.000Z",
      },
      {
        operationId: "auto-2", date: "2026-09-06", runId: "run-1", slot: 1,
        source: "automatic-observation", observedTotal: 4, evidenceHash: "b", createdAt: "2026-09-06T11:00:00.000Z",
      },
      {
        operationId: "final-1", date: "2026-09-06", runId: "run-1", slot: 1,
        source: "manager-finalization", confirmedTotal: 5, evidenceHash: "c", createdAt: "2026-09-06T11:30:00.000Z",
      },
      {
        operationId: "correction-1", date: "2026-09-06", runId: "run-1", slot: 1,
        source: "manager-correction", confirmedTotal: 6, evidenceHash: "d", createdAt: "2026-09-06T12:00:00.000Z",
      },
    ]);
    expect(result).toEqual([{
      date: "2026-09-06", runId: "run-1", slot: 1,
      latestObservedTotal: 4, latestConfirmedTotal: 6, effectiveTotal: 6,
      provenance: "manager-confirmed", observedEvidenceHash: "b", confirmedEvidenceHash: "d",
      latestObservedOperationId: "auto-2", latestConfirmedOperationId: "correction-1",
    }]);
  });

  it("reports automatic progress as effective until a manager confirms it", () => {
    expect(reconcileApplicatorBatchEvidence([{
      operationId: "auto-1", date: "2026-09-06", runId: "run-1", slot: 2,
      source: "automatic-observation", observedTotal: 2, createdAt: "2026-09-06T10:00:00.000Z",
    }])).toEqual([{
      date: "2026-09-06", runId: "run-1", slot: 2,
      latestObservedTotal: 2, effectiveTotal: 2, provenance: "automatic-observed",
      latestObservedOperationId: "auto-1",
    }]);
  });

  it("retires a canonical 409 conflict and continues with later evidence", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "stale correction",
        canonical: { operationId: "canonical", date: "2026-09-06", runId: "run-1", slot: 1, source: "manager-finalization", confirmedTotal: 3 },
      }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: true }), { status: 201 })));
    setCompletedHistoryScope("live");
    queueApplicatorBatchFinalization({ operationId: "final-conflict", date: "2026-09-06", runId: "run-1", slot: 1, finalTotal: 4 });
    queueApplicatorBatchFinalization({ operationId: "final-next", date: "2026-09-06", runId: "run-2", slot: 1, finalTotal: 5 });
    await flushApplicatorEvidenceOutbox();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pendingApplicatorBatchFinalizations()).toEqual([]);
    expect(unresolvedApplicatorEvidenceConflicts()[0]).toMatchObject({
      operationId: "final-conflict", canonical: { confirmedTotal: 3 },
    });
  });

  it("preserves transient evidence submissions for bounded retry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ acknowledged: true }), { status: 201 })));
    setCompletedHistoryScope("live");
    queueApplicatorBatchFinalization({ operationId: "retry-final", date: "2026-09-06", runId: "run-3", slot: 2, finalTotal: 2 });
    await flushApplicatorEvidenceOutbox();
    expect(pendingApplicatorBatchFinalizations()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pendingApplicatorBatchFinalizations()).toEqual([]);
    vi.useRealTimers();
  });

  it("merges a 201 canonical row before removing the outbox, enabling correction semantics", async () => {
    const canonical = {
      id: "server-evidence-1", operationId: "initial-final", date: "2026-09-06",
      runId: "run-confirmed", slot: 1 as const, source: "manager-finalization" as const,
      confirmedTotal: 7, evidenceHash: "a".repeat(64), hashContract: "canonical-json-v1" as const,
      createdAt: "2026-09-06T12:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        acknowledged: true, duplicate: false, operationId: canonical.operationId,
        evidenceHash: canonical.evidenceHash, canonical,
      }), { status: 201 }),
    ));
    setCompletedHistoryScope("live");
    queueApplicatorBatchFinalization({
      operationId: canonical.operationId, date: canonical.date, runId: canonical.runId, slot: 1, finalTotal: 7,
    });
    await flushApplicatorEvidenceOutbox();
    expect(pendingApplicatorBatchFinalizations()).toEqual([]);
    const reconciled = reconcileApplicatorBatchEvidence(loadApplicatorBatchEvidenceForActiveScope());
    expect(reconciled).toEqual([expect.objectContaining({
      runId: "run-confirmed", latestConfirmedTotal: 7, latestConfirmedOperationId: "initial-final",
      provenance: "manager-confirmed",
    })]);
    queueApplicatorBatchFinalization({
      operationId: "correction-final", date: canonical.date, runId: canonical.runId, slot: 1,
      finalTotal: 8, correctionOf: reconciled[0]!.latestConfirmedOperationId,
    });
    expect(pendingApplicatorBatchFinalizations()).toEqual([expect.objectContaining({
      operationId: "correction-final", correctionOf: "initial-final",
    })]);
  });
});