import {
  DEFAULT_VALUES,
  MACHINE_TIME_DEFAULTS,
  type DayState,
  type FormValues,
  type RunMeta,
  type SyncPayload,
} from "../types";
import { genId, todayStr } from "../utils";
import { SynchronizationStateMachine } from "../synchronizationStateMachine";
import { defaultDayBreaks } from "../dayTimeline";

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
    breaks: defaultDayBreaks(),
  };
}

export function createSyncBaselineGate<T = never>(machine = new SynchronizationStateMachine<T>()) {
  return {
    beginConnection() { machine.beginConnection(); },
    requestPush() { return machine.requestBaselinePush(); },
    completeInitialSnapshot() { return machine.completeInitialSnapshot(); },
    isReady() { return machine.isReady; },
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
  // Same-day lifecycle transitions are monotonic from the operator's point of
  // view: a stale snapshot may omit a locally started or ended run, but there
  // is no valid same-day action that turns either transition back into an
  // unstarted/unended run. Keep that local transition even when the older
  // snapshot carries an equal or missing stamp. The stamp comparison below
  // still handles unrelated metadata and newer peer lifecycle changes.
  const localTransitionIsMissingRemotely =
    (local.startedAt !== undefined && remote.startedAt === undefined)
    || (local.endedAt !== undefined && remote.endedAt === undefined);
  return (localTransitionIsMissingRemotely)
    || (!!local.pausedAt && !local.endedAt && !remote.pausedAt && !remote.endedAt
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

/**
 * Select the one App 1 counter that may converge independently of whole-run
 * LWW. A private server ownership entry must match the public accepted claim
 * sequence and its run-value stamp; the operator's slot correction generation
 * remains a causal fence against an older automatic event.
 */
export function serverOwnedApp1BatchProgress(
  payload: Pick<SyncPayload, "runValues" | "runValuesUpdatedAt" | "autoTrackCoordination" | "autoTrackServerState">,
  runId: string,
  localValues: FormValues,
): Partial<Pick<FormValues, "app1BatchesMade" | "app1BatchCorrectionGeneration">> | null {
  const remoteValues = payload.runValues[runId];
  const remoteStamp = Number(payload.runValuesUpdatedAt?.[runId]);
  const coordination = payload.autoTrackCoordination?.runs?.[runId]?.["app1-batch"];
  const ownership = payload.autoTrackServerState?.netOwnership?.[runId]?.["app1-batch"];
  if (
    !remoteValues
    || !Number.isFinite(remoteStamp)
    || remoteStamp <= 0
    || !coordination
    || !ownership
    || !Number.isFinite(ownership.updatedAt)
    || Number(ownership.updatedAt) <= 0
    || remoteStamp < Number(ownership.updatedAt)
    || !Number.isSafeInteger(coordination.sequence)
    || coordination.sequence < 1
    || coordination.generation !== ownership.generation
    || coordination.sequence !== ownership.sequence
    || Number(coordination.acceptedRunValuesUpdatedAt) !== remoteStamp
    || typeof coordination.acceptedEventId !== "string"
    || coordination.acceptedEventId.length === 0
  ) return null;

  const remoteCount = Number(remoteValues.app1BatchesMade);
  const localCount = Number(localValues.app1BatchesMade);
  const remoteGeneration = Number(remoteValues.app1BatchCorrectionGeneration) || 0;
  const localGeneration = Number(localValues.app1BatchCorrectionGeneration) || 0;
  if (
    !Number.isSafeInteger(remoteCount)
    || remoteCount < 0
    || !Number.isSafeInteger(localCount)
    || !Number.isSafeInteger(remoteGeneration)
    || remoteGeneration < 0
    || !Number.isSafeInteger(localGeneration)
    || localGeneration < 0
    || localGeneration > remoteGeneration
    || remoteCount <= localCount
  ) return null;

  return {
    app1BatchesMade: remoteCount,
    ...(remoteGeneration > localGeneration
      ? { app1BatchCorrectionGeneration: remoteGeneration }
      : {}),
  };
}

type OperationalCanonicalIntent = {
  runId: string;
  action: "pause" | "resume" | "lifecycle" | "correction";
  lifecycle?: "start" | "end";
  values?: Record<string, number>;
};

type OperationalCanonicalPayload = {
  dayState: { runs: RunMeta[] };
  runValues: Record<string, FormValues>;
  runValuesUpdatedAt?: Record<string, number>;
};

const OPERATIONAL_CORRECTION_FIELDS = new Set<keyof FormValues>([
  "skidsCompleted", "casesOnCurrentSkid", "traysOnLine", "batchesReady",
  "sauceBarrelsMade", "sauceBarrelAnchorNetSec", "sauceBarrelCorrectionGeneration",
  "app1BatchesMade", "app1BatchAnchorNetSec", "app1BatchCorrectionGeneration",
  "app2BatchesMade", "app2BatchAnchorNetSec", "app2BatchCorrectionGeneration",
  "app3BatchesMade", "app3BatchAnchorNetSec", "app3BatchCorrectionGeneration",
  "app4BatchesMade", "app4BatchAnchorNetSec", "app4BatchCorrectionGeneration",
]);

/**
 * Force-adopts only the fields governed by a rejected/rebased operational
 * command. This runs before ordinary LWW receive so the rejected local command
 * cannot win merely because it minted a newer browser stamp.
 */
export function reconcileOperationalIntentCanonical(args: {
  dayState: DayState;
  runValues: FormValues;
  runValuesUpdatedAt: Record<string, number>;
  payload: OperationalCanonicalPayload;
  intent: OperationalCanonicalIntent;
  outcome: "accepted" | "superseded" | "rebased" | "conflicted" | "review-required";
}): {
  dayState: DayState;
  runValues: FormValues;
  runValuesUpdatedAt: Record<string, number>;
  lifecycleChanged: boolean;
  valueFields: Array<keyof FormValues>;
} {
  const unchanged = {
    dayState: args.dayState,
    runValues: args.runValues,
    runValuesUpdatedAt: args.runValuesUpdatedAt,
    lifecycleChanged: false,
    valueFields: [] as Array<keyof FormValues>,
  };
  // Accepted finalization is special: the server owns the completion stamp and
  // committed inventory in the same transaction. Adopt that exact lifecycle
  // before the outbox drops its snapshot fence. Other accepted commands already
  // match their optimistic local projection.
  if (args.outcome === "accepted"
    && !(args.intent.action === "lifecycle" && args.intent.lifecycle === "end")) return unchanged;

  let dayState = args.dayState;
  let lifecycleChanged = false;
  if (args.intent.action !== "correction") {
    const localIndex = args.dayState.runs.findIndex((run) => run.id === args.intent.runId);
    const canonical = args.payload.dayState.runs.find((run) => run.id === args.intent.runId);
    if (localIndex >= 0 && canonical) {
      const local = args.dayState.runs[localIndex];
      const restored: RunMeta = {
        ...local,
        startedAt: canonical.startedAt,
        pausedAt: canonical.pausedAt,
        pausedStoppageId: canonical.pausedStoppageId,
        endedAt: canonical.endedAt,
        stoppages: canonical.stoppages,
        metaUpdatedAt: canonical.metaUpdatedAt,
      };
      if (!deepEqual(local, restored)) {
        const runs = [...args.dayState.runs];
        runs[localIndex] = restored;
        dayState = { ...args.dayState, runs };
        lifecycleChanged = true;
      }
    }
  }

  let runValues = args.runValues;
  let runValuesUpdatedAt = args.runValuesUpdatedAt;
  const valueFields: Array<keyof FormValues> = [];
  if (args.intent.action === "correction") {
    const canonical = args.payload.runValues[args.intent.runId];
    if (canonical) {
      const restored = { ...args.runValues };
      for (const field of Object.keys(args.intent.values ?? {})) {
        if (!OPERATIONAL_CORRECTION_FIELDS.has(field as keyof FormValues)) continue;
        if (!Object.prototype.hasOwnProperty.call(canonical, field)) continue;
        const value = canonical[field as keyof FormValues];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        (restored as unknown as Record<string, unknown>)[field] = value;
        valueFields.push(field as keyof FormValues);
      }
      if (valueFields.length) {
        runValues = restored;
        runValuesUpdatedAt = {
          ...args.runValuesUpdatedAt,
          [args.intent.runId]: args.payload.runValuesUpdatedAt?.[args.intent.runId] ?? 0,
        };
      }
    }
  }

  return { dayState, runValues, runValuesUpdatedAt, lifecycleChanged, valueFields };
}