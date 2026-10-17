type JsonRecord = Record<string, unknown>;

export type StaleBaseRecoveryResult = {
  payload: JsonRecord;
  reappliedChanges: number;
  retainedServerConflicts: number;
};

const COUNT_LIMIT = 1_000;
const MAP_FIELDS = new Set(["runValues", "runValuesUpdatedAt", "packagingProgress"]);
const ADDITIVE_LIST_FIELDS = new Set([
  "brands",
  "ingredientTypes",
  "pepTypes",
  "cheeseRecipeNames",
  "mixRecipeNames",
  "doughRecipeNames",
  "frontlineRecipeNames",
]);
const SERVER_ONLY_FIELDS = new Set([
  "operationalProjection",
  "serverTime",
  "canonicalRevision",
  "resetEpoch",
  "rollover",
]);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function addCount(value: number): number {
  return Math.min(COUNT_LIMIT, value + 1);
}

function materializeIntent(base: JsonRecord, intent: JsonRecord): JsonRecord {
  const output = cloneJson(base);
  for (const [key, value] of Object.entries(intent)) {
    if (
      key === "syncVersion"
      || key === "completeness"
      || key === "baseSnapshotId"
      || SERVER_ONLY_FIELDS.has(key)
    ) continue;
    if (MAP_FIELDS.has(key) && isRecord(value)) {
      const merged = isRecord(output[key]) ? { ...output[key] as JsonRecord } : {};
      for (const [mapKey, mapValue] of Object.entries(value)) {
        if (mapValue === null) delete merged[mapKey];
        else merged[mapKey] = cloneJson(mapValue);
      }
      output[key] = merged;
    } else if (key === "dayState" && isRecord(value) && intent.completeness === "partial") {
      output.dayState = {
        ...(isRecord(output.dayState) ? output.dayState : {}),
        ...cloneJson(value),
      };
    } else if (value === null) {
      delete output[key];
    } else {
      output[key] = cloneJson(value);
    }
  }
  return output;
}

function mergeThreeWay(
  base: unknown,
  local: unknown,
  server: unknown,
  counts: { reappliedChanges: number; retainedServerConflicts: number },
): unknown {
  if (same(local, base)) return cloneJson(server);
  if (same(server, base)) {
    counts.reappliedChanges = addCount(counts.reappliedChanges);
    return cloneJson(local);
  }
  if (same(local, server)) return cloneJson(server);

  if (isRecord(base) && isRecord(local) && isRecord(server)) {
    const merged: JsonRecord = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(server)]);
    for (const key of keys) {
      const hasBase = Object.prototype.hasOwnProperty.call(base, key);
      const hasLocal = Object.prototype.hasOwnProperty.call(local, key);
      const hasServer = Object.prototype.hasOwnProperty.call(server, key);
      const value = mergeThreeWay(
        hasBase ? base[key] : undefined,
        hasLocal ? local[key] : undefined,
        hasServer ? server[key] : undefined,
        counts,
      );
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }

  counts.retainedServerConflicts = addCount(counts.retainedServerConflicts);
  return cloneJson(server);
}

function unionList(local: unknown, server: unknown): unknown {
  const a = Array.isArray(local) ? local : [];
  const b = Array.isArray(server) ? server : [];
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const value of [...b, ...a]) {
    const key = typeof value === "string" ? value.trim().toLocaleLowerCase() : JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cloneJson(value));
  }
  return merged;
}

function mergeRunList(
  base: unknown,
  local: unknown,
  server: unknown,
  counts: { reappliedChanges: number; retainedServerConflicts: number },
): unknown[] {
  const baseRuns = Array.isArray(base) ? base.filter(isRecord) : [];
  const localRuns = Array.isArray(local) ? local.filter(isRecord) : [];
  const serverRuns = Array.isArray(server) ? server.filter(isRecord) : [];
  const baseById = new Map(baseRuns.map((run) => [String(run.id ?? ""), run]));
  const localById = new Map(localRuns.map((run) => [String(run.id ?? ""), run]));
  const serverById = new Map(serverRuns.map((run) => [String(run.id ?? ""), run]));
  const order = [...serverRuns.map((run) => String(run.id ?? ""))];
  for (const run of localRuns) {
    const id = String(run.id ?? "");
    if (id && !order.includes(id)) order.push(id);
  }
  return order.flatMap((id) => {
    if (!id) return [];
    const baseRun = baseById.get(id);
    const localRun = localById.get(id);
    const serverRun = serverById.get(id);
    // Run-list removal is represented by the server's tombstone protocol; an
    // omitted queued run is not enough evidence to delete a canonical run.
    if (!localRun) return serverRun ? [cloneJson(serverRun)] : [];
    if (!serverRun) return [cloneJson(localRun)];
    if (same(localRun, serverRun)) return [cloneJson(serverRun)];
    if (baseRun && !same(localRun, baseRun)) {
      const localStamp = Number(localRun.metaUpdatedAt) || 0;
      const serverStamp = Number(serverRun.metaUpdatedAt) || 0;
      if (localStamp <= serverStamp) {
        counts.retainedServerConflicts = addCount(counts.retainedServerConflicts);
        return [cloneJson(serverRun)];
      }
      counts.reappliedChanges = addCount(counts.reappliedChanges);
      return [cloneJson(localRun)];
    }
    return [mergeThreeWay(baseRun, localRun, serverRun, counts) as JsonRecord];
  });
}

