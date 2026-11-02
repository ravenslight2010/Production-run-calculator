export type StagedItemRevision = {
  revision: number;
  baseRevision: number;
  operationId: string;
};

export type StagedItemSnapshot = {
  stagedItems: Record<string, boolean>;
  stagedItemVersions: Record<string, StagedItemRevision>;
  conflictCount: number;
};

const MAX_OPERATION_ID_LENGTH = 120;

function compareOperationIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function isStagedItemVersion(value: unknown): value is StagedItemRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Number.isSafeInteger(item.revision)
    && Number(item.revision) > 0
    && Number.isSafeInteger(item.baseRevision)
    && Number(item.baseRevision) >= 0
    && Number(item.revision) === Number(item.baseRevision) + 1
    && typeof item.operationId === "string"
    && item.operationId.length > 0
    && item.operationId.length <= MAX_OPERATION_ID_LENGTH
    && /^[A-Za-z0-9:_-]+$/.test(item.operationId);
}

type StagedInputs = {
  stagedItems?: unknown;
  stagedItemVersions?: unknown;
};

function asBooleanMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
}

function asVersionMap(value: unknown): Record<string, StagedItemRevision> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, StagedItemRevision] => isStagedItemVersion(entry[1])),
  );
}

function copyState(
  key: string,
  items: Record<string, boolean>,
  versions: Record<string, StagedItemRevision>,
  resultItems: Record<string, boolean>,
  resultVersions: Record<string, StagedItemRevision>,
): void {
  if (Object.prototype.hasOwnProperty.call(items, key)) resultItems[key] = items[key]!;
  if (versions[key]) resultVersions[key] = versions[key]!;
}

/**
 * Merge a peer snapshot without allowing an older operation to undo a newer
 * same-row decision. Different rows remain independent. Legacy boolean-only
 * snapshots retain their historical additive-checked behavior until that row
 * has a versioned decision.
 */
export function mergeStagedItemsFromPeer(
  localInput: StagedInputs,
  remoteInput: StagedInputs,
): StagedItemSnapshot {
  const localItems = asBooleanMap(localInput.stagedItems);
  const localVersions = asVersionMap(localInput.stagedItemVersions);
  const remoteItems = asBooleanMap(remoteInput.stagedItems);
  const remoteVersions = asVersionMap(remoteInput.stagedItemVersions);
  const keys = new Set([
    ...Object.keys(localItems),
    ...Object.keys(localVersions),
    ...Object.keys(remoteItems),
    ...Object.keys(remoteVersions),
  ]);
  const stagedItems: Record<string, boolean> = {};
  const stagedItemVersions: Record<string, StagedItemRevision> = {};

  for (const key of keys) {
    const localVersion = localVersions[key];
    const remoteVersion = remoteVersions[key];
    const localHasValue = Object.prototype.hasOwnProperty.call(localItems, key);
    const remoteHasValue = Object.prototype.hasOwnProperty.call(remoteItems, key);
    if (localVersion && !localHasValue) {
      copyState(key, remoteItems, remoteVersions, stagedItems, stagedItemVersions);
      continue;
    }
    if (remoteVersion && !remoteHasValue) {
      copyState(key, localItems, localVersions, stagedItems, stagedItemVersions);
      continue;
    }

    if (!localVersion && !remoteVersion) {
      // Legacy entries only recorded checked rows; an unchecked row was absent.
      if (localItems[key] === true || remoteItems[key] === true) stagedItems[key] = true;
      continue;
    }
    if (localVersion && !remoteVersion) {
      copyState(key, localItems, localVersions, stagedItems, stagedItemVersions);
      continue;
    }
    if (remoteVersion && !localVersion) {
      copyState(key, remoteItems, remoteVersions, stagedItems, stagedItemVersions);
      continue;
    }

    const local = localVersion!;
    const remote = remoteVersion!;
    const localRevision = local.revision;
    const remoteRevision = remote.revision;
    let remoteWins: boolean;
    if (local.operationId === remote.operationId && localRevision === remoteRevision) {
      remoteWins = true;
    } else if (
      localRevision === remoteRevision
      && local.baseRevision === remote.baseRevision
    ) {
      // Concurrent edits to one row from the same base converge deterministically.
      remoteWins = compareOperationIds(remote.operationId, local.operationId) < 0;
    } else if (remote.baseRevision >= localRevision) {
      remoteWins = true;
    } else if (local.baseRevision >= remoteRevision) {
      remoteWins = false;
    } else if (remoteRevision !== localRevision) {
      // A higher revision whose base is older than the other copy is a stale
      // branch, not a descendant. Prefer the causally current state.
      remoteWins = remoteRevision < localRevision;
    } else {
      remoteWins = compareOperationIds(remote.operationId, local.operationId) < 0;
    }

    copyState(
      key,
      remoteWins ? remoteItems : localItems,
      remoteWins ? remoteVersions : localVersions,
      stagedItems,
      stagedItemVersions,
    );
  }

  return { stagedItems, stagedItemVersions, conflictCount: 0 };
}

