import { checkIdentitySequenceDrift } from "./check-identity-sequence-drift.mjs";

export const IDENTITY_SEQUENCE_HEALTH_MAX_TARGETS = 8;

/**
 * Run one bounded health pass and return only fixed-schema identifiers and
 * aggregate counts. This function is intentionally read-only; the diagnostic
 * it calls uses a read-only transaction and never advances an identity value.
 */
export async function runIdentitySequenceHealthCheck(pool, previousHadDrift = false) {
  const report = await checkIdentitySequenceDrift(pool);
  const driftedTargets = report
    .filter(({ status }) => status === "drift")
    .map(({ target }) => target);
  const driftedCount = driftedTargets.length;
  const hadDrift = driftedCount > 0;

  return {
    checked: report.length,
    driftedCount,
    driftedTargets: driftedTargets.slice(0, IDENTITY_SEQUENCE_HEALTH_MAX_TARGETS),
    targetsTruncated: driftedCount > IDENTITY_SEQUENCE_HEALTH_MAX_TARGETS,
    hadDrift,
    warningStarted: hadDrift && !previousHadDrift,
    warningCleared: !hadDrift && previousHadDrift,
  };
}
