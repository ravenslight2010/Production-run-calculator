import { beforeEach, describe, expect, it, vi } from "vitest";
import { startDatabasePhaseCheckout, type DatabasePhaseEvidence } from "./databasePhaseTelemetry";

const state = vi.hoisted(() => ({
  calls: 0, failureAt: -1, error: new Error("private SQL, values, identity"),
  info: vi.fn(),
}));
vi.mock("./logger", () => ({ logger: { info: state.info } }));
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  return {
    ...schema,
    db: {
      select() {
        const index = state.calls++;
        const query = {
          from() { return query; },
          where() { return query; },
          groupBy() { return query; },
          having() { return query; },
          orderBy() { return query; },
          limit() { return query; },
          then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
            const checkout = startDatabasePhaseCheckout(900);
            checkout();
            return (index === state.failureAt ? Promise.reject(state.error) : Promise.resolve(
              index === 0 ? [{ queued: 2, running: 1, succeeded: 3, failed: 0, cancelled: 0 }] : [],
            )).then(resolve, reject);
          },
        };
        return query;
      },
    },
  };
});

const {
  sampleScheduledEvaluationQueue,
  readScheduledEvaluationQueueSnapshot,
  ScheduledEvaluationQueueReadError,
  clearScheduledEvaluationQueueMonitorForTests,
} = await import("./serverJobs");

beforeEach(() => {
  state.calls = 0;
  state.failureAt = -1;
  state.info.mockReset();
  clearScheduledEvaluationQueueMonitorForTests();
});

describe("queue reads adopt scoped phase evidence", () => {
  it("attaches successful evidence to both existing stages without changing the snapshot", async () => {
    const sample = await sampleScheduledEvaluationQueue();
    expect(sample.diagnostics).toMatchObject({ queued: 2, running: 1 });
    expect(Object.keys(sample.sampleTiming!.queryDurationsMs)).toEqual(["status_aggregate", "duplicate_group_scan"]);
    expect(sample.sampleTiming!.databasePhases).toEqual({
      status_aggregate: expect.objectContaining({ stage: "status_aggregate", phase: "post_checkout", outcome: "success" }),
      duplicate_group_scan: expect.objectContaining({ stage: "duplicate_group_scan", phase: "post_checkout", outcome: "success" }),
    });
    expect(state.info).toHaveBeenCalledTimes(2);
  });

  it.each([0, 1])("retains failure stage, duration, original cause and sanitized evidence (stage %s)", async (failureAt) => {
    state.failureAt = failureAt;
    state.error = Object.assign(new Error("Query read timeout"), { query: "private SQL, values, identity" });
    const error = await readScheduledEvaluationQueueSnapshot().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ScheduledEvaluationQueueReadError);
    const failure = error as InstanceType<typeof ScheduledEvaluationQueueReadError>;
    expect(failure.cause).toBe(state.error);
    expect(failure.failureStage).toBe(failureAt === 0 ? "status_aggregate" : "duplicate_group_scan");
    expect(failure.databasePhase).toMatchObject({ outcome: "query_timeout", phase: "post_checkout" });
    expect(failure.totalDurationMs).toBeGreaterThanOrEqual(failure.queryDurationMs);
    const evidence = state.info.mock.calls.map(([fields]) => fields.databasePhase as DatabasePhaseEvidence);
    expect(evidence).toHaveLength(failureAt + 1);
    expect(JSON.stringify(evidence)).not.toMatch(/private|SQL|identity|values|Query read timeout/);
  });

  it("does not fail a queue read when the diagnostic logger fails", async () => {
    state.info.mockImplementation(() => { throw new Error("logger unavailable"); });
    await expect(readScheduledEvaluationQueueSnapshot()).resolves.toMatchObject({ queued: 2, running: 1 });
  });
});
