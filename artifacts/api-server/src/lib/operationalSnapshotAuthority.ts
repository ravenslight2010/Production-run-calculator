import { canonicalSyncJson, COMMAND_OWNED_RUN_FIELDS, COMMAND_OWNED_VALUE_FIELDS } from "@workspace/sync-contract";

const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function hasOperationalSnapshotMutation(candidate: unknown, canonical: unknown): boolean {
  if (!object(candidate)) return false;
  const stored = object(canonical) ? canonical : {};
  const oldRuns = new Map<string, Record<string, any>>(
    (Array.isArray(stored.dayState?.runs) ? stored.dayState.runs : [])
      .filter(object).map((run: Record<string, any>) => [run.id, run]),
  );
  for (const run of Array.isArray(candidate.dayState?.runs) ? candidate.dayState.runs : []) {
    if (!object(run)) continue;
    for (const field of COMMAND_OWNED_RUN_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(run, field)) continue;
      const fallback = field === "stoppages" ? [] : field === "autoTrackDisabled" ? false : 0;
      if (canonicalSyncJson(run[field] ?? fallback) !== canonicalSyncJson(oldRuns.get(run.id)?.[field] ?? fallback)) return true;
    }
  }
  for (const [id, value] of Object.entries(object(candidate.runValues) ? candidate.runValues : {})) {
    if (!object(value)) continue;
    for (const field of COMMAND_OWNED_VALUE_FIELDS) {
      const fallback = field.endsWith("Initialized") ? false : 0;
      if (Object.prototype.hasOwnProperty.call(value, field)
        && canonicalSyncJson(value[field] ?? fallback) !== canonicalSyncJson(stored.runValues?.[id]?.[field] ?? fallback)) return true;
    }
  }
  return ["packagingProgress", "doughTimerControls"].some((field) => {
    if (!Object.prototype.hasOwnProperty.call(candidate, field)) return false;
    if (candidate.completeness === "partial" && object(candidate[field])) {
      return Object.entries(candidate[field]).some(([id, value]) =>
        canonicalSyncJson(value) !== canonicalSyncJson(stored[field]?.[id] ?? null));
    }
    return canonicalSyncJson(candidate[field] ?? {}) !== canonicalSyncJson(stored[field] ?? {});
  });
}

/**
 * Run before and after the legacy protective merge. Before prevents forged
 * counters from invalidating schedules; after prevents legacy overlays and
 * tombstones from dropping canonical runs. No timestamps grant authority.
 */
export function fenceOperationalSnapshot(candidate: unknown, canonical: unknown): unknown {
  if (!object(candidate)) return candidate;
  const stored = object(canonical) ? canonical : {};
  const out = { ...candidate };
  const oldRuns = Array.isArray(stored.dayState?.runs) ? stored.dayState.runs : [];
  const byId = new Map<string, Record<string, any>>(
    oldRuns.filter((run: unknown) => object(run) && typeof run.id === "string")
      .map((run: Record<string, any>) => [run.id, run]),
  );
  if (object(out.dayState)) {
    const day = { ...out.dayState };
    const runs = (Array.isArray(day.runs) ? day.runs : []).filter(object).map((run) => {
      const previous = byId.get(run.id);
      const next = { ...run };
      for (const field of [...COMMAND_OWNED_RUN_FIELDS, "metaUpdatedAt"] as const) {
        if (previous && Object.prototype.hasOwnProperty.call(previous, field)) next[field] = previous[field];
        else delete next[field];
      }
      return next;
    });
    const ids = new Set(runs.map((run) => run.id));
    for (const run of oldRuns) if (object(run) && (run.startedAt || run.endedAt) && !ids.has(run.id)) {
      runs.push(run);
    }
    day.runs = runs;
    // A client may delete an unstarted plan, never a canonical live/history run.
    if (Array.isArray(day.deletedRunIds)) day.deletedRunIds = day.deletedRunIds.filter((id: string) => {
      const run = byId.get(id);
      return !run?.startedAt && !run?.endedAt;
    });
    out.dayState = day;
  }
  if (object(out.runValues)) {
    const values = { ...out.runValues };
    for (const [id, value] of Object.entries(values)) {
      if (!object(value)) continue;
      const previous = object(stored.runValues?.[id]) ? stored.runValues[id] : {};
      const next = { ...value };
      for (const field of COMMAND_OWNED_VALUE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(previous, field)) next[field] = previous[field];
        else delete next[field];
      }
      values[id] = next;
    }
    // A dropped canonical run must retain its totals as well as its lifecycle.
    for (const run of oldRuns) if (object(run) && (run.startedAt || run.endedAt)
      && !object(values[run.id]) && object(stored.runValues?.[run.id])) values[run.id] = stored.runValues[run.id];
    out.runValues = values;
  }
  for (const field of [
    "packagingProgress", "doughTimerControls", "autoTrackCoordination", "autoTrackServerState", "operationalIntentHistory",
  ]) {
    if (Object.prototype.hasOwnProperty.call(stored, field)) out[field] = stored[field];
    else delete out[field];
  }
  if (object(out.deletedItems) && Array.isArray(out.deletedItems.runs)) {
    out.deletedItems = { ...out.deletedItems, runs: out.deletedItems.runs.filter((id: string) => {
      const run = byId.get(id);
      return !run?.startedAt && !run?.endedAt;
    }) };
  }
  return out;
}
