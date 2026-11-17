import { logger } from "./logger";
import {
  AUTH_SESSION_RETENTION_DELETE_LIMIT,
  purgeRetainedSessions,
} from "./authSessions";
import {
  purgeRetainedInvitations,
  STAFF_INVITATION_RETENTION_DELETE_LIMIT,
} from "./invitations";
import {
  createBackgroundOperationBackoff,
  runBackgroundOperation,
} from "./backgroundOperations";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTH_RETENTION_MAX_BATCHES_PER_RUN = 100;

export type AuthRetentionResult = {
  sessionsDeleted: number;
  invitationsDeleted: number;
};

export async function runAuthRetention(now = Date.now()): Promise<AuthRetentionResult> {
  const drain = async (
    purgeBatch: (at: number) => Promise<number>,
    batchSize: number,
  ): Promise<number> => {
    let total = 0;
    for (let batch = 0; batch < AUTH_RETENTION_MAX_BATCHES_PER_RUN; batch++) {
      const deleted = await purgeBatch(now);
      total += deleted;
      if (deleted < batchSize) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return total;
  };
  const sessionsDeleted = await drain(
    purgeRetainedSessions,
    AUTH_SESSION_RETENTION_DELETE_LIMIT,
  );
  const invitationsDeleted = await drain(
    purgeRetainedInvitations,
    STAFF_INVITATION_RETENTION_DELETE_LIMIT,
  );
  return { sessionsDeleted, invitationsDeleted };
}

export type AuthRetentionScheduler = { stop(): void };

export function startAuthRetentionScheduler(options: {
  intervalMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
} = {}): AuthRetentionScheduler {
  const configuredInterval = options.intervalMs ??
    Number(process.env.AUTH_RETENTION_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(configuredInterval)))
    : DEFAULT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const backoff = createBackgroundOperationBackoff();
  let stopped = false;
  let active = false;

  const tick = () => {
    const currentTime = now();
    if (stopped || active || !backoff.isReady(currentTime)) return;
    active = true;
    void runBackgroundOperation("auth-retention", () => runAuthRetention(currentTime))
      .then((safeCounts) => {
        backoff.recordSuccess();
        logger.info(
          { event: "auth_retention", outcome: "success", safeCounts },
          "Auth retention cleanup completed",
        );
      })
      .catch((error) => {
        backoff.recordFailure(now());
        options.onError?.(error);
      })
      .finally(() => {
        active = false;
      });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}