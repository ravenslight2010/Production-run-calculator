import {
  rebaseStaleSyncIntent as rebaseSyncDocument,
  type StaleBaseRecoveryResult as SharedStaleBaseRecoveryResult,
} from "@workspace/sync-contract/stale-base-recovery";
import type { SyncPayload } from "./types";

export type StaleBaseRecoveryResult = Omit<SharedStaleBaseRecoveryResult, "payload"> & {
  payload: SyncPayload;
};

export function rebaseStaleSyncIntent(
  baseSnapshot: SyncPayload,
  queuedIntent: SyncPayload,
  canonicalSnapshot: SyncPayload,
  options: { snapshotId?: string; serverTime?: number } = {},
): StaleBaseRecoveryResult {
  const result = rebaseSyncDocument(baseSnapshot, queuedIntent, canonicalSnapshot, options);
  return {
    ...result,
    payload: result.payload as unknown as SyncPayload,
  };
}
