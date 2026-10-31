import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";

export const DATABASE_CAPACITY_INTERVAL_MS = 5 * 60_000;
const QUERY_DEADLINE_MS = 1_500;
type CapacityPool = Pick<Pool, "connect" | "totalCount" | "idleCount" | "waitingCount" | "options">;
type BuildIdentity = {
  appBuildId?: string;
  sourceFingerprintSha256?: string;
  platformBuildId?: string | null;
};
type CapacityFailureStage = "pool_checkout" | "capacity_query" | "capacity_result";

const TIMEOUT_CODES = new Set(["ETIMEOUT", "ETIMEDOUT", "ESOCKETTIMEDOUT"]);

function errorDetails(error: unknown): { code: string | null; message: string | null } {
  if (!(error instanceof Error)) return { code: null, message: null };
  const code = "code" in error && typeof error.code === "string" ? error.code : null;
  return { code, message: error.message };
}

function isRecognizedTimeout(error: unknown): boolean {
  const details = errorDetails(error);
  return (details.code !== null && TIMEOUT_CODES.has(details.code)) ||
    details.message === "Query read timeout" ||
    details.message === "timeout exceeded when trying to connect" ||
    details.message === "Connection terminated due to connection timeout" ||
    details.message === "timeout expired";
}

function unavailableReason(stage: CapacityFailureStage, error: unknown) {
  const details = errorDetails(error);
  if (stage === "pool_checkout") {
    return isRecognizedTimeout(error) ? "pool_checkout_timeout" : "pool_checkout_failed";
  }
  if (stage === "capacity_result") return "invalid_capacity_result";
  if (isRecognizedTimeout(error)) return "capacity_query_timeout";
  if (details.code === "57014") return "capacity_query_cancelled";
  return "capacity_query_failed";
}

// Only numeric settings and counts leave PostgreSQL. No database, role, host,
// application names, queries, or operational records are selected.
const CAPACITY_SQL = `
SELECT pg_is_in_recovery() AS replica,
       current_setting('max_connections')::int AS max_connections,
       current_setting('superuser_reserved_connections')::int AS superuser_reserved,
       COALESCE(current_setting('reserved_connections', true), '0')::int AS role_reserved,
       count(*)::int AS client_backends,
       count(*) FILTER (WHERE state = 'active')::int AS active_backends,
       count(*) FILTER (WHERE state = 'idle')::int AS idle_backends,
       count(*) FILTER (WHERE state IS NOT NULL)::int AS visible_states,
       count(*) FILTER (
         WHERE state = 'active' AND wait_event_type IS NOT NULL
       )::int AS active_wait_backends,
       count(*) FILTER (
         WHERE state = 'active' AND wait_event_type = 'Lock'
       )::int AS lock_wait_backends
FROM pg_stat_activity
WHERE backend_type = 'client backend'`;

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000_000) {
    throw new Error("invalid capacity count");
  }
  return value;
}

function identity(build: BuildIdentity | null) {
  const identifier = (value: unknown): string | null =>
    typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
  return {
    appBuildId: identifier(build?.appBuildId),
    sourceFingerprintSha256: identifier(build?.sourceFingerprintSha256),
    platformBuildId: identifier(build?.platformBuildId),
  };
}

export async function collectDatabaseCapacity(pool: CapacityPool) {
  let client: PoolClient | undefined;
  let discard = false;
  let stage: CapacityFailureStage = "pool_checkout";
  try {
    // The shared pool's cancellation-safe checkout deadline remains unchanged.
    client = await pool.connect();
    stage = "capacity_query";
    const query = (text: string) => {
      // node-postgres supports the per-query client deadline at runtime; its
      // public QueryConfig type omits this field, so retain the typed config
      // as a variable rather than asserting away the result type.
      const config = { text, query_timeout: QUERY_DEADLINE_MS };
      return client!.query<Record<string, unknown>>(config);
    };
    await query("BEGIN READ ONLY");
    await query("SET LOCAL statement_timeout = '1000ms'");
    const result = await query(CAPACITY_SQL);
    await query("COMMIT");
    stage = "capacity_result";
    const row = result.rows[0];
    if (!row || typeof row.replica !== "boolean") throw new Error("invalid capacity result");
    const maximum = count(row.max_connections);
    const superuserReserved = count(row.superuser_reserved);
    const roleReserved = count(row.role_reserved);
    const clients = count(row.client_backends);
    const activeBackends = count(row.active_backends);
    const activeWaitingBackends = count(row.active_wait_backends);
    const lockWaitingBackends = count(row.lock_wait_backends);
    if (
      activeBackends > clients ||
      activeWaitingBackends > activeBackends ||
      lockWaitingBackends > activeWaitingBackends
    ) {
      throw new Error("invalid capacity wait counts");
    }
    return {
      status: row.replica ? "non_primary" : "observed",
      primaryVerified: !row.replica,
      maxConnections: maximum,
      superuserReservedSlots: superuserReserved,
      roleReservedSlots: roleReserved,
      serverClientBackends: clients,
      activeBackends,
      idleBackends: count(row.idle_backends),
      activeWaitingBackends,
      lockWaitingBackends,
      stateVisibilityComplete: count(row.visible_states) === clients,
      // A conservative PostgreSQL estimate, not provider-wide capacity proof.
      // Includes the diagnostic's own backend; provider reserves may add limits.
      estimatedOrdinarySlotsRemaining: row.replica
        ? null : Math.max(0, maximum - superuserReserved - roleReserved - clients),
    };
  } catch (error) {
    // Destroy rather than return a potentially timed-out/read-only transaction
    // to the shared pool. Never log raw PostgreSQL errors or retry under load.
    discard = true;
    return {
      status: "unavailable",
      primaryVerified: false,
      unavailableReason: unavailableReason(stage, error),
    };
  } finally {
    client?.release(discard);
  }
}

export function startDatabaseCapacityCollection(
  pool: CapacityPool,
  log: Pick<Logger, "info">,
  getBuild: () => BuildIdentity | null,
): { stop: () => void } {
  let stopped = false;
  let running = false;
  const sample = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const database = await collectDatabaseCapacity(pool);
      if (!stopped) {
        log.info({
          event: "database_capacity_sample",
          schemaVersion: 2,
          environment: process.env.NODE_ENV === "production" ? "production" : "development",
          capturedAt: new Date().toISOString(),
          intervalMs: DATABASE_CAPACITY_INTERVAL_MS,
          build: identity(getBuild()),
          pool: {
            max: pool.options.max,
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount,
          },
          database,
          limitations: {
            diagnosticBackendIncluded: true,
            providerReservedSlots: "unknown",
            autoscaleCurrentInstances: null,
            autoscaleMaximumInstances: null,
          },
        }, "bounded read-only database capacity sample");
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void sample(); }, DATABASE_CAPACITY_INTERVAL_MS);
  timer.unref();
  void sample();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
