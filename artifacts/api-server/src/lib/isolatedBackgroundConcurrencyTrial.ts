import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import type pg from "pg";

type Database = typeof import("@workspace/db");
type Jobs = typeof import("./serverJobs");
export type ConcurrencyTrialMetrics = {
  concurrency: number;
  succeeded: number;
  cancelled: number;
  failed: number;
  pending: number;
  duplicateEffects: number;
  effectMismatches: number;
  acquisitionFailures: number;
  acquisitionP95Ms: number | null;
  queueAgeP95Ms: number | null;
  eventLoopDelayMaxMs: number | null;
  reminderLatencyMs: number | null;
  throughputPerSecond: number;
  maximumWaiting: number;
  retryAttempts: number;
  stoppedCleanly: boolean;
};

export function assertIsolatedConcurrencyTrial(optIn: string | undefined, nodeEnv: string | undefined, databaseUrl: string | undefined): void {
  let url: URL;
  try { url = new URL(databaseUrl ?? ""); } catch { throw new Error("Concurrency trial requires a disposable loopback parent database."); }
  if (optIn !== "1" || nodeEnv !== "test" || !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^\/closure_trial_parent_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error("Concurrency trial requires explicit opt-in, test mode, and a named disposable loopback parent database.");
  }
}

export function assessConcurrencyTrial(baseline: ConcurrencyTrialMetrics, trial: ConcurrencyTrialMetrics) {
  const semanticFailure = [baseline, trial].some((row) =>
    row.succeeded !== 10 || row.cancelled !== 1 || row.failed !== 0 || row.pending !== 0 ||
    row.duplicateEffects !== 0 || row.effectMismatches !== 0 || row.retryAttempts !== 2 || !row.stoppedCleanly);
  if (semanticFailure) return { decision: "reject" as const, reason: "Protected work did not complete uniquely and cleanly." };
  const measurements = [baseline, trial].flatMap((row) => [
    row.acquisitionP95Ms, row.queueAgeP95Ms, row.eventLoopDelayMaxMs,
    row.reminderLatencyMs, row.throughputPerSecond, row.maximumWaiting, row.acquisitionFailures,
  ]);
  if (baseline.concurrency !== 2 || trial.concurrency !== 1 ||
    measurements.some((value) => value === null || !Number.isFinite(value) || value < 0) ||
    baseline.throughputPerSecond <= 0 || trial.throughputPerSecond <= 0) {
    return { decision: "insufficient-evidence" as const, reason: "Complete comparable measurements were not established." };
  }
  if (trial.acquisitionFailures > baseline.acquisitionFailures ||
    trial.maximumWaiting > baseline.maximumWaiting ||
    trial.acquisitionP95Ms! > baseline.acquisitionP95Ms! ||
    trial.queueAgeP95Ms! > baseline.queueAgeP95Ms! ||
    trial.reminderLatencyMs! > baseline.reminderLatencyMs! ||
    trial.eventLoopDelayMaxMs! > baseline.eventLoopDelayMaxMs! ||
    trial.throughputPerSecond < baseline.throughputPerSecond) {
    return { decision: "reject" as const, reason: "At least one synthetic backlog, latency, throughput, or contention measure worsened." };
  }
  return { decision: "candidate-for-further-isolated-study" as const, reason: "One synthetic comparison is not production authorization or capacity evidence." };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const p95 = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]! : null;

