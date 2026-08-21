import { createHash } from "crypto";

export interface ConflictInfo {
  fieldsWithConflicts: string[];
  conflictCount: number;
  clientStateHash: string;
  serverStateHash: string;
  mergedStateHash: string;
}

function shortHash(v: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(v) ?? "")
    .digest("hex")
    .slice(0, 16);
}

/**
 * Compare a pushed payload with the result of the protective merge.
 *
 * The merge itself owns the conflict policy; this helper only records places
 * where the merged result differs from what the client sent.
 */
export function detectConflicts(
  incoming: unknown,
  existing: unknown,
  merged: unknown,
): ConflictInfo | null {
  if (
    !incoming || typeof incoming !== "object" ||
    !existing || typeof existing !== "object" ||
    !merged || typeof merged !== "object"
  ) {
    return null;
  }

  const inObj = incoming as Record<string, unknown>;
  const merObj = merged as Record<string, unknown>;
  const fields: string[] = [];

  const inVals =
    inObj.runValues && typeof inObj.runValues === "object" && !Array.isArray(inObj.runValues)
      ? inObj.runValues as Record<string, unknown>
      : {};
  const merVals =
    merObj.runValues && typeof merObj.runValues === "object" && !Array.isArray(merObj.runValues)
      ? merObj.runValues as Record<string, unknown>
      : {};
  for (const id of Object.keys(inVals)) {
    if (JSON.stringify(inVals[id]) !== JSON.stringify(merVals[id])) {
      fields.push(`runValues:${id}`);
    }
  }

  const inProgress =
    inObj.packagingProgress &&
    typeof inObj.packagingProgress === "object" &&
    !Array.isArray(inObj.packagingProgress)
      ? inObj.packagingProgress as Record<string, unknown>
      : {};
  const mergedProgress =
    merObj.packagingProgress &&
    typeof merObj.packagingProgress === "object" &&
    !Array.isArray(merObj.packagingProgress)
      ? merObj.packagingProgress as Record<string, unknown>
      : {};
  for (const id of Object.keys(inProgress)) {
    if (JSON.stringify(inProgress[id]) !== JSON.stringify(mergedProgress[id])) {
      fields.push(`packagingProgress:${id}`);
    }
  }

  const inRunMap = new Map<string, unknown>();
  const inRuns = (inObj.dayState as { runs?: unknown[] } | undefined)?.runs;
  for (const run of Array.isArray(inRuns) ? inRuns : []) {
    if (!run || typeof run !== "object") continue;
    const id = (run as Record<string, unknown>).id;
    if (typeof id === "string" && id) inRunMap.set(id, run);
  }

  const mergedRuns = (merObj.dayState as { runs?: unknown[] } | undefined)?.runs;
  let appendedCount = 0;
  for (const run of Array.isArray(mergedRuns) ? mergedRuns : []) {
    if (!run || typeof run !== "object") continue;
    const id = (run as Record<string, unknown>).id;
    if (typeof id !== "string" || !id) continue;
    if (!inRunMap.has(id)) {
      appendedCount++;
    } else if (JSON.stringify(run) !== JSON.stringify(inRunMap.get(id))) {
      fields.push(`dayState.runs.meta:${id}`);
    }
  }
  if (appendedCount > 0) {
    fields.push(`dayState.runs:appended(${appendedCount})`);
  }

  if (fields.length === 0) return null;
  return {
    fieldsWithConflicts: fields,
    conflictCount: fields.length,
    clientStateHash: shortHash(incoming),
    serverStateHash: shortHash(existing),
    mergedStateHash: shortHash(merged),
  };
}