import { describe, expect, it } from "vitest";
import { assertIsolatedConcurrencyTrial, assessConcurrencyTrial, type ConcurrencyTrialMetrics } from "./isolatedBackgroundConcurrencyTrial";

const metric: ConcurrencyTrialMetrics = {
  concurrency: 2, succeeded: 10, cancelled: 1, failed: 0, pending: 0,
  duplicateEffects: 0, effectMismatches: 0, acquisitionFailures: 0, acquisitionP95Ms: 2,
  queueAgeP95Ms: 300, eventLoopDelayMaxMs: 20, reminderLatencyMs: 10,
  throughputPerSecond: 5, maximumWaiting: 1, retryAttempts: 2, stoppedCleanly: true,
};
describe("isolated background concurrency trial boundaries", () => {
  it("requires explicit opt-in and a disposable loopback parent before database work", () => {
    expect(() => assertIsolatedConcurrencyTrial("1", "test", "postgresql://postgres@127.0.0.1:12345/closure_trial_parent_fixture")).not.toThrow();
    for (const [flag, mode, url] of [
      [undefined, "test", "postgresql://postgres@127.0.0.1/closure_trial_parent_fixture"],
      ["1", "production", "postgresql://postgres@127.0.0.1/closure_trial_parent_fixture"],
      ["1", "test", "postgresql://postgres@remote.invalid/closure_trial_parent_fixture"],
      ["1", "test", "postgresql://postgres@127.0.0.1/shared_database"],
    ]) expect(() => assertIsolatedConcurrencyTrial(flag, mode, url)).toThrow(/trial requires/i);
  });
  it("rejects worsened backlog, starvation, waiting, failures or reminder timeliness", () => {
    for (const changed of [
      { queueAgeP95Ms: 301 }, { pending: 1 }, { maximumWaiting: 2 },
      { acquisitionFailures: 1 }, { reminderLatencyMs: 11 }, { throughputPerSecond: 4 },
      { duplicateEffects: 1 }, { stoppedCleanly: false }, { retryAttempts: 3 },
    ]) expect(assessConcurrencyTrial(metric, { ...metric, concurrency: 1, ...changed }).decision).toBe("reject");
  });
  it("keeps missing metrics and one synthetic improvement below production authority", () => {
    expect(assessConcurrencyTrial(metric, { ...metric, concurrency: 1, eventLoopDelayMaxMs: null }).decision).toBe("insufficient-evidence");
    expect(assessConcurrencyTrial(metric, { ...metric, concurrency: 1 }).decision).toBe("candidate-for-further-isolated-study");
  });
});