/**
 * Merge a full sync write under the daily-row lock. Only a new operation based
 * on the stored per-row revision is accepted; retrying the same operation is
 * idempotent. Simultaneous edits from one base use a deterministic operation-id
 * tie-break, and stale operations are returned as canonical conflicts.
 */
export function mergeStagedItemsOnServer(
  incomingInput: StagedInputs,
  existingInput: StagedInputs,
): StagedItemSnapshot {
  const incomingItems = asBooleanMap(incomingInput.stagedItems);
  const incomingVersions = asVersionMap(incomingInput.stagedItemVersions);
  const existingItems = asBooleanMap(existingInput.stagedItems);
  const existingVersions = asVersionMap(existingInput.stagedItemVersions);
  const keys = new Set([
    ...Object.keys(existingItems),
    ...Object.keys(existingVersions),
    ...Object.keys(incomingItems),
    ...Object.keys(incomingVersions),
  ]);
  const stagedItems: Record<string, boolean> = {};
  const stagedItemVersions: Record<string, StagedItemRevision> = {};
  let conflictCount = 0;

  for (const key of keys) {
    const incomingVersion = incomingVersions[key];
    const existingVersion = existingVersions[key];
    const hasIncomingValue = Object.prototype.hasOwnProperty.call(incomingItems, key);
    const hasExistingValue = Object.prototype.hasOwnProperty.call(existingItems, key);
    let incomingWins = false;

    if (incomingVersion && hasIncomingValue) {
      const currentRevision = existingVersion?.revision ?? 0;
      const sameOperation = existingVersion?.operationId === incomingVersion.operationId
        && existingVersion.revision === incomingVersion.revision
        && hasExistingValue
        && existingItems[key] === incomingItems[key];
      if (sameOperation) {
        incomingWins = false;
      } else if (
        incomingVersion.baseRevision === currentRevision
        && incomingVersion.revision === currentRevision + 1
      ) {
        incomingWins = true;
      } else if (
        existingVersion
        && incomingVersion.revision === existingVersion.revision
        && incomingVersion.baseRevision === existingVersion.baseRevision
        && compareOperationIds(incomingVersion.operationId, existingVersion.operationId) < 0
      ) {
        incomingWins = true;
        conflictCount++;
      } else {
        // Count this rejected operation once, below, after the canonical value
        // is copied into the result.
      }
    } else if (
      incomingItems[key] === true
      && !existingVersion
    ) {
      // Legacy clients can still add a checked row. Once a versioned decision
      // exists, a boolean-only stale snapshot cannot resurrect or clear it.
      incomingWins = true;
    }

    if (incomingWins) {
      stagedItems[key] = incomingItems[key]!;
      if (incomingVersion) stagedItemVersions[key] = incomingVersion;
    } else {
      copyState(key, existingItems, existingVersions, stagedItems, stagedItemVersions);
      if (
        incomingVersion
        && !(
          existingVersion?.operationId === incomingVersion.operationId
          && existingVersion.revision === incomingVersion.revision
          && hasExistingValue
          && existingItems[key] === incomingItems[key]
        )
      ) {
        conflictCount++;
      }
    }
  }

  return { stagedItems, stagedItemVersions, conflictCount };
}
