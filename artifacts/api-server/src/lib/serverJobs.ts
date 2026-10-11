import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import {
  db,
  serverJobAttemptsTable,
  serverJobsTable,
  type ServerJobRow,
} from "@workspace/db";
import type { Capability } from "./roles";
import type { Scope } from "./requestScope";
import { pruneServerJobArtifacts } from "./serverJobArtifactCache";
import {
  createBackgroundOperationBackoff,
  isTransientDatabaseConnectionError,
  recordBackgroundOperationFailure,
  runBackgroundOperation,
} from "./backgroundOperations";

export const SERVER_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type ServerJobStatus = (typeof SERVER_JOB_STATUSES)[number];
export type ServerJobHandler = (context: ServerJobContext) => Promise<unknown>;
export type ServerJobDefinition = {
  capability: Capability;
  handler?: ServerJobHandler;
  maxAttempts?: number;
  /** Hard execution wall-clock budget. Handlers must observe context.signal. */
  timeoutMs?: number;
};

/** A registry, rather than a workload implementation, keeps job infrastructure
 * independent of workbook/export/alert payload code. */
const definitions = new Map<string, ServerJobDefinition>();

export function registerServerJob(type: string, definition: ServerJobDefinition): void {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(type)) throw new Error("Invalid server job type");
  if (definition.maxAttempts !== undefined && (!Number.isInteger(definition.maxAttempts) ||
    definition.maxAttempts < 1 || definition.maxAttempts > 5)) {
    throw new Error("Server job maxAttempts must be between 1 and 5");
  }
  if (definition.timeoutMs !== undefined && (!Number.isInteger(definition.timeoutMs) ||
    definition.timeoutMs < 1_000 || definition.timeoutMs > 15 * 60_000)) {
    throw new Error("Server job timeoutMs must be between 1 second and 15 minutes");
  }
  definitions.set(type, definition);
}

export function getServerJobDefinition(type: string): ServerJobDefinition | undefined {
  return definitions.get(type);
}

// Contractual workload names. Implementations are deliberately registered by
// their owning domain later; no client payload logic lives in this lifecycle.
registerServerJob("workbook-parse", { capability: "use-ai-tools" });
registerServerJob("workbook-reconcile", { capability: "manage-profiles" });
registerServerJob("export-package", { capability: "review-incidents" });
registerServerJob("scheduled-evaluation", { capability: "review-incidents" });
registerServerJob("mutation-compaction", { capability: "manage-staff" });

const LEASE_MS = 30_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INPUT_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const DEFAULT_EXECUTION_TIMEOUT_MS = 5 * 60_000;
export const SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS = 60_000;
export const SCHEDULED_EVALUATION_MONITOR_WINDOW_MS = 5 * 60_000;
const SCHEDULED_EVALUATION_MAX_DUPLICATE_GROUPS = 100;
const SCHEDULED_EVALUATION_MAX_SAMPLES =
  Math.ceil(SCHEDULED_EVALUATION_MONITOR_WINDOW_MS / SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS) + 1;

export type ScheduledEvaluationQueueWarningCode =
  | "backlog_stalled"
  | "backlog_growing"
  | "duplicate_time_buckets";

export type ScheduledEvaluationQueueSnapshot = {
  queued: number;
  running: number;
  terminalLastWindow: {
    succeeded: number;
    failed: number;
    cancelled: number;
  };
  duplicateTimeBucketGroups: number;
  duplicateGroupsTruncated: boolean;
};

export type ScheduledEvaluationQueueDiagnostics = ScheduledEvaluationQueueSnapshot & {
  status: "pending" | "ok" | "warning";
  warningCodes: ScheduledEvaluationQueueWarningCode[];
  sampleCount: number;
  windowMs: number;
  lastSampleAt?: string;
};

export type ScheduledEvaluationQueueTransition = {
  started: ScheduledEvaluationQueueWarningCode[];
  cleared: ScheduledEvaluationQueueWarningCode[];
  diagnostics: ScheduledEvaluationQueueDiagnostics;
};

type ScheduledEvaluationQueueSample = ScheduledEvaluationQueueSnapshot & { at: number };

