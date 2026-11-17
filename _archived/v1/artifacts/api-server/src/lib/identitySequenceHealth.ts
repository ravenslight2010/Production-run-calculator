import { pool } from "@workspace/db";
import {
  runIdentitySequenceHealthCheck,
  type IdentitySequenceHealthResult,
} from "@workspace/db/identity-sequence-health";
import { logger } from "./logger";

export const IDENTITY_SEQUENCE_HEALTH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const IDENTITY_SEQUENCE_HEALTH_STARTUP_DELAY_MS = 10_000;
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_STARTUP_DELAY_MS = 10 * 60 * 1000;

type HealthLogger = Pick<typeof logger, "info" | "warn">;
type HealthCheck = (
  previousHadDrift: boolean,
) => Promise<IdentitySequenceHealthResult>;

function boundedInterval(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(value!)));
}

function boundedStartupDelay(value: number | undefined): number {
  if (!Number.isFinite(value)) return IDENTITY_SEQUENCE_HEALTH_STARTUP_DELAY_MS;
  return Math.min(MAX_STARTUP_DELAY_MS, Math.max(1_000, Math.floor(value!)));
}

export type IdentitySequenceHealthScheduler = { stop(): void };

export function startIdentitySequenceHealthScheduler(options: {
  intervalMs?: number;
  startupDelayMs?: number;
  runCheck?: HealthCheck;
  log?: HealthLogger;
} = {}): IdentitySequenceHealthScheduler {
  const intervalMs = boundedInterval(
    options.intervalMs ?? Number(process.env.IDENTITY_SEQUENCE_HEALTH_INTERVAL_MS),
    IDENTITY_SEQUENCE_HEALTH_INTERVAL_MS,
  );
  const startupDelayMs = boundedStartupDelay(
    options.startupDelayMs ?? Number(process.env.IDENTITY_SEQUENCE_HEALTH_STARTUP_DELAY_MS),
  );
  const runCheck = options.runCheck ?? ((previousHadDrift) =>
    runIdentitySequenceHealthCheck(pool, previousHadDrift));
  const log = options.log ?? logger;
  let stopped = false;
  let active = false;
  let previousHadDrift = false;

  const check = async () => {
    if (stopped || active) return;
    active = true;
    try {
      const result = await runCheck(previousHadDrift);
      previousHadDrift = result.hadDrift;
      const safeCounts = {
        checked: result.checked,
        drifted: result.driftedCount,
        targets: result.driftedTargets,
        targetsTruncated: result.targetsTruncated,
      };
      if (result.warningStarted) {
        log.warn({
          event: "identity_sequence_health",
          outcome: "warning",
          safeCounts,
        }, "Identity sequence drift detected");
      } else if (result.warningCleared) {
        log.info({
          event: "identity_sequence_health",
          outcome: "recovered",
          safeCounts,
        }, "Identity sequence drift cleared");
      }
    } catch {
      log.warn({
        event: "identity_sequence_health",
        outcome: "unavailable",
        errorCode: "identity_sequence_health_check_failed",
      }, "Identity sequence health check unavailable");
    } finally {
      active = false;
    }
  };

  const first = setTimeout(() => { void check(); }, startupDelayMs);
  const timer = setInterval(() => { void check(); }, intervalMs);
  first.unref();
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