/** Test-only entry: existing worker options, no production configuration change. */
export async function runIsolatedBackgroundConcurrencyTrial(options: {
  optIn: string | undefined; nodeEnv: string | undefined; parentDatabaseUrl: string | undefined;
  databaseName: string; actorId: string; pool: pg.Pool; db: Database["db"];
  jobsTable: Database["serverJobsTable"]; attemptsTable: Database["serverJobAttemptsTable"]; jobs: Jobs;
}) {
  assertIsolatedConcurrencyTrial(options.optIn, options.nodeEnv, options.parentDatabaseUrl);
  const parent = new URL(options.parentDatabaseUrl!);
  const actual = new URL(options.pool.options.connectionString ?? "");
  if (actual.hostname !== parent.hostname || actual.port !== parent.port ||
    actual.pathname !== `/${options.databaseName}` || !/^helium_server_jobs_route_[0-9_]+$/.test(options.databaseName) ||
    options.pool.options.max !== 4) throw new Error("Trial pool is not the expected disposable four-slot fixture.");
  const identity = await options.pool.query<{ name: string }>("SELECT current_database() AS name");
  if (identity.rows[0]?.name !== options.databaseName) throw new Error("Trial database identity changed.");

  async function measure(concurrency: 1 | 2): Promise<ConcurrencyTrialMetrics> {
    await options.db.execute(sql`TRUNCATE ${options.jobsTable}, ${options.attemptsTable} RESTART IDENTITY CASCADE`);
    const acquisition: number[] = [];
    const age: number[] = [];
    const effects = new Map<string, number>();
    let acquisitionFailures = 0;
    let maximumWaiting = 0;
    let reminderLatency: number | null = null;
    let inFlight = 0;
    let runCalls = 0;
    let canaryBusy = false;
    let canaryStopped = false;
    const submissionStarted = performance.now();
    options.jobs.registerServerJob("concurrency-trial-probe", {
      capability: "manage-staff", maxAttempts: 2, timeoutMs: 2_000,
      async handler(context) {
        const input = context.job.input as { kind: string };
        if (input.kind === "retry" && context.job.attempt === 1) throw new Error("Synthetic retry before effects");
        age.push(Math.max(0, Date.now() - context.job.createdAt.getTime()));
        if (input.kind === "reminder") reminderLatency = performance.now() - submissionStarted;
        await context.commit(async () => {
          const checkoutStarted = performance.now();
          let client: pg.PoolClient;
          try {
            client = await options.pool.connect();
            acquisition.push(performance.now() - checkoutStarted);
          } catch (error) { acquisitionFailures++; throw error; }
          try { await client.query("SELECT pg_sleep(0.025)"); } finally { client.release(); }
          // Deliberately longer than the lease: exercise protected renewal and
          // competing claims using only synthetic, in-memory commit effects.
          await delay(140);
          effects.set(context.job.id, (effects.get(context.job.id) ?? 0) + 1);
        });
        return { synthetic: true };
      },
    });
    const submitted: Array<Awaited<ReturnType<Jobs["enqueueServerJob"]>>> = [];
    for (let index = 0; index < 11; index++) {
      submitted.push(await options.jobs.enqueueServerJob({
        scope: "live", actorId: options.actorId, type: "concurrency-trial-probe",
        idempotencyKey: `isolated-trial-${index}`,
        input: { kind: index === 0 ? "reminder" : index === 1 ? "retry" : index === 10 ? "cancel" : "work" },
      }));
    }
    const duplicate = await options.jobs.enqueueServerJob({
      scope: "live", actorId: options.actorId, type: "concurrency-trial-probe",
      idempotencyKey: "isolated-trial-0", input: { kind: "reminder" },
    });
    if (duplicate.created || duplicate.job.id !== submitted[0]!.job.id) throw new Error("Trial idempotency failed.");
    await options.jobs.requestServerJobCancellation(submitted[10]!.job.id, "live", options.actorId);
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    await delay(30);
    const started = performance.now();
    const worker = new options.jobs.ServerJobWorker(`isolated-trial-${concurrency}`, 100);
    const loop = options.jobs.startServerJobWorkerLoop({
      concurrency, intervalMs: 100, now: () => 1, prune: async () => 0,
      worker: {
        async runOnce() {
          inFlight++; runCalls++;
          try { return await worker.runOnce(); } finally { inFlight--; }
        },
      },
    });
    const canary = setInterval(() => {
      maximumWaiting = Math.max(maximumWaiting, options.pool.waitingCount);
      if (canaryBusy || canaryStopped) return;
      canaryBusy = true;
      const checkoutStarted = performance.now();
      void options.pool.connect().then(async (client) => {
        acquisition.push(performance.now() - checkoutStarted);
        try { await client.query("SELECT 1"); } finally { client.release(); }
      }).catch(() => { acquisitionFailures++; }).finally(() => { canaryBusy = false; });
    }, 20);
    let rows: Awaited<ReturnType<Jobs["enqueueServerJob"]>>["job"][] = [];
    let stoppedCleanly = false;
    let elapsed = 0;
    try {
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        rows = await options.db.select().from(options.jobsTable);
        if (rows.every((row) => ["succeeded", "failed", "cancelled"].includes(row.status))) break;
        await delay(20);
      }
      elapsed = performance.now() - started;
    } finally {
      loop.stop();
      canaryStopped = true;
      clearInterval(canary);
      const deadline = performance.now() + 3_000;
      while ((inFlight || canaryBusy) && performance.now() < deadline) await delay(10);
      const stoppedCalls = runCalls;
      await delay(150);
      stoppedCleanly = inFlight === 0 && !canaryBusy && runCalls === stoppedCalls;
      histogram.disable();
    }
    return {
      concurrency,
      succeeded: rows.filter((row) => row.status === "succeeded").length,
      cancelled: rows.filter((row) => row.status === "cancelled").length,
      failed: rows.filter((row) => row.status === "failed").length,
      pending: rows.filter((row) => ["queued", "running"].includes(row.status)).length,
      duplicateEffects: [...effects.values()].reduce((total, count) => total + Math.max(0, count - 1), 0),
      effectMismatches: rows.filter((row) => row.status === "succeeded"
        ? effects.get(row.id) !== 1 : effects.has(row.id)).length,
      acquisitionFailures,
      acquisitionP95Ms: p95(acquisition), queueAgeP95Ms: p95(age),
      eventLoopDelayMaxMs: histogram.count > 0 ? histogram.max / 1e6 : null,
      reminderLatencyMs: reminderLatency,
      throughputPerSecond: elapsed > 0 ? rows.filter((row) => row.status === "succeeded").length * 1_000 / elapsed : 0,
      maximumWaiting,
      retryAttempts: rows.find((row) => row.id === submitted[1]!.job.id)?.attempt ?? 0,
      stoppedCleanly,
    };
  }
  const baseline = await measure(2);
  // Never truncate a fixture still owned by the baseline's running worker.
  if (!baseline.stoppedCleanly || baseline.pending || baseline.failed || baseline.succeeded !== 10 ||
    baseline.effectMismatches || baseline.duplicateEffects) {
    throw new Error(`Synthetic baseline did not drain uniquely; trial not started. Metrics: ${JSON.stringify(baseline)}`);
  }
  const trial = await measure(1);
  return { scope: "synthetic-isolated-only", baseline, trial, assessment: assessConcurrencyTrial(baseline, trial) };
}