const EMPTY_SCHEDULED_EVALUATION_SNAPSHOT: ScheduledEvaluationQueueSnapshot = {
  queued: 0,
  running: 0,
  terminalLastWindow: { succeeded: 0, failed: 0, cancelled: 0 },
  duplicateTimeBucketGroups: 0,
  duplicateGroupsTruncated: false,
};

function nonNegativeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Bounded, process-local trend state for the scheduled-evaluation workload.
 * Only aggregate counts are retained; job identifiers and payloads never enter
 * this monitor.
 */
export function createScheduledEvaluationQueueMonitor() {
  let samples: ScheduledEvaluationQueueSample[] = [];
  let warningCodes = new Set<ScheduledEvaluationQueueWarningCode>();

  const diagnostics = (): ScheduledEvaluationQueueDiagnostics => {
    const latest = samples.at(-1);
    return {
      ...EMPTY_SCHEDULED_EVALUATION_SNAPSHOT,
      ...(latest
        ? {
          queued: latest.queued,
          running: latest.running,
          terminalLastWindow: latest.terminalLastWindow,
          duplicateTimeBucketGroups: latest.duplicateTimeBucketGroups,
          duplicateGroupsTruncated: latest.duplicateGroupsTruncated,
        }
        : {}),
      status: samples.length === 0 ? "pending" : warningCodes.size ? "warning" : "ok",
      warningCodes: [...warningCodes].sort(),
      sampleCount: samples.length,
      windowMs: SCHEDULED_EVALUATION_MONITOR_WINDOW_MS,
      ...(latest ? { lastSampleAt: new Date(latest.at).toISOString() } : {}),
    };
  };

  return {
    observe(snapshot: ScheduledEvaluationQueueSnapshot, nowMs = Date.now()): ScheduledEvaluationQueueTransition {
      const previous = warningCodes;
      const latest = samples.at(-1);
      if (latest && nowMs - latest.at > SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS * 2) {
        // A long sampling gap cannot prove a sustained condition. Start a new
        // window rather than treating missing observations as evidence.
        samples = [];
        warningCodes = new Set();
      }

      samples.push({
        at: nowMs,
        queued: nonNegativeCount(snapshot.queued),
        running: nonNegativeCount(snapshot.running),
        terminalLastWindow: {
          succeeded: nonNegativeCount(snapshot.terminalLastWindow.succeeded),
          failed: nonNegativeCount(snapshot.terminalLastWindow.failed),
          cancelled: nonNegativeCount(snapshot.terminalLastWindow.cancelled),
        },
        duplicateTimeBucketGroups: nonNegativeCount(snapshot.duplicateTimeBucketGroups),
        duplicateGroupsTruncated: snapshot.duplicateGroupsTruncated === true,
      });
      if (samples.length > SCHEDULED_EVALUATION_MAX_SAMPLES) {
        samples = samples.slice(-SCHEDULED_EVALUATION_MAX_SAMPLES);
      }

      const current = samples.at(-1)!;
      const first = samples[0]!;
      const next = new Set<ScheduledEvaluationQueueWarningCode>();
      const windowElapsed = current.at - first.at >= SCHEDULED_EVALUATION_MONITOR_WINDOW_MS;
      if (windowElapsed && first.queued > 0 && current.queued > 0 && current.queued >= first.queued) {
        next.add(current.queued > first.queued ? "backlog_growing" : "backlog_stalled");
      }
      if (samples.length >= 2 && current.duplicateTimeBucketGroups > 0 &&
        samples.at(-2)!.duplicateTimeBucketGroups > 0) {
        next.add("duplicate_time_buckets");
      }

      const started = [...next].filter((code) => !previous.has(code)).sort();
      const cleared = [...previous].filter((code) => !next.has(code)).sort();
      warningCodes = next;
      return { started, cleared, diagnostics: diagnostics() };
    },
    getDiagnostics: diagnostics,
    clearForTests() {
      samples = [];
      warningCodes = new Set();
    },
  };
}

const scheduledEvaluationQueueMonitor = createScheduledEvaluationQueueMonitor();

