export type OperationalSnapshotReceipt = {
  runId: string;
  snapshotId: string;
  capturedAt: number;
  canonicalRevision?: number;
  serverTime?: number;
};

export type OperationalDisplayState = "confirmed" | "provisional" | "offline";

/**
 * Freshness window for adopting a streamed server calc: two 5s tick
 * intervals by default. Older receipts fall back to local computeCalc.
 */
export const LIVE_CALC_STALE_MS = 10_000;

/**
 * A response is usable only for the request that is still current and for a
 * snapshot that is not older than the one already adopted.
 */
export function shouldAdoptOperationalSnapshot(args: {
  requestGeneration: number;
  currentRequestGeneration: number;
  selectedRunId: string;
  responseRunId: string;
  candidate: OperationalSnapshotReceipt;
  adopted: OperationalSnapshotReceipt | null;
}): boolean {
  if (args.requestGeneration !== args.currentRequestGeneration) return false;
  if (!args.selectedRunId || args.selectedRunId !== args.responseRunId) return false;
  if (!Number.isFinite(args.candidate.capturedAt) || !args.candidate.snapshotId) return false;
  if (!args.adopted) return true;
  if (args.candidate.runId !== args.adopted.runId) return true;
  if (args.candidate.capturedAt > args.adopted.capturedAt) return true;
  return args.candidate.capturedAt === args.adopted.capturedAt
    && args.candidate.snapshotId === args.adopted.snapshotId;
}

export function classifyOperationalDisplay(args: {
  online: boolean;
  syncConnected: boolean;
  selectedRunId: string;
  receipt: OperationalSnapshotReceipt | null;
}): OperationalDisplayState {
  if (!args.online || !args.syncConnected) return "offline";
  if (args.receipt?.runId === args.selectedRunId) return "confirmed";
  return "provisional";
}

/**
 * Server-calc adoption guard: use the streamed server calc only while online,
 * sync-connected, a receipt exists for the current run, and that receipt is
 * still inside the freshness window. Outside those conditions the caller falls
 * back to local computeCalc (never a blank UI).
 */
export function shouldUseServerCalc(args: {
  online: boolean;
  syncConnected: boolean;
  receipt: OperationalSnapshotReceipt | null;
  nowMs: number;
  windowMs?: number;
}): boolean {
  if (!args.online || !args.syncConnected) return false;
  if (!args.receipt) return false;
  const windowMs = args.windowMs ?? LIVE_CALC_STALE_MS;
  return Number.isFinite(args.receipt.capturedAt)
    && args.nowMs - args.receipt.capturedAt <= windowMs;
}

