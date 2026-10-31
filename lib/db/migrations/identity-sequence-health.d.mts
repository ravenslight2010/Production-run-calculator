import type pg from "pg";

export const IDENTITY_SEQUENCE_HEALTH_MAX_TARGETS: number;

export type IdentitySequenceHealthResult = {
  checked: number;
  driftedCount: number;
  driftedTargets: string[];
  targetsTruncated: boolean;
  hadDrift: boolean;
  warningStarted: boolean;
  warningCleared: boolean;
};

export function runIdentitySequenceHealthCheck(
  pool: pg.Pool,
  previousHadDrift?: boolean,
): Promise<IdentitySequenceHealthResult>;