/**
 * Read only bounded aggregate metrics. Duplicate keys are grouped by stored
 * unexpired rows grouped by stored scope and canonical time bucket, across
 * actor ids, so alternate scheduler identities cannot hide duplicate work.
 * Raw group values are never returned.
 */
export async function readScheduledEvaluationQueueSnapshot(
  nowMs = Date.now(),
): Promise<ScheduledEvaluationQueueSnapshot> {
  const terminalWindowStart = new Date(nowMs - SCHEDULED_EVALUATION_MONITOR_WINDOW_MS);
  const [aggregate] = await db.select({
    queued: sql<number>`count(*) filter (where ${serverJobsTable.status} = 'queued')::int`,
    running: sql<number>`count(*) filter (where ${serverJobsTable.status} = 'running')::int`,
    succeeded: sql<number>`count(*) filter (where ${serverJobsTable.status} = 'succeeded' and ${serverJobsTable.finishedAt} >= ${terminalWindowStart})::int`,
    failed: sql<number>`count(*) filter (where ${serverJobsTable.status} = 'failed' and ${serverJobsTable.finishedAt} >= ${terminalWindowStart})::int`,
    cancelled: sql<number>`count(*) filter (where ${serverJobsTable.status} = 'cancelled' and ${serverJobsTable.finishedAt} >= ${terminalWindowStart})::int`,
  }).from(serverJobsTable).where(and(
    eq(serverJobsTable.type, "scheduled-evaluation"),
    gt(serverJobsTable.expiresAt, new Date(nowMs)),
  ));

  const bucket = sql<string>`split_part(${serverJobsTable.idempotencyKey}, ':', 3)`;
  const duplicateGroups = await db.select({
    scope: serverJobsTable.scope,
    bucket,
  }).from(serverJobsTable).where(and(
    eq(serverJobsTable.type, "scheduled-evaluation"),
    gt(serverJobsTable.expiresAt, new Date(nowMs)),
    sql`${serverJobsTable.idempotencyKey} ~ '^scheduled-evaluation:[^:]+:[0-9]+$'`,
  )).groupBy(serverJobsTable.scope, bucket).having(sql`count(*) > 1`)
    .limit(SCHEDULED_EVALUATION_MAX_DUPLICATE_GROUPS + 1);

  return {
    queued: nonNegativeCount(aggregate?.queued ?? 0),
    running: nonNegativeCount(aggregate?.running ?? 0),
    terminalLastWindow: {
      succeeded: nonNegativeCount(aggregate?.succeeded ?? 0),
      failed: nonNegativeCount(aggregate?.failed ?? 0),
      cancelled: nonNegativeCount(aggregate?.cancelled ?? 0),
    },
    duplicateTimeBucketGroups: Math.min(duplicateGroups.length, SCHEDULED_EVALUATION_MAX_DUPLICATE_GROUPS),
    duplicateGroupsTruncated: duplicateGroups.length > SCHEDULED_EVALUATION_MAX_DUPLICATE_GROUPS,
  };
}

export function getScheduledEvaluationQueueDiagnostics(): ScheduledEvaluationQueueDiagnostics {
  return scheduledEvaluationQueueMonitor.getDiagnostics();
}

export async function sampleScheduledEvaluationQueue(
  nowMs = Date.now(),
): Promise<ScheduledEvaluationQueueTransition> {
  return scheduledEvaluationQueueMonitor.observe(
    await readScheduledEvaluationQueueSnapshot(nowMs),
    nowMs,
  );
}

export function clearScheduledEvaluationQueueMonitorForTests(): void {
  scheduledEvaluationQueueMonitor.clearForTests();
}

function safeMessage(value: unknown): string {
  return String(value instanceof Error ? value.message : value).replace(/[\r\n]/g, " ").slice(0, 500);
}

export function assertBoundedJobInput(input: unknown): void {
  assertBoundedJson(input, MAX_INPUT_BYTES, "input");
}

export function assertBoundedJobResult(result: unknown): void {
  assertBoundedJson(result, MAX_RESULT_BYTES, "result");
}

