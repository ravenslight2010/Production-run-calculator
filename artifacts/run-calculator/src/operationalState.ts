export type OperationalSnapshotReceipt = {
  runId: string;
  snapshotId: string;
  capturedAt: number;
};

export type OperationalDisplayState = "confirmed" | "provisional" | "offline";

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