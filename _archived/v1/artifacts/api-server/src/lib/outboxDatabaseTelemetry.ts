import { observeDatabasePhase, type DatabasePhaseEvidence } from "./databasePhaseTelemetry";

type OutboxReadStage = Extract<DatabasePhaseEvidence["stage"], `outbox_${string}`>;
const SAMPLE_WINDOW_MS = 60_000;

/**
 * At most one normal success, slow success and failure per fixed stage/minute.
 * No timers, queries, retries or identifiers are added. These are diagnostic
 * samples, not a latency population or a count of failed delivery attempts.
 */
export function createOutboxDatabaseObserver(
  publish: (evidence: DatabasePhaseEvidence) => void,
  isStopped: () => boolean,
) {
  const nextSampleAt = new Map<string, number>();
  return <T>(stage: OutboxReadStage, read: () => PromiseLike<T> | T): Promise<T> =>
    observeDatabasePhase(stage, read, (evidence) => {
      if (isStopped()) return;
      const category = evidence.outcome !== "success" ? "failure" :
        evidence.elapsedMs >= 900 ? "slow-success" : "success";
      const key = `${stage}:${category}`;
      const now = performance.now();
      if (now < (nextSampleAt.get(key) ?? -Infinity)) return;
      nextSampleAt.set(key, now + SAMPLE_WINDOW_MS);
      publish(evidence);
    });
}