function assertBoundedJson(value: unknown, maxBytes: number, label: string): void {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new Error(`Job ${label} must be JSON serializable`); }
  if (encoded === undefined || Buffer.byteLength(encoded) > maxBytes) {
    throw new Error(`Job ${label} exceeds ${maxBytes} byte limit`);
  }
}

export async function enqueueServerJob(args: {
  scope: Scope; actorId: string; type: string; idempotencyKey: string; input: unknown; snapshotId?: string | null;
}): Promise<{ job: ServerJobRow; created: boolean }> {
  const definition = getServerJobDefinition(args.type);
  if (!definition) throw new Error("Unknown server job type");
  assertBoundedJobInput(args.input);
  const existing = await db.select().from(serverJobsTable).where(and(
    eq(serverJobsTable.scope, args.scope),
    eq(serverJobsTable.actorId, args.actorId),
    eq(serverJobsTable.idempotencyKey, args.idempotencyKey),
  )).limit(1);
  if (existing[0]) return { job: existing[0], created: false };
  const now = new Date();
  const inserted = await db.insert(serverJobsTable).values({
    scope: args.scope, actorId: args.actorId, type: args.type, idempotencyKey: args.idempotencyKey,
    input: args.input, snapshotId: args.snapshotId ?? null, maxAttempts: definition.maxAttempts ?? 3,
    expiresAt: new Date(now.getTime() + RETENTION_MS),
  }).onConflictDoNothing().returning();
  if (inserted[0]) return { job: inserted[0], created: true };
  // The unique index resolves concurrent retries without creating duplicate work.
  const winner = await db.select().from(serverJobsTable).where(and(
    eq(serverJobsTable.scope, args.scope), eq(serverJobsTable.actorId, args.actorId),
    eq(serverJobsTable.idempotencyKey, args.idempotencyKey),
  )).limit(1);
  if (!winner[0]) throw new Error("Unable to create idempotent server job");
  return { job: winner[0], created: false };
}

export type ServerJobContext = {
  job: ServerJobRow;
  signal: AbortSignal;
  reportProgress(progress: number, message?: string): Promise<void>;
  isCancellationRequested(): Promise<boolean>;
  /**
   * Serialize a protected durable or external effect with cancellation.
   *
   * The running job row is locked for the duration of the callback. A
   * cancellation already committed wins and the callback is not entered; a
   * cancellation racing after this boundary has acquired the lock waits until
   * the protected effect has committed.
   */
  commit<T>(effect: () => Promise<T>): Promise<T>;
};

export class ServerJobCancellationError extends Error {
  constructor() {
    super("Job cancelled before protected commit");
    this.name = "ServerJobCancellationError";
  }
}

export class ServerJobWorker {
  constructor(readonly workerId = `in-process-${randomUUID()}`, readonly leaseMs = LEASE_MS) {}

  async claimNext(): Promise<{ job: ServerJobRow; leaseToken: string } | null> {
    const now = new Date();
    const candidates = await db.select().from(serverJobsTable).where(or(
      eq(serverJobsTable.status, "queued"),
      and(eq(serverJobsTable.status, "running"), lte(serverJobsTable.leaseExpiresAt, now)),
    )).orderBy(asc(serverJobsTable.createdAt)).limit(8);
    for (const candidate of candidates) {
      // A dead worker's last attempt must not turn a bounded retry policy into
      // an endless reclaim loop. Resolve it before another worker can run it.
      if (candidate.attempt >= candidate.maxAttempts) {
        const exhausted = await db.update(serverJobsTable).set({
          status: "failed", finishedAt: now, leaseToken: null, leaseExpiresAt: null,
          errorCode: "attempts_exhausted", errorMessage: "Job lease expired after its final allowed attempt",
        }).where(candidate.status === "queued"
          ? and(eq(serverJobsTable.id, candidate.id), eq(serverJobsTable.status, "queued"))
          : and(eq(serverJobsTable.id, candidate.id), eq(serverJobsTable.status, "running"),
            lte(serverJobsTable.leaseExpiresAt, now))).returning({ id: serverJobsTable.id });
        if (exhausted[0] && candidate.attempt > 0) {
          await db.update(serverJobAttemptsTable).set({
            finishedAt: now, outcome: "failed", errorCode: "attempts_exhausted",
            errorMessage: "Worker lease expired",
          }).where(and(eq(serverJobAttemptsTable.jobId, candidate.id), eq(serverJobAttemptsTable.attempt, candidate.attempt)));
        }
        continue;
      }
      const leaseToken = randomUUID();
      const claimed = await db.update(serverJobsTable).set({
        status: "running", leaseToken, leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
        startedAt: candidate.startedAt ?? now, attempt: candidate.attempt + 1,
      }).where(candidate.status === "queued"
        ? and(eq(serverJobsTable.id, candidate.id), eq(serverJobsTable.status, "queued"))
        : and(eq(serverJobsTable.id, candidate.id), eq(serverJobsTable.status, "running"),
          lte(serverJobsTable.leaseExpiresAt, now)))
        .returning();
      if (claimed[0]) {
        await db.insert(serverJobAttemptsTable).values({
          jobId: claimed[0].id, attempt: claimed[0].attempt, workerId: this.workerId,
        }).onConflictDoNothing();
        return { job: claimed[0], leaseToken };
      }
    }
    return null;
  }

