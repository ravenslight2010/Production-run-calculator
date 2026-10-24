import { AsyncLocalStorage } from "node:async_hooks";

// These describe client-observed boundaries, never PostgreSQL execution time.
export const DATABASE_PHASE_STAGES = ["status_aggregate", "duplicate_group_scan"] as const;
const OUTCOMES = [
  "success", "cancelled", "checkout_timeout", "connection_timeout",
  "connection_failed", "acquisition_failed", "query_timeout", "failed", "shutdown", "unknown",
] as const;
const COVERAGE = ["complete", "unobserved", "multiple_checkouts", "incomplete", "shutdown"] as const;
const MAX_MS = 600_000;
const MAX_ACTIVE = 32;
type Stage = typeof DATABASE_PHASE_STAGES[number];
type Outcome = typeof OUTCOMES[number];
type Phase = "acquisition" | "post_checkout" | "unknown";
export type DatabasePhaseEvidence = {
  version: 1;
  stage: Stage;
  coverage: typeof COVERAGE[number];
  phase: Phase;
  outcome: Outcome;
  observedFrom: string;
  observedUntil: string;
  elapsedMs: number;
  acquisitionMs: number | null;
  postCheckoutMs: number | null;
  timeoutOverrunMs: number | null;
};
type Scope = {
  stage: Stage;
  started: number;
  from: number;
  checkouts: number;
  checkoutStarted?: number;
  checkoutFinished?: number;
  checkoutError?: unknown;
  timeoutMs?: number;
  complete: boolean;
  publish: (evidence: DatabasePhaseEvidence) => void;
};
const context = new AsyncLocalStorage<Scope | undefined>();
const active = new Set<Scope>();

function milliseconds(value: number): number {
  return Math.min(MAX_MS, Math.max(0, Math.round(value)));
}

// Inspect a short cause chain, but never retain or emit messages/codes/payloads.
function classifyUnsafe(error: unknown, phase: Phase): Outcome {
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && error instanceof Error && !seen.has(error); depth++) {
    seen.add(error);
    const code = "code" in error ? error.code : undefined;
    if (error.name === "AbortError" || code === "ABORT_ERR") return "cancelled";
    if (phase === "acquisition") {
      if (error.message === "timeout exceeded when trying to connect") return "checkout_timeout";
      if (error.message === "Connection terminated due to connection timeout") return "connection_timeout";
      if (code === "ECONNREFUSED" || code === "ENOTFOUND") return "connection_failed";
    }
    if (phase === "post_checkout") {
      if (error.message === "Query read timeout" ||
          (code === "57014" && error.message === "canceling statement due to statement timeout")) {
        return "query_timeout";
      }
      if (code === "57014") return "cancelled";
    }
    error = error.cause;
  }
  return phase === "acquisition" ? "acquisition_failed" : "failed";
}

function classify(error: unknown, phase: Phase): Outcome {
  try { return classifyUnsafe(error, phase); }
  catch { return "unknown"; }
}

/** Called at the existing pool.connect boundary; does not own any waiter/timer. */
export function startDatabasePhaseCheckout(timeoutMs: number | undefined): (error?: unknown) => void {
  const scope = context.getStore();
  if (!scope || scope.complete) return () => {};
  scope.checkouts = Math.min(2, scope.checkouts + 1);
  scope.checkoutStarted = performance.now();
  scope.timeoutMs = timeoutMs;
  return (error) => {
    if (scope.complete) return;
    scope.checkoutFinished = performance.now();
    scope.checkoutError = error;
  };
}

function finish(
  scope: Scope,
  completion: "success" | "failure" | "shutdown",
  error?: unknown,
): DatabasePhaseEvidence | undefined {
  if (scope.complete) return;
  scope.complete = true;
  active.delete(scope);
  const now = performance.now();
  const single = scope.checkouts === 1;
  const checkedOut = single && scope.checkoutFinished !== undefined && scope.checkoutError == null;
  const phase: Phase = !single ? "unknown" : checkedOut ? "post_checkout" : "acquisition";
  const shutdown = completion === "shutdown";
  const outcome = shutdown ? "shutdown" : completion === "success" ? "success" :
    classify(scope.checkoutError ?? error, phase);
  const acquisitionMs = single && scope.checkoutStarted !== undefined && scope.checkoutFinished !== undefined
    ? milliseconds(scope.checkoutFinished - scope.checkoutStarted) : null;
  const evidence: DatabasePhaseEvidence = {
    version: 1,
    stage: scope.stage,
    coverage: shutdown ? "shutdown" : scope.checkouts > 1 ? "multiple_checkouts" :
      scope.checkouts === 0 ? "unobserved" : scope.checkoutFinished === undefined ? "incomplete" : "complete",
    phase,
    outcome,
    observedFrom: new Date(scope.from).toISOString(),
    observedUntil: new Date(Date.now()).toISOString(),
    elapsedMs: milliseconds(now - scope.started),
    acquisitionMs,
    postCheckoutMs: checkedOut && !shutdown ? milliseconds(now - scope.checkoutFinished!) : null,
    timeoutOverrunMs: acquisitionMs !== null && scope.timeoutMs !== undefined &&
      (outcome === "checkout_timeout" || outcome === "connection_timeout")
      ? milliseconds(acquisitionMs - scope.timeoutMs) : null,
  };
  try { scope.publish(evidence); } catch { /* Diagnostics cannot change the operation. */ }
  // Avoid retaining a driver error (which may contain query parameters).
  scope.checkoutError = undefined;
  return evidence;
}

