import type { SyncPayload } from "./types";
import {
  isCanonicalRecoverySyncPayload,
  isUnchangedSyncResponse,
  isValidSyncSnapshotId,
  readCurrentRecoveryJson,
  syncPayloadMatchesSnapshot,
} from "./syncWriteResponse";

export type ForegroundRecoveryResponseResult =
  | { accepted: true; kind: "unchanged"; snapshotId: string }
  | { accepted: true; kind: "canonical"; snapshotId: string; payload: SyncPayload }
  | { accepted: false; reason: "obsolete" };

interface ConsumeForegroundRecoveryResponseOptions {
  response: Response;
  expectedDate: string;
  requestedSnapshotId: string;
  isCurrent: () => boolean;
  adoptUnchanged: (body: {
    snapshotId: string;
    canonicalRevision?: number;
  }) => void | Promise<void>;
  adoptCanonical: (payload: SyncPayload, snapshotId: string) => void | Promise<void>;
}

/**
 * Validates a foreground recovery response before allowing any canonical
 * state mutation. The injected adoption callbacks are the transaction boundary:
 * callers may release their write fence only after this function accepts.
 */
export async function consumeForegroundRecoveryResponse({
  response,
  expectedDate,
  requestedSnapshotId,
  isCurrent,
  adoptUnchanged,
  adoptCanonical,
}: ConsumeForegroundRecoveryResponseOptions): Promise<ForegroundRecoveryResponseResult> {
  if (!isCurrent()) return { accepted: false, reason: "obsolete" };
  if (!response.ok) throw new Error(`foreground sync GET failed: ${response.status}`);

  const parsed = await readCurrentRecoveryJson(response, isCurrent);
  if (!parsed.current) return { accepted: false, reason: "obsolete" };
  const body = parsed.body as SyncPayload | {
    unchanged?: boolean;
    snapshotId?: string;
    canonicalRevision?: number;
  } | null;

  if (body && typeof body === "object" && "unchanged" in body && body.unchanged === true) {
    if (!isUnchangedSyncResponse(body)) {
      throw new Error("foreground sync GET returned a malformed unchanged response");
    }
    const snapshotId = body.snapshotId;
    if (!isValidSyncSnapshotId(snapshotId)) {
      throw new Error("foreground sync GET returned an invalid snapshot identity");
    }
    if (snapshotId !== requestedSnapshotId) {
      throw new Error("foreground sync GET unchanged identity does not match its request");
    }
    if (!isCurrent()) return { accepted: false, reason: "obsolete" };
    await adoptUnchanged({ snapshotId, canonicalRevision: body.canonicalRevision });
    return { accepted: true, kind: "unchanged", snapshotId };
  }

  const completeness = response.headers.get("X-Sync-Response");
  if (!isCanonicalRecoverySyncPayload(body, expectedDate, completeness)) {
    throw new Error("foreground sync GET returned a malformed canonical response");
  }
  const snapshotId = response.headers.get("X-Sync-Snapshot");
  if (!isValidSyncSnapshotId(snapshotId)) {
    throw new Error("foreground sync GET returned an invalid snapshot identity");
  }
  if (!await syncPayloadMatchesSnapshot(body, snapshotId, { stripReadModel: true })) {
    throw new Error("foreground sync GET snapshot does not match its canonical payload");
  }
  if (!isCurrent()) return { accepted: false, reason: "obsolete" };
  await adoptCanonical(body, snapshotId);
  return { accepted: true, kind: "canonical", snapshotId, payload: body };
}