  async runOnce(): Promise<boolean> {
    const claimed = await this.claimNext();
    if (!claimed) return false;
    // A cancellation request can race a worker claim. Do not enter user-owned
    // handler code once the durable cancellation flag is visible.
    if ((await this.owned(claimed.job.id, claimed.leaseToken))?.cancelRequested) {
      await this.finish(claimed.job, claimed.leaseToken, "cancelled");
      return true;
    }
    const controller = new AbortController();
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy || commitActive) return;
      heartbeatBusy = true;
      void this.renewLease(claimed.job.id, claimed.leaseToken)
        .catch(() => controller.abort())
        .finally(() => { heartbeatBusy = false; });
    // Keep the cadence below one third of the lease, including short leases
    // used by deterministic multi-worker tests.
    }, Math.max(25, Math.floor(this.leaseMs / 3)));
    heartbeat.unref();
    let commitActive = false;
    let timedOut = false;
    try {
      const definition = getServerJobDefinition(claimed.job.type);
      if (!definition?.handler) {
        await this.finish(claimed.job, claimed.leaseToken, "failed", undefined, "handler_unavailable", "No handler is registered");
        return true;
      }
      const timeoutMs = definition.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
      let timeout: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("Job execution timed out"));
        }, timeoutMs);
        timeout.unref();
      });
      const result = await Promise.race([
        definition.handler({
        job: claimed.job, signal: controller.signal,
        reportProgress: (progress, message) => this.progress(claimed.job.id, claimed.leaseToken, progress, message),
        isCancellationRequested: async () => {
          const row = await this.owned(claimed.job.id, claimed.leaseToken);
          if (!row || row.cancelRequested) controller.abort();
          return !row || row.cancelRequested;
        },
        commit: <T>(effect: () => Promise<T>) =>
          this.commit(claimed.job.id, claimed.leaseToken, effect, controller, this.leaseMs, () => {
            commitActive = true;
          }, () => {
            commitActive = false;
          }),
        }),
        deadline,
      ]).finally(() => { if (timeout) clearTimeout(timeout); });
      assertBoundedJobResult(result);
      const row = await this.owned(claimed.job.id, claimed.leaseToken);
      await this.finish(claimed.job, claimed.leaseToken, row?.cancelRequested ? "cancelled" : "succeeded", result);
    } catch (error) {
      const current = await this.owned(claimed.job.id, claimed.leaseToken);
      const cancelled = current?.cancelRequested || (controller.signal.aborted && !timedOut);
      // An ignored AbortSignal could otherwise leave an external provider call
      // alive while a retry performs the same protected work. Timeouts are final.
      const retry = !cancelled && !timedOut && claimed.job.attempt < claimed.job.maxAttempts;
      await this.finish(claimed.job, claimed.leaseToken, cancelled ? "cancelled" : retry ? "queued" : "failed",
        undefined, timedOut ? "execution_timeout" : "handler_failed", safeMessage(error));
      if (isTransientDatabaseConnectionError(error)) {
        await recordBackgroundOperationFailure("server-job-run", error);
      }
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  private async commit<T>(
    id: string,
    leaseToken: string,
    effect: () => Promise<T>,
    controller: AbortController,
    leaseMs: number,
    onStart: () => void,
    onFinish: () => void,
  ): Promise<T> {
    let started = false;
    try {
      return await db.transaction(async (tx) => {
        const row = (await tx.select().from(serverJobsTable).where(and(
          eq(serverJobsTable.id, id),
          eq(serverJobsTable.status, "running"),
          eq(serverJobsTable.leaseToken, leaseToken),
        )).for("update").limit(1))[0];
        if (!row) throw new Error("Job lease is no longer owned");
        if (row.cancelRequested) {
          controller.abort();
          throw new ServerJobCancellationError();
        }
        onStart();
        started = true;
        let heartbeatBusy = false;
        const heartbeat = setInterval(() => {
          if (heartbeatBusy) return;
          heartbeatBusy = true;
          void tx.update(serverJobsTable).set({
            leaseExpiresAt: new Date(Date.now() + leaseMs),
          }).where(and(
            eq(serverJobsTable.id, id),
            eq(serverJobsTable.status, "running"),
            eq(serverJobsTable.leaseToken, leaseToken),
          )).then(() => undefined).catch(() => controller.abort()).finally(() => { heartbeatBusy = false; });
        }, Math.max(25, Math.floor(leaseMs / 3)));
        heartbeat.unref();
        try {
          return await effect();
        } finally {
          clearInterval(heartbeat);
        }
      });
    } finally {
      if (started) onFinish();
    }
  }

  private async owned(id: string, leaseToken: string): Promise<ServerJobRow | undefined> {
    return (await db.select().from(serverJobsTable).where(and(
      eq(serverJobsTable.id, id), eq(serverJobsTable.status, "running"), eq(serverJobsTable.leaseToken, leaseToken),
    )).limit(1))[0];
  }

  private async progress(id: string, leaseToken: string, progress: number, message?: string): Promise<void> {
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error("Progress must be 0 through 100");
    const updated = await db.update(serverJobsTable).set({
      progress, progressMessage: message?.slice(0, 300) ?? null,
      leaseExpiresAt: new Date(Date.now() + this.leaseMs),
    }).where(and(eq(serverJobsTable.id, id), eq(serverJobsTable.status, "running"), eq(serverJobsTable.leaseToken, leaseToken)))
      .returning({ id: serverJobsTable.id });
    if (!updated[0]) throw new Error("Job lease is no longer owned");
  }

  private async renewLease(id: string, leaseToken: string): Promise<void> {
    const updated = await db.update(serverJobsTable).set({
      leaseExpiresAt: new Date(Date.now() + this.leaseMs),
    }).where(and(eq(serverJobsTable.id, id), eq(serverJobsTable.status, "running"), eq(serverJobsTable.leaseToken, leaseToken)))
      .returning({ id: serverJobsTable.id });
    if (!updated[0]) throw new Error("Job lease is no longer owned");
  }

  private async finish(job: ServerJobRow, leaseToken: string, status: "queued" | "succeeded" | "failed" | "cancelled",
    result?: unknown, errorCode?: string, errorMessage?: string): Promise<void> {
    const terminal = status !== "queued";
    const updated = await db.update(serverJobsTable).set({
      status, ...(status === "succeeded" ? { progress: 100, result } : {}),
      ...(status === "queued" ? { leaseToken: null, leaseExpiresAt: null } : { finishedAt: new Date(), leaseToken: null, leaseExpiresAt: null }),
      errorCode: errorCode ?? null, errorMessage: errorMessage ?? null,
    }).where(and(eq(serverJobsTable.id, job.id), eq(serverJobsTable.status, "running"), eq(serverJobsTable.leaseToken, leaseToken)))
      .returning({ id: serverJobsTable.id });
    if (updated[0]) await db.update(serverJobAttemptsTable).set({
      finishedAt: new Date(), outcome: terminal ? status : "retrying", errorCode: errorCode ?? null, errorMessage: errorMessage ?? null,
    }).where(and(eq(serverJobAttemptsTable.jobId, job.id), eq(serverJobAttemptsTable.attempt, job.attempt)));
  }
}

