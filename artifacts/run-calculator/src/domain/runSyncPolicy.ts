import {
  DEFAULT_VALUES,
  MACHINE_TIME_DEFAULTS,
  type DayState,
  type FormValues,
  type RunMeta,
} from "../types";
import { genId, todayStr } from "../utils";

/** React- and storage-free decisions for the live-run synchronization boundary. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b)
      && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object") {
    const left = Object.keys(a as object);
    const right = Object.keys(b as object);
    return left.length === right.length && left.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key)
        && deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

export function freshDayState(): DayState {
  return {
    runs: [{ id: genId(), brand: "", flavor: "", seeded: true }],
    currentIndex: 0, date: todayStr(), substitutions: [], substitutionLog: [], stagedItems: {},
    prepPhase: { prepStartedAt: null, prepBatchesDough: 0, prepBatchesSauce: 0, prepCarriedOver: false },
  };
}

export function createSyncBaselineGate() {
  let ready = false;
  let pushPending = false;
  return {
    beginConnection() { ready = false; pushPending = false; },
    requestPush() { if (ready) return true; pushPending = true; return false; },
    completeInitialSnapshot() { ready = true; const pending = pushPending; pushPending = false; return pending; },
    isReady() { return ready; },
  };
}

export function shouldAcceptSyncDaySnapshot(args: {
  remoteDate?: string; localDate?: string; remoteResetAt: number; localResetAt: number; initialSnapshot?: boolean;
}): boolean {
  return (!args.remoteDate || !args.localDate || args.remoteDate === args.localDate)
    && (args.initialSnapshot === true || args.remoteResetAt >= args.localResetAt);
}

export function isBlankRemovableRun(run: RunMeta): boolean {
  return !run.brand && !run.flavor && !(run.notes ?? "").trim()
    && !run.startedAt && !run.endedAt && (run.stoppages ?? []).length === 0;
}
export function isPristineSeedRun(run: RunMeta): boolean {
  return !!run.seeded && isBlankRemovableRun(run);
}
export function shouldAtomicallyAdoptFirstSnapshot(args: {
  initialSnapshot?: boolean; localRuns: RunMeta[]; hasLocalUserEdit?: boolean;
}): boolean {
  return args.initialSnapshot === true && args.localRuns.length === 1
    && args.hasLocalUserEdit !== true && isPristineSeedRun(args.localRuns[0]);
}
export function removeRunByIdFromDayState(
  dayState: DayState,
  id: string,
): { dayState: DayState; removedRun: RunMeta; removedCurrent: boolean } | null {
  const index = dayState.runs.findIndex((run) => run.id === id);
  if (index < 0 || dayState.runs[index].startedAt || dayState.runs[index].endedAt) return null;
  const runs = dayState.runs.filter((_, candidateIndex) => candidateIndex !== index);
  if (!runs.length) return null;
  const currentId = dayState.runs[dayState.currentIndex]?.id;
  const removedCurrent = currentId === id;
  return {
    dayState: {
      ...dayState,
      runs,
      currentIndex: removedCurrent
        ? Math.max(0, index - 1)
        : Math.max(0, runs.findIndex((run) => run.id === currentId)),
    },
    removedRun: dayState.runs[index],
    removedCurrent,
  };
}

export function shouldKeepLocalRunLifecycle(local: RunMeta | undefined, remote: RunMeta | undefined): boolean {
  if (!local || !remote) return false;
  return (!!local.pausedAt && !local.endedAt && !remote.pausedAt && !remote.endedAt
    && remote.startedAt === local.startedAt)
    || (local.metaUpdatedAt ?? 0) > (remote.metaUpdatedAt ?? 0);
}
export function selectInboundRunLifecycles(local: RunMeta[], remote: RunMeta[]): RunMeta[] {
  const byId = new Map(local.map((run) => [run.id, run]));
  return remote.map((run) => shouldKeepLocalRunLifecycle(byId.get(run.id), run) ? byId.get(run.id)! : run);
}
export function adoptStrictlyNewerRemoteLifecycles(localDay: DayState, remoteRuns: RunMeta[]) {
  const remote = new Map(remoteRuns.map((run) => [run.id, run]));
  const adoptedRunIds: string[] = [];
  const runs = localDay.runs.map((local) => {
    const next = remote.get(local.id);
    if (!next || (next.metaUpdatedAt ?? 0) <= (local.metaUpdatedAt ?? 0)
      || shouldKeepLocalRunLifecycle(local, next)
      || (next.startedAt === local.startedAt && next.pausedAt === local.pausedAt && next.endedAt === local.endedAt)) return local;
    adoptedRunIds.push(local.id); return next;
  });
  if (!adoptedRunIds.length) return { dayState: localDay, adoptedRunIds };
  const selected = localDay.runs[localDay.currentIndex]?.id;
  const currentIndex = selected ? runs.findIndex((run) => run.id === selected) : -1;
  return { dayState: { ...localDay, runs, currentIndex: currentIndex >= 0 ? currentIndex : Math.max(0, Math.min(localDay.currentIndex, runs.length - 1)) }, adoptedRunIds };
}

export function stampDayStateMeta(dayState: DayState, stored: DayState, now: number): DayState {
  const previous = new Map(stored.runs.map((run) => [run.id, run]));
  let changed = false;
  const runs = dayState.runs.map((run) => {
    const old = previous.get(run.id);
    const equal = old && deepEqual(
      (({ metaUpdatedAt: _stamp, ...value }) => value)(run),
      (({ metaUpdatedAt: _stamp, ...value }) => value)(old),
    );
    if (equal) {
      const stamp = Math.max(run.metaUpdatedAt ?? 0, old.metaUpdatedAt ?? 0);
      if (stamp !== (run.metaUpdatedAt ?? 0)) { changed = true; return { ...run, metaUpdatedAt: stamp }; }
      return run;
    }
    changed = true; return { ...run, metaUpdatedAt: now };
  });
  return changed ? { ...dayState, runs } : dayState;
}

const LEGACY_PEP_BATCH_FIELDS = ["pep1BatchLbs", "pep2BatchLbs", "pep1BatchLbsB", "pep2BatchLbsB"] as const;
export function isAllDefaultRunValue(value: unknown): boolean {
  if (deepEqual(value, DEFAULT_VALUES)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const normalized = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(MACHINE_TIME_DEFAULTS)) if (normalized[key] === 0) normalized[key] = MACHINE_TIME_DEFAULTS[key as keyof typeof MACHINE_TIME_DEFAULTS];
  if (deepEqual(normalized, DEFAULT_VALUES)) return true;
  if (!LEGACY_PEP_BATCH_FIELDS.every((key) => normalized[key] === 25)) return false;
  for (const key of LEGACY_PEP_BATCH_FIELDS) normalized[key] = 0;
  return deepEqual(normalized, DEFAULT_VALUES);
}
export function isEmptyOverPopulated(candidate: FormValues, fallback: FormValues): boolean {
  return isAllDefaultRunValue(candidate) && !isAllDefaultRunValue(fallback);
}
export function pickCurrentRunPushValue(live: FormValues, stored: FormValues): FormValues {
  return isEmptyOverPopulated(live, stored) ? stored : live;
}
export const RECENT_LOCAL_EDIT_WINDOW_MS = 2000;
export function shouldHealFormFromStored(live: FormValues, stored: FormValues, editAt: number, now: number): boolean {
  return isEmptyOverPopulated(live, stored) && now - editAt > RECENT_LOCAL_EDIT_WINDOW_MS;
}
export function shouldResetFormOnRunSwitch(live: FormValues, stored: FormValues, settled: boolean): boolean {
  return !settled && !deepEqual(live, stored);
}
export function acceptRemoteRunValueOnSync(remote: FormValues, local: FormValues, remoteTs: number, localTs: number): boolean {
  return !isEmptyOverPopulated(remote, local) && !(localTs > remoteTs);
}