function mergeDayState(
  base: unknown,
  local: unknown,
  server: unknown,
  counts: { reappliedChanges: number; retainedServerConflicts: number },
): unknown {
  if (!isRecord(local) || !isRecord(server)) {
    return mergeThreeWay(base, local, server, counts);
  }
  const baseWithoutRegisters = isRecord(base) ? { ...base } : {};
  const localWithoutRegisters = { ...local };
  const serverWithoutRegisters = { ...server };
  for (const key of ["runs", "breaks", "breaksUpdatedAt"]) {
    delete baseWithoutRegisters[key];
    delete localWithoutRegisters[key];
    delete serverWithoutRegisters[key];
  }
  const merged = mergeThreeWay(
    baseWithoutRegisters,
    localWithoutRegisters,
    serverWithoutRegisters,
    counts,
  ) as JsonRecord;
  merged.runs = mergeRunList(
    isRecord(base) ? base.runs : undefined,
    local.runs,
    server.runs,
    counts,
  );
  const baseDay = isRecord(base) ? base : {};
  const localBreaksChanged = !same(local.breaks, baseDay.breaks);
  const localBreakStamp = Number(local.breaksUpdatedAt) || 0;
  const serverBreakStamp = Number(server.breaksUpdatedAt) || 0;
  if (localBreaksChanged && localBreakStamp > serverBreakStamp) {
    merged.breaks = cloneJson(local.breaks);
    merged.breaksUpdatedAt = localBreakStamp;
    counts.reappliedChanges = addCount(counts.reappliedChanges);
  } else {
    if (localBreaksChanged) counts.retainedServerConflicts = addCount(counts.retainedServerConflicts);
    if (Object.prototype.hasOwnProperty.call(server, "breaks")) merged.breaks = cloneJson(server.breaks);
    if (Object.prototype.hasOwnProperty.call(server, "breaksUpdatedAt")) {
      merged.breaksUpdatedAt = server.breaksUpdatedAt;
    }
  }
  return merged;
}

function mergeBrandFlavors(local: unknown, server: unknown): unknown {
  if (!isRecord(local) || !isRecord(server)) return cloneJson(server);
  const result: JsonRecord = {};
  for (const brand of new Set([...Object.keys(server), ...Object.keys(local)])) {
    const serverValues = Array.isArray(server[brand]) ? server[brand] : [];
    const localValues = Array.isArray(local[brand]) ? local[brand] : [];
    result[brand] = unionList(localValues, serverValues);
  }
  return result;
}

function mergeDoughTimerControls(local: unknown, server: unknown): unknown {
  if (!isRecord(local) || !isRecord(server)) return cloneJson(server);
  const result: JsonRecord = { ...server };
  for (const [id, entry] of Object.entries(local)) {
    const localStamp = isRecord(entry) ? Number(entry.updatedAt) || 0 : 0;
    const serverEntry = server[id];
    const serverStamp = isRecord(serverEntry) ? Number(serverEntry.updatedAt) || 0 : 0;
    if (!serverEntry || localStamp >= serverStamp) result[id] = cloneJson(entry);
  }
  return result;
}

/**
 * Rebuild a stale queued document from its original baseline, local intent,
 * and the server's canonical response. Conflicting scalar values stay server
 * owned; independent local changes are reapplied.
 */
