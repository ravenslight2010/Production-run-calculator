import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { IMPORT_SOURCE_RETENTION_MS } from "@workspace/db/schema";
import { logger } from "./logger";
import {
  createBackgroundOperationBackoff,
  runBackgroundOperation,
} from "./backgroundOperations";

export const IMPORT_SOURCE_RETENTION_BATCH_SIZE = 100;
export const IMPORT_SOURCE_RETENTION_MAX_BATCHES_PER_RUN = 10;

export type ImportSourceRetentionResult = {
  sourceTextsRemoved: number;
  batchesProcessed: number;
};

async function removeExpiredSourceText(now: number): Promise<number> {
  const cutoff = new Date(now - IMPORT_SOURCE_RETENTION_MS);
  const result = await db.execute(sql`
    WITH expired AS (
      SELECT id
      FROM import_operations
      WHERE scope = 'live'
        AND import_type = 'spec'
        AND status IN ('applied', 'undone')
        AND actor_id IS NOT NULL
        AND distill_evidence->>'format' = 'spec-apply-source-v1'
        AND distill_evidence->>'actorCapability' = 'manage-profiles'
        AND distill_evidence->>'actorIdSha256' ~ '^[a-f0-9]{64}$'
        AND jsonb_typeof(distill_evidence->'sourceText') = 'string'
        AND length(distill_evidence->>'sourceText') > 0
        AND created_at <= ${cutoff}
      ORDER BY created_at, id
      LIMIT ${IMPORT_SOURCE_RETENTION_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE import_operations AS operation
    SET distill_evidence = operation.distill_evidence - 'sourceText'
    FROM expired
    WHERE operation.id = expired.id
      AND operation.scope = 'live'
      AND operation.import_type = 'spec'
    RETURNING 1 AS removed
  `);
  return result.rows.length;
}

export async function runImportSourceRetention(
  now = Date.now(),
): Promise<ImportSourceRetentionResult> {
  let sourceTextsRemoved = 0;
  let batchesProcessed = 0;
  for (let batch = 0; batch < IMPORT_SOURCE_RETENTION_MAX_BATCHES_PER_RUN; batch++) {
    const removed = await removeExpiredSourceText(now);
    if (removed === 0) break;
    sourceTextsRemoved += removed;
    batchesProcessed++;
    if (removed < IMPORT_SOURCE_RETENTION_BATCH_SIZE) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { sourceTextsRemoved, batchesProcessed };
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type ImportSourceRetentionScheduler = { stop(): void };

export function startImportSourceRetentionScheduler(options: {
  intervalMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
} = {}): ImportSourceRetentionScheduler {
  const configuredInterval = options.intervalMs ?? Number(process.env.IMPORT_SOURCE_RETENTION_INTERVAL_MS);
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
    void runBackgroundOperation("import-source-retention", () => runImportSourceRetention(currentTime))
      .then((safeCounts) => {
        backoff.recordSuccess();
        logger.info(
          { event: "apply_source_retention", outcome: "success", safeCounts },
          "Apply source retention cleanup completed",
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