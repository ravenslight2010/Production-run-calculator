import {
  rebaseStaleSyncIntent as rebaseSyncDocument,
  type StaleBaseRecoveryResult as SharedStaleBaseRecoveryResult,
} from "@workspace/sync-contract/stale-base-recovery";
import { deepEqual } from "./domain/runSyncPolicy";
import type { SyncPayload } from "./types";

export type StaleBaseRecoveryResult = Omit<SharedStaleBaseRecoveryResult, "payload"> & {
  payload: SyncPayload;
};

export function describeServerWinsConflictOutcome(conflictCount: number): string {
  if (!Number.isSafeInteger(conflictCount) || conflictCount < 0) {
    throw new RangeError("Stale-base conflict count must be a non-negative integer.");
  }
  if (conflictCount === 0) return "";

  const serverOutcome = conflictCount === 1
    ? "kept the server value for 1 conflict"
    : `kept server values for ${conflictCount} conflicts`;
  const localOutcome = conflictCount === 1
    ? "discarded the conflicting local value"
    : "discarded the conflicting local values";
  const reviewInstruction = conflictCount === 1
    ? "review the current value before editing again"
    : "review the current values before editing again";
  return `${serverOutcome}; ${localOutcome}; ${reviewInstruction}`;
}

export function selectUnchangedRunValueIdsForRecovery(
  sentRunValues: Readonly<Record<string, unknown>>,
  recoveredRunValues: Readonly<Record<string, unknown>>,
  currentRunValues: Readonly<Record<string, unknown>>,
): string[] {
  return Object.keys(sentRunValues).filter((id) => (
    recoveredRunValues[id] !== undefined
    && currentRunValues[id] !== undefined
    && deepEqual(currentRunValues[id], sentRunValues[id])
  ));
}

export function shouldResetLiveFormForSync(args: {
  currentRunId?: string;
  hasCurrentRunValues: boolean;
  adoptedPackaging: boolean;
  explicitRebaseAdoption: boolean;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  allowForegroundCanonicalFormReset: boolean;
  localEditQuietMs: number;
  pushAcknowledged: boolean;
  emptyOverPopulated: boolean;
}): boolean {
  return Boolean(
    args.currentRunId
    && (args.hasCurrentRunValues || args.adoptedPackaging)
    && (
      args.adoptedPackaging
      || args.explicitRebaseAdoption
      || (
        args.localUpdatedAt <= args.remoteUpdatedAt
        && (
          args.allowForegroundCanonicalFormReset
          || (args.localEditQuietMs > 2000 && args.pushAcknowledged)
        )
      )
    )
    && !args.emptyOverPopulated
  );
}

export function rebaseStaleSyncIntent(
  baseSnapshot: SyncPayload,
  queuedIntent: SyncPayload,
  canonicalSnapshot: SyncPayload,
  options: { snapshotId?: string; serverTime?: number; enforceOperationalAuthority?: boolean } = {},
): StaleBaseRecoveryResult {
  const result = rebaseSyncDocument(baseSnapshot, queuedIntent, canonicalSnapshot, options);
  return {
    ...result,
    payload: result.payload as unknown as SyncPayload,
  };
}