export function rebaseStaleSyncIntent(
  baseInput: unknown,
  intentInput: unknown,
  canonicalInput: unknown,
  options: { snapshotId?: string; serverTime?: number } = {},
): StaleBaseRecoveryResult {
  if (!isRecord(baseInput) || !isRecord(intentInput) || !isRecord(canonicalInput)) {
    throw new TypeError("Stale sync recovery requires three document objects");
  }
  const baseSnapshot = baseInput;
  const queuedIntent = intentInput;
  const canonicalSnapshot = canonicalInput;
  const local = materializeIntent(baseSnapshot, queuedIntent);
  const base = baseSnapshot;
  const server = canonicalSnapshot;
  const counts = { reappliedChanges: 0, retainedServerConflicts: 0 };
  const output: JsonRecord = cloneJson(server);
  const topLevelKeys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(server)]);

  for (const key of topLevelKeys) {
    if (
      key === "syncVersion"
      || key === "completeness"
      || key === "baseSnapshotId"
      || SERVER_ONLY_FIELDS.has(key)
      || key === "runValuesUpdatedAt"
    ) continue;

    const hasBase = Object.prototype.hasOwnProperty.call(base, key);
    const hasLocal = Object.prototype.hasOwnProperty.call(local, key);
    const hasServer = Object.prototype.hasOwnProperty.call(server, key);
    let value: unknown;
    if (key === "dayState") {
      value = mergeDayState(
        hasBase ? base[key] : undefined,
        hasLocal ? local[key] : undefined,
        hasServer ? server[key] : undefined,
        counts,
      );
    } else if (key === "runValues") {
      value = mergeThreeWay(
        hasBase ? base[key] : undefined,
        hasLocal ? local[key] : undefined,
        hasServer ? server[key] : undefined,
        counts,
      );
      if (isRecord(value)) {
        for (const id of new Set([
          ...Object.keys(isRecord(base[key]) ? base[key] : {}),
          ...Object.keys(isRecord(local[key]) ? local[key] : {}),
          ...Object.keys(isRecord(server[key]) ? server[key] : {}),
        ])) {
          if (!(id in value)) continue;
          const localRun = isRecord(local[key]) ? local[key][id] : undefined;
          const baseRun = isRecord(base[key]) ? base[key][id] : undefined;
          const serverRun = isRecord(server[key]) ? server[key][id] : undefined;
          if (!same(localRun, baseRun) && !same(value[id], serverRun)) {
            const stamps = isRecord(output.runValuesUpdatedAt) ? output.runValuesUpdatedAt : {};
            stamps[id] = Number(options.serverTime ?? Date.now()) + 1;
            output.runValuesUpdatedAt = stamps;
          }
        }
      }
    } else if (ADDITIVE_LIST_FIELDS.has(key) && hasLocal && hasServer) {
      value = unionList(local[key], server[key]);
    } else if (key === "brandFlavors" && hasLocal && hasServer) {
      value = mergeBrandFlavors(local[key], server[key]);
    } else if (key === "doughTimerControls" && hasLocal && hasServer) {
      value = mergeDoughTimerControls(local[key], server[key]);
    } else {
      value = mergeThreeWay(
        hasBase ? base[key] : undefined,
        hasLocal ? local[key] : undefined,
        hasServer ? server[key] : undefined,
        counts,
      );
    }

    if (value === undefined) delete output[key];
    else output[key] = value;
  }

  const serverDeletedItems = isRecord(server.deletedItems) ? server.deletedItems : {};
  const localDeletedItems = isRecord(local.deletedItems) ? local.deletedItems : {};
  if (serverDeletedItems.runs || localDeletedItems.runs) {
    output.deletedItems = {
      ...serverDeletedItems,
      ...localDeletedItems,
      runs: [...new Set([
        ...(Array.isArray(serverDeletedItems.runs) ? serverDeletedItems.runs : []),
        ...(Array.isArray(localDeletedItems.runs) ? localDeletedItems.runs : []),
      ])],
    };
  }

  for (const field of ["deletedStamps", "undeletedStamps"] as const) {
    const localStamps = isRecord(local[field]) ? local[field] : {};
    const serverStamps = isRecord(server[field]) ? server[field] : {};
    const merged: JsonRecord = { ...serverStamps };
    for (const [key, value] of Object.entries(localStamps)) {
      merged[key] = Math.max(Number(value) || 0, Number(serverStamps[key]) || 0);
    }
    if (Object.keys(merged).length) output[field] = merged;
  }

  const serverRunValues = isRecord(server.runValues) ? server.runValues : {};
  const mergedRunValues = isRecord(output.runValues) ? output.runValues : {};
  const stamps = isRecord(output.runValuesUpdatedAt) ? output.runValuesUpdatedAt : {};
  for (const [id, value] of Object.entries(mergedRunValues)) {
    if (!same(value, serverRunValues[id]) && !stamps[id]) {
      stamps[id] = Number(options.serverTime ?? Date.now()) + 1;
    }
  }
  output.runValuesUpdatedAt = stamps;

  delete output.operationalProjection;
  delete output.serverTime;
  delete output.canonicalRevision;
  delete output.resetEpoch;
  delete output.rollover;
  output.syncVersion = 1;
  output.completeness = "complete";
  if (options.snapshotId) output.baseSnapshotId = options.snapshotId;

  return {
    payload: output,
    reappliedChanges: counts.reappliedChanges,
    retainedServerConflicts: counts.retainedServerConflicts,
  };
}