/** Observe exactly one existing queue-stage operation, without changing its result/error. */
export async function observeDatabasePhase<T>(
  stage: Stage,
  operation: () => PromiseLike<T> | T,
  publish: (evidence: DatabasePhaseEvidence) => void,
): Promise<T> {
  const scope: Scope = {
    stage, publish, started: performance.now(), from: Date.now(), checkouts: 0, complete: false,
  };
  // Overflow is explicitly unobserved; never inherit the caller's scope.
  const tracked = active.size < MAX_ACTIVE;
  if (tracked) active.add(scope);
  return context.run(tracked ? scope : undefined, async () => {
    try {
      const result = await operation();
      finish(scope, "success");
      return result;
    } catch (error) {
      finish(scope, "failure", error);
      throw error;
    }
  });
}

/** A shutdown record means observation ended, not that work was cancelled. */
export function stopDatabasePhaseObservations(): void {
  for (const scope of active) finish(scope, "shutdown");
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const validMs = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_MS;
const validTimestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

/** Offline projection: never spread an input record, including legacy/error fields. */
export function summarizeDatabasePhaseRecords(records: Iterable<unknown>) {
  const summary = {
    version: 1,
    records: 0,
    legacyOrInvalid: 0,
    coverage: Object.fromEntries(COVERAGE.map((key) => [key, 0])) as Record<typeof COVERAGE[number], number>,
    phases: { acquisition: 0, post_checkout: 0, unknown: 0 },
    outcomes: Object.fromEntries(OUTCOMES.map((key) => [key, 0])) as Record<Outcome, number>,
    acquisition: { observed: 0, maxMs: null as number | null },
    postCheckout: { observed: 0, maxMs: null as number | null },
  };
  for (const record of records) {
    const row = object(record);
    if (row.event !== "background_database_phase" && row.event !== "scheduled_evaluation_queue_monitor") continue;
    // Modern queue logs also carry evidence; count only the dedicated event.
    if (row.event === "scheduled_evaluation_queue_monitor" && row.databasePhaseVersion === 1) continue;
    summary.records++;
    const value = object(row.databasePhase);
    const phase = value.phase;
    const valid = row.event === "background_database_phase" && value.version === 1 &&
      DATABASE_PHASE_STAGES.includes(value.stage as Stage) &&
      COVERAGE.includes(value.coverage as typeof COVERAGE[number]) &&
      OUTCOMES.includes(value.outcome as Outcome) &&
      (phase === "acquisition" || phase === "post_checkout" || phase === "unknown") &&
      validMs(value.elapsedMs) &&
      validTimestamp(value.observedFrom) && validTimestamp(value.observedUntil) &&
      (value.timeoutOverrunMs === null || validMs(value.timeoutOverrunMs)) &&
      (value.acquisitionMs === null || validMs(value.acquisitionMs)) &&
      (value.postCheckoutMs === null || validMs(value.postCheckoutMs)) &&
      (value.coverage !== "unobserved" && value.coverage !== "multiple_checkouts" ||
        (phase === "unknown" && value.acquisitionMs === null && value.postCheckoutMs === null)) &&
      (phase !== "acquisition" || value.postCheckoutMs === null) &&
      (phase !== "post_checkout" || value.acquisitionMs !== null &&
        (value.postCheckoutMs !== null || value.coverage === "shutdown"));
    if (!valid) {
      summary.legacyOrInvalid++;
      summary.phases.unknown++;
      summary.outcomes.unknown++;
      continue;
    }
    summary.phases[phase as Phase]++;
    summary.coverage[value.coverage as typeof COVERAGE[number]]++;
    summary.outcomes[value.outcome as Outcome]++;
    for (const [key, field] of [["acquisition", "acquisitionMs"], ["postCheckout", "postCheckoutMs"]] as const) {
      const ms = value[field];
      if (validMs(ms)) {
        summary[key].observed++;
        summary[key].maxMs = Math.max(summary[key].maxMs ?? 0, ms);
      }
    }
  }
  return summary;
}
