import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VALUES, type HistoryDay, type RunMeta } from "./types";
import {
  COMPLETED_HISTORY_OUTBOX_KEY,
  completedHistoryDays,
  flushCompletedHistoryOutbox,
  loadCompletedHistoryForActiveScope,
  mergeCanonicalCompletedHistory,
  pendingCompletedHistoryCount,
  queueCompletedRun,
  setCompletedHistoryScope,
  startRunAndQueueCompetingCompletions,
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