export async function requestServerJobCancellation(id: string, scope: Scope, actorId: string): Promise<ServerJobRow | undefined> {
  // Queued work is terminal immediately. Running work observes this flag at
  // checkpoints, avoiding an unsafe attempt to interrupt arbitrary JS.
  const queued = await db.update(serverJobsTable).set({
    cancelRequested: true, status: "cancelled", finishedAt: new Date(),
  }).where(and(
    eq(serverJobsTable.id, id), eq(serverJobsTable.scope, scope), eq(serverJobsTable.actorId, actorId),
    eq(serverJobsTable.status, "queued"),
  )).returning();
  if (queued[0]) return queued[0];
  const running = await db.update(serverJobsTable).set({ cancelRequested: true }).where(and(
    eq(serverJobsTable.id, id), eq(serverJobsTable.scope, scope), eq(serverJobsTable.actorId, actorId),
    eq(serverJobsTable.status, "running"),
  )).returning();
  return running[0];
}

export async function pruneExpiredServerJobs(now = new Date()): Promise<number> {
  // Artifact cleanup runs on the same scheduled retention tick as durable job
  // cleanup, not only when another export happens to be written.
  const [deleted] = await Promise.all([
    db.delete(serverJobsTable).where(lte(serverJobsTable.expiresAt, now)).returning({ id: serverJobsTable.id }),
    pruneServerJobArtifacts(now.getTime()),
  ]);
  return deleted.length;
}

