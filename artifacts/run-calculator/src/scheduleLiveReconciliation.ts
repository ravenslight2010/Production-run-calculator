import type { RunMeta } from "./types";

export type ScheduleEditorRun = {
  id: string;
  brand: string;
  flavor: string;
};

export type LiveScheduleReconciliation =
  | {
      ok: true;
      runs: RunMeta[];
      removedRunIds: string[];
    }
  | {
      ok: false;
      reason: "minimum-one-run";
    };

/**
 * Reconciles a today-schedule editor submission against the freshest live day.
 * Only runs that the editor displayed may be deleted, and lifecycle changes
 * that happened while the editor was open always win over omission.
 */
export function reconcileLiveScheduleSave(
  loadedRuns: readonly RunMeta[],
  submittedRuns: readonly ScheduleEditorRun[],
  liveRuns: readonly RunMeta[],
): LiveScheduleReconciliation {
  const loadedById = new Map(loadedRuns.map((run) => [run.id, run]));
  const liveById = new Map(liveRuns.map((run) => [run.id, run]));
  const submittedIds = new Set(submittedRuns.map((run) => run.id));
  const removedRunIds: string[] = [];

  const runs: RunMeta[] = submittedRuns.map((submitted) => {
    const live = liveById.get(submitted.id);
    return live
      ? { ...live, brand: submitted.brand, flavor: submitted.flavor }
      : { id: submitted.id, brand: submitted.brand, flavor: submitted.flavor };
  });

  for (const live of liveRuns) {
    if (submittedIds.has(live.id)) continue;
    const loaded = loadedById.get(live.id);
    if (loaded && !live.startedAt && !live.endedAt) {
      removedRunIds.push(live.id);
      continue;
    }
    runs.push(live);
  }

  // A run removed concurrently after the editor opened still needs its
  // tombstone persisted, unless the loaded copy was already active/completed.
  for (const loaded of loadedRuns) {
    if (
      submittedIds.has(loaded.id)
      || liveById.has(loaded.id)
      || loaded.startedAt
      || loaded.endedAt
    ) continue;
    removedRunIds.push(loaded.id);
  }

  if (runs.length === 0) return { ok: false, reason: "minimum-one-run" };
  return { ok: true, runs, removedRunIds };
}