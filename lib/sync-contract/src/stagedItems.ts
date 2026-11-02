export type StagedItemRevision = {
  revision: number;
  baseRevision: number;
  baseOperationId: string;
  rootRevision: number;
  rootOperationId: string;
  chainId: string;
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
    && typeof item.baseOperationId === "string"
    && item.baseOperationId.length <= MAX_OPERATION_ID_LENGTH
    && (item.baseOperationId === "" || /^[A-Za-z0-9:_-]+$/.test(item.baseOperationId))
    && Number.isSafeInteger(item.rootRevision)
    && Number(item.rootRevision) >= 0
    && Number(item.rootRevision) <= Number(item.baseRevision)
    && typeof item.rootOperationId === "string"
    && item.rootOperationId.length <= MAX_OPERATION_ID_LENGTH
    && (
      (Number(item.rootRevision) === 0 && item.rootOperationId === "")
      || (Number(item.rootRevision) > 0 && /^[A-Za-z0-9:_-]+$/.test(item.rootOperationId))
    )
    && typeof item.chainId === "string"
    && item.chainId.length > 0
    && item.chainId.length <= MAX_OPERATION_ID_LENGTH
    && /^[A-Za-z0-9:_-]+$/.test(item.chainId)
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
    const sameOperation =
      local.revision === remote.revision
      && local.operationId === remote.operationId
      && localItems[key] === remoteItems[key];
    const sameBase =
      local.baseRevision === remote.baseRevision
      && local.baseOperationId === remote.baseOperationId
      && local.rootRevision === remote.rootRevision
      && local.rootOperationId === remote.rootOperationId;
    const sameChain =
      local.chainId === remote.chainId
      && local.rootRevision === remote.rootRevision
      && local.rootOperationId === remote.rootOperationId;
    const localDescendsFromRemote =
      local.baseRevision === remote.revision
      && local.baseOperationId === remote.operationId;
    const remoteDescendsFromLocal =
      remote.baseRevision === local.revision
      && remote.baseOperationId === local.operationId;
    const localRootMatchesRemote =
      local.rootRevision === remote.revision
      && local.rootOperationId === remote.operationId;
    const remoteRootMatchesLocal =
      remote.rootRevision === local.revision
      && remote.rootOperationId === local.operationId;

    if (sameOperation) {
      copyState(key, remoteItems, remoteVersions, stagedItems, stagedItemVersions);
    } else if (sameBase && local.revision === remote.revision) {
      // Concurrent edits to one row from the same base converge deterministically.
      const remoteWins = compareOperationIds(remote.operationId, local.operationId) < 0;
      copyState(
        key,
        remoteWins ? remoteItems : localItems,
        remoteWins ? remoteVersions : localVersions,
        stagedItems,
        stagedItemVersions,
      );
    } else if (
      (sameChain && local.revision > remote.revision)
      || localDescendsFromRemote
      || localRootMatchesRemote
    ) {
      copyState(key, localItems, localVersions, stagedItems, stagedItemVersions);
    } else if (
      (sameChain && remote.revision > local.revision)
      || remoteDescendsFromLocal
      || remoteRootMatchesLocal
    ) {
      copyState(key, remoteItems, remoteVersions, stagedItems, stagedItemVersions);
    } else {
      // Different branches are resolved to canonical peer state rather than
      // replaying a same-row operation whose ancestry is unknown.
      copyState(key, remoteItems, remoteVersions, stagedItems, stagedItemVersions);
    }
  }

  return { stagedItems, stagedItemVersions, conflictCount: 0 };
}

/**
 * Merge a full sync write under the daily-row lock. Only a new operation based
 * on the stored per-row revision is accepted; retrying the same operation is
 * idempotent. A full write against the current canonical snapshot may contain
 * an offline chain only when its recorded root still matches that row.
 * Simultaneous edits from one base use a deterministic operation-id tie-break.
 */
export function mergeStagedItemsOnServer(
  incomingInput: StagedInputs,
  existingInput: StagedInputs,
  options: { acceptCurrentBaseSnapshot?: boolean } = {},
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
    let conflict = false;

    if (incomingVersion && hasIncomingValue) {
      const currentRevision = existingVersion?.revision ?? 0;
      const currentOperationId = existingVersion?.operationId ?? "";
      const sameOperation = existingVersion?.operationId === incomingVersion.operationId
        && existingVersion.revision === incomingVersion.revision
        && hasExistingValue
        && existingItems[key] === incomingItems[key];
      if (sameOperation) {
        incomingWins = false;
      } else if (
        incomingVersion.baseRevision === currentRevision
        && incomingVersion.baseOperationId === currentOperationId
        && incomingVersion.revision === currentRevision + 1
      ) {
        incomingWins = true;
      } else if (
        options.acceptCurrentBaseSnapshot
        && incomingVersion.rootRevision === currentRevision
        && incomingVersion.rootOperationId === currentOperationId
      ) {
        // The locked snapshot proves the whole row is unchanged since this
        // offline chain's recorded canonical root.
        incomingWins = true;
      } else if (
        options.acceptCurrentBaseSnapshot
        && existingVersion
        && incomingVersion.chainId === existingVersion.chainId
        && incomingVersion.rootRevision === existingVersion.rootRevision
        && incomingVersion.rootOperationId === existingVersion.rootOperationId
        && incomingVersion.revision > existingVersion.revision
      ) {
        incomingWins = true;
      } else if (
        existingVersion
        && incomingVersion.revision === existingVersion.revision
        && incomingVersion.baseRevision === existingVersion.baseRevision
        && incomingVersion.baseOperationId === existingVersion.baseOperationId
        && incomingVersion.rootRevision === existingVersion.rootRevision
        && incomingVersion.rootOperationId === existingVersion.rootOperationId
      ) {
        incomingWins = compareOperationIds(incomingVersion.operationId, existingVersion.operationId) < 0;
        conflict = true;
      } else {
        conflict = true;
      }
    } else if (
      incomingItems[key] === true
      && !existingVersion
    ) {
      // Legacy clients can still add a checked row. Once a versioned decision
      // exists, a boolean-only stale snapshot cannot resurrect or clear it.
      incomingWins = true;
    } else if (incomingItems[key] === true && existingVersion && existingItems[key] === false) {
      conflict = true;
    }

    if (incomingWins) {
      stagedItems[key] = incomingItems[key]!;
      if (incomingVersion) stagedItemVersions[key] = incomingVersion;
    } else {
      copyState(key, existingItems, existingVersions, stagedItems, stagedItemVersions);
    }
    if (conflict) conflictCount++;
  }

  return { stagedItems, stagedItemVersions, conflictCount };
}