export type ServerJobLoopOptions = {
  worker?: Pick<ServerJobWorker, "runOnce">;
  prune?: () => Promise<number>;
  concurrency?: number;
  intervalMs?: number;
  pruneIntervalMs?: number;
  now?: () => number;
  onError?: (error: unknown, operation: "run" | "prune") => void;
};

export type ServerJobLoop = { stop(): void };

const boundedInteger = (value: number | undefined, fallback: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value!))) : fallback;

/**
 * Starts only when the entrypoint calls it after readiness. Timers are unref'd
 * and each tick fills only free slots, so work cannot hold shutdown open or
 * exceed the process's configured concurrency budget.
 */
export function startServerJobWorkerLoop(options: ServerJobLoopOptions = {}): ServerJobLoop {
  const worker = options.worker ?? new ServerJobWorker();
  const concurrency = boundedInteger(options.concurrency ?? Number(process.env.SERVER_JOB_MAX_CONCURRENCY), 2, 1, 4);
  const intervalMs = boundedInteger(options.intervalMs ?? Number(process.env.SERVER_JOB_POLL_INTERVAL_MS), 1_000, 100, 60_000);
  const pruneIntervalMs = boundedInteger(options.pruneIntervalMs ?? Number(process.env.SERVER_JOB_PRUNE_INTERVAL_MS), 60 * 60_000, 60_000, 24 * 60 * 60_000);
  const prune = options.prune ?? (() => pruneExpiredServerJobs());
  const now = options.now ?? Date.now;
  const runBackoff = createBackgroundOperationBackoff();
  const pruneBackoff = createBackgroundOperationBackoff();
  let active = 0;
  let stopped = false;
  let lastPruneAt = 0;
  const tick = () => {
    if (stopped) return;
    const currentTime = now();
    if (currentTime - lastPruneAt >= pruneIntervalMs && pruneBackoff.isReady(currentTime)) {
      lastPruneAt = currentTime;
      void runBackgroundOperation("server-job-prune", prune)
        .then(() => pruneBackoff.recordSuccess())
        .catch((error) => {
          pruneBackoff.recordFailure(now());
          options.onError?.(error, "prune");
        });
    }
    if (!runBackoff.isReady(currentTime)) return;
    while (active < concurrency) {
      active++;
      void runBackgroundOperation("server-job-run", () => worker.runOnce())
        .then(() => runBackoff.recordSuccess())
        .catch((error) => {
          runBackoff.recordFailure(now());
          options.onError?.(error, "run");
        })
        .finally(() => { active--; });
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return { stop: () => { stopped = true; clearInterval(timer); } };
}