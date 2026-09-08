import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { DayState, FormValues, RunMeta, Stoppage } from "../types";
import type { OperationalIntent, PreEndLifecycle } from "../operationalIntentOutbox";
import { useEvent } from "./useEvent";

type InventoryLine = { itemKey: string; qty: number };

/**
 * The imperative lifecycle boundary for Home.  State ownership deliberately
 * remains in Home; this manager receives the small set of durable adapters it
 * needs so lifecycle ordering cannot gradually diverge between controls.
 */
export function useRunLifecycleManager(deps: {
  dayStateRef: MutableRefObject<DayState>;
  setDayState: Dispatch<SetStateAction<DayState>>;
  saveDayState: (state: DayState) => void;
  form: UseFormReturn<FormValues>;
  lastFormRunIdRef: MutableRefObject<string>;
  currentRun: RunMeta | undefined;
  currentRunId: string;
  flushFormWrites: () => void;
  loadRunValues: (runId: string) => FormValues;
  saveRunValues: (runId: string, values: FormValues) => void;
  markRunValuesUpdated: (runId: string, now: number) => void;
  canManageProfiles: boolean;
  saveProfile: (brand: string, flavor: string, values: FormValues) => boolean;
  propagateProfileToPendingRuns: (brand: string, flavor: string) => Promise<unknown>;
  resetFieldArrays: (values: FormValues) => void;
  setDoughSubTab: (tab: "dough" | "crusts") => void;
  setActiveStopId: (id: string | null) => void;
  setConfirmDeleteStopId: (id: string | null) => void;
  setActiveTab: (tab: "run") => void;
  foregroundSyncBarrierRef: MutableRefObject<boolean>;
  formHandoffRef: MutableRefObject<boolean>;
  foregroundStopIntentRef: MutableRefObject<{ action: "stop"; runId: string } | null>;
  setPendingForegroundStopRunId: Dispatch<SetStateAction<string | null>>;
  showForegroundRecoveryNotice: (kind: "recovering" | "outcome", message: string) => void;
  recordSyncEvent: (kind: string, message: string, response?: string, runId?: string) => void;
  queueOperationalIntent: (input: Omit<OperationalIntent, "version" | "id" | "date" | "resetEpoch" | "state" | "commandCategory" | "deviceId" | "baseRevision" | "occurredAt"> & {
    date?: string;
    commandCategory?: OperationalIntent["commandCategory"];
    deviceId?: string;
    baseRevision?: number;
    occurredAt?: number;
  }) => OperationalIntent;
  flushOperationalIntentOutbox: () => Promise<void>;
  browserIsOnline: () => boolean;
  capturePreEndLifecycle: (run: RunMeta) => PreEndLifecycle;
  computeRunConsumptionLines: (values: FormValues) => InventoryLine[];
  effectiveValuesForRun: (run: RunMeta, values: FormValues) => FormValues;
  overlayRunMetaStamps: (runs: RunMeta[]) => RunMeta[];
  isolatePendingRunPackagingProgress: (run: RunMeta, values: FormValues) => FormValues;
  recordManualPackagingProgress: (input: {
    runId: string; skidsCompleted: number; casesOnCurrentSkid: number;
    manualOverrideUntil: number; now: number;
  }) => void;
  persistManualPackagingProgress: (runId: string, skids: number, cases: number) => void;
  calcTotalTimeSec: () => number;
  initialFinishTimestampRef: MutableRefObject<number>;
  summarizeCarriedInCases: (run: RunMeta, originalTarget: number) => number;
  startRunAndQueueCompetingCompletions: (args: {
    date: string; runs: RunMeta[]; currentIndex: number; now: number;
    loadValues: (runId: string) => FormValues;
  }) => { runs: RunMeta[]; autoEnded: RunMeta[] };
  todayStr: () => string;
  reportRunInsightsAfterFinalize: (runs: RunMeta[], allRuns: RunMeta[], signal: AbortSignal) => Promise<unknown>;
  getRunInsightsSignal: () => AbortSignal;
  genId: () => string;
  applyResumeToRun: (run: RunMeta, now: number) => RunMeta | null;
  canChoosePauseTunnelPolicy: (pausedAt: number, now: number) => boolean;
  pauseDecisionRemainingMs: (pausedAt: number, now: number) => number;
  shouldClosePauseDecision: (pausedAt: number, now: number, visible: boolean) => boolean;
  schedulePush: (state: DayState, delay?: number) => void;
  operationalAdoptionInFlightRef?: MutableRefObject<number>;
  operationalCanonicalRevisionRef?: MutableRefObject<number>;
  operationalIntentBlocksLifecycle?: (runId: string) => boolean;
}) {
  const [pauseDecisionRunId, setPauseDecisionRunId] = useState<string | null>(null);
  const pauseDecisionPauseIdRef = useRef<string | null>(null);
  const lifecycleBlocked = (runId: string) =>
    (deps.operationalAdoptionInFlightRef?.current ?? 0) > 0 ||
    (deps.operationalIntentBlocksLifecycle?.(runId) ?? false);
  const canonicalRevision = () => deps.operationalCanonicalRevisionRef?.current ?? 0;

  const switchToRun = useEvent((newIndex: number) => {
    if (deps.foregroundSyncBarrierRef.current || deps.formHandoffRef.current) return;
    const base = deps.dayStateRef.current;
    if (newIndex < 0 || newIndex >= base.runs.length) return;
    deps.flushFormWrites();
    const ownedRunId = deps.lastFormRunIdRef.current;
    const current = ownedRunId ? base.runs.find((run) => run.id === ownedRunId) : undefined;
    const values = deps.form.getValues();
    if (current) {
      deps.saveRunValues(current.id, values);
      if (deps.canManageProfiles && (current.brand || current.flavor)
        && deps.saveProfile(current.brand, current.flavor, values)) {
        void deps.propagateProfileToPendingRuns(current.brand, current.flavor);
      }
    }
    const next = { ...base, currentIndex: newIndex };
    deps.dayStateRef.current = next;
    deps.setDayState(next);
    deps.saveDayState(next);
    const nextRun = base.runs[newIndex];
    const nextValues = deps.loadRunValues(nextRun.id);
    deps.lastFormRunIdRef.current = nextRun.id;
    deps.form.reset(nextValues);
    deps.resetFieldArrays(nextValues);
    deps.setDoughSubTab(nextRun.subTab ?? "dough");
    deps.setActiveStopId(nextRun.stoppages?.find((stop) => !stop.endedAt)?.id ?? null);
    deps.setConfirmDeleteStopId(null);
  });

  const startRun = useEvent(() => {
    if (deps.foregroundSyncBarrierRef.current || deps.formHandoffRef.current) return;
    const base = deps.dayStateRef.current;
    const index = base.currentIndex;
    const activeRun = base.runs[index];
    if (!activeRun) return;
    if (lifecycleBlocked(activeRun.id)) return;
    deps.flushFormWrites();
    const now = Date.now();
    const activeRunId = activeRun.id;
    const observedRuns = deps.overlayRunMetaStamps(base.runs);
    const observedActiveRun = observedRuns[index] ?? activeRun;
    deps.queueOperationalIntent({
      runId: activeRunId,
      observedGeneration: `${activeRunId}:${observedActiveRun.metaUpdatedAt ?? observedActiveRun.startedAt ?? 0}`,
      effectiveAt: now,
      action: "lifecycle",
      lifecycle: "start",
      baseRevision: canonicalRevision(),
      preLifecycle: deps.capturePreEndLifecycle(observedActiveRun),
    });
    void deps.flushOperationalIntentOutbox();
    const opening = deps.form.getValues();
    const isolated = deps.isolatePendingRunPackagingProgress(activeRun, opening);
    if (isolated !== opening) {
      deps.form.setValue("skidsCompleted", 0, { shouldDirty: true });
      deps.form.setValue("casesOnCurrentSkid", 0, { shouldDirty: true });
      deps.recordManualPackagingProgress({ runId: activeRunId, skidsCompleted: 0, casesOnCurrentSkid: 0, manualOverrideUntil: now, now });
      deps.saveRunValues(activeRunId, deps.form.getValues());
      deps.markRunValuesUpdated(activeRunId, now);
    }
    deps.initialFinishTimestampRef.current = now + deps.calcTotalTimeSec() * 1000;
    for (const run of base.runs) if (run.id !== activeRunId && run.startedAt && !run.endedAt) {
      const observedRun = observedRuns.find((candidate) => candidate.id === run.id) ?? run;
      deps.queueOperationalIntent({
        runId: run.id, observedGeneration: `${run.id}:${observedRun.metaUpdatedAt ?? observedRun.startedAt ?? 0}`,
        effectiveAt: now, action: "lifecycle", lifecycle: "end",
        baseRevision: canonicalRevision(),
        preLifecycle: deps.capturePreEndLifecycle(observedRun),
        preEndLifecycle: deps.capturePreEndLifecycle(observedRun),
        inventoryLines: deps.computeRunConsumptionLines(deps.effectiveValuesForRun(run, deps.loadRunValues(run.id))),
      });
    }
    if (deps.browserIsOnline()) void deps.flushOperationalIntentOutbox();
    const carried = deps.summarizeCarriedInCases(activeRun, Number(deps.form.getValues("casesNeeded")) || 0);
    const openingValues = deps.form.getValues();
    const openingCases = (Number(openingValues.skidsCompleted) || 0) * (Number(openingValues.casesPerSkid) || 0) + (Number(openingValues.casesOnCurrentSkid) || 0);
    if (carried > 0 && openingCases === 0) {
      const casesPerSkid = Number(openingValues.casesPerSkid) || 0;
      const skids = casesPerSkid > 0 ? Math.floor(carried / casesPerSkid) : 0;
      const cases = casesPerSkid > 0 ? carried % casesPerSkid : carried;
      deps.form.setValue("skidsCompleted", skids, { shouldDirty: true });
      deps.form.setValue("casesOnCurrentSkid", cases, { shouldDirty: true });
      deps.persistManualPackagingProgress(activeRunId, skids, cases);
      deps.saveRunValues(activeRunId, deps.form.getValues());
    }
    const prep = base.prepPhase;
    let nextPrepPhase = prep;
    if (prep && !prep.prepCarriedOver && prep.prepBatchesDough > 0) {
      deps.form.setValue("batchesReady", (Number(deps.form.getValues("batchesReady")) || 0) + prep.prepBatchesDough, { shouldDirty: true });
      deps.markRunValuesUpdated(activeRunId, now);
      nextPrepPhase = { ...prep, prepCarriedOver: true };
    } else if (prep && !prep.prepCarriedOver) nextPrepPhase = { ...prep, prepCarriedOver: true };
    const { runs, autoEnded } = deps.startRunAndQueueCompetingCompletions({ date: base.date || deps.todayStr(), runs: base.runs, currentIndex: index, now, loadValues: deps.loadRunValues });
    const next = { ...base, runs, prepPhase: nextPrepPhase };
    deps.dayStateRef.current = next;
    deps.setDayState(next);
    deps.saveDayState(next);
    deps.schedulePush(next, 0);
    if (autoEnded.length) void deps.reportRunInsightsAfterFinalize(autoEnded, runs, deps.getRunInsightsSignal());
  });

  const pauseRun = useEvent(() => {
    if (deps.foregroundSyncBarrierRef.current || deps.formHandoffRef.current) return;
    const base = deps.dayStateRef.current;
    const index = base.currentIndex;
    const run = base.runs[index];
    if (!run?.startedAt || run.pausedAt || run.endedAt) return;
    if (lifecycleBlocked(run.id)) return;
    deps.flushFormWrites();
    const now = Date.now();
    const observed = deps.overlayRunMetaStamps([run])[0] ?? run;
    deps.queueOperationalIntent({
      runId: run.id,
      observedGeneration: `${run.id}:${observed.metaUpdatedAt ?? observed.startedAt ?? 0}`,
      effectiveAt: now,
      action: "pause",
      baseRevision: canonicalRevision(),
      preLifecycle: deps.capturePreEndLifecycle(observed),
    });
    void deps.flushOperationalIntentOutbox();
    const stop: Stoppage = { id: deps.genId(), reason: "", type: "pause", startedAt: now, stopTunnel: true };
    const next = { ...base, runs: base.runs.map((candidate, i) => i === index ? { ...candidate, pausedAt: now, pausedStoppageId: stop.id, stoppages: [...(candidate.stoppages ?? []), stop] } : candidate) };
    deps.dayStateRef.current = next;
    deps.setDayState(next);
    deps.saveDayState(next);
    deps.schedulePush(next, 0);
    deps.setActiveTab("run");
    pauseDecisionPauseIdRef.current = stop.id;
    setPauseDecisionRunId(run.id);
  });

  const setPauseTunnelPolicy = useEvent((stopTunnel: boolean) => {
    if (deps.foregroundSyncBarrierRef.current || deps.formHandoffRef.current) return;
    const runId = pauseDecisionRunId ?? deps.currentRunId;
    const pauseId = pauseDecisionPauseIdRef.current;
    const base = deps.dayStateRef.current;
    const run = base.runs.find((candidate) => candidate.id === runId);
    if (!pauseId || !run?.pausedAt || run.pausedStoppageId !== pauseId || !deps.canChoosePauseTunnelPolicy(run.pausedAt, Date.now())) {
      setPauseDecisionRunId(null);
      return;
    }
    let changed = false;
    const stoppages = (run.stoppages ?? []).map((stop) => {
      if (stop.id === pauseId && stop.type === "pause" && !stop.endedAt) {
        changed = true; return { ...stop, stopTunnel };
      }
      return stop;
    });
    if (changed) {
      const next = { ...base, runs: base.runs.map((candidate) => candidate.id === runId ? { ...candidate, stoppages } : candidate) };
      deps.dayStateRef.current = next;
      deps.setDayState(next);
      deps.saveDayState(next);
      deps.schedulePush(next, 0);
    }
    setPauseDecisionRunId(null);
  });

  const resumeRun = useEvent(() => {
    if (deps.foregroundSyncBarrierRef.current || deps.formHandoffRef.current) return;
    const base = deps.dayStateRef.current;
    const index = base.currentIndex;
    const run = base.runs[index];
    if (!run) return;
    if (lifecycleBlocked(run.id)) return;
    deps.flushFormWrites();
    const now = Date.now();
    const observed = deps.overlayRunMetaStamps([run])[0] ?? run;
    deps.queueOperationalIntent({
      runId: run.id,
      observedGeneration: `${run.id}:${observed.metaUpdatedAt ?? observed.startedAt ?? 0}`,
      effectiveAt: now,
      action: "resume",
      baseRevision: canonicalRevision(),
      preLifecycle: deps.capturePreEndLifecycle(observed),
    });
    void deps.flushOperationalIntentOutbox();
    const resumed = deps.applyResumeToRun(run, now);
    if (!resumed) return;
    const next = { ...base, runs: base.runs.map((candidate, i) => i === index ? resumed : candidate) };
    deps.dayStateRef.current = next;
    deps.setDayState(next);
    deps.saveDayState(next);
    deps.schedulePush(next, 0);
    setPauseDecisionRunId(null);
  });

  const endRun = useEvent((expectedRunId?: string, fromForegroundRecovery = false) => {
    const base = deps.dayStateRef.current;
    const index = base.currentIndex;
    const activeRun = base.runs[index];
    if (deps.formHandoffRef.current) return;
    if (activeRun && lifecycleBlocked(activeRun.id)) return;
    if (deps.foregroundSyncBarrierRef.current && !fromForegroundRecovery) {
      if (activeRun?.startedAt && !activeRun.endedAt && (!deps.foregroundStopIntentRef.current || deps.foregroundStopIntentRef.current.runId === activeRun.id)) {
        deps.foregroundStopIntentRef.current = { action: "stop", runId: activeRun.id };
        deps.setPendingForegroundStopRunId(activeRun.id);
        deps.showForegroundRecoveryNotice("recovering", "Stop requested. Checking the current run state before applying it…");
        deps.recordSyncEvent("local", "Stop request queued behind foreground recovery", undefined, activeRun.id);
      }
      return;
    }
    if (!activeRun?.startedAt || activeRun.endedAt) return;
    if (expectedRunId && activeRun.id !== expectedRunId) {
      deps.showForegroundRecoveryNotice("outcome", "Stop was not applied because the displayed run changed elsewhere. No other run was stopped.");
      return;
    }
    deps.flushFormWrites();
    const values = deps.form.getValues();
    deps.saveRunValues(activeRun.id, values);
    if (deps.canManageProfiles && (activeRun.brand || activeRun.flavor) && deps.saveProfile(activeRun.brand, activeRun.flavor, values)) void deps.propagateProfileToPendingRuns(activeRun.brand, activeRun.flavor);
    const endedAt = Date.now();
    const observed = deps.overlayRunMetaStamps([activeRun])[0];
    deps.queueOperationalIntent({
      runId: activeRun.id,
      observedGeneration: `${activeRun.id}:${observed.metaUpdatedAt ?? observed.startedAt ?? 0}`,
      effectiveAt: endedAt,
      action: "lifecycle",
      lifecycle: "end",
      baseRevision: canonicalRevision(),
      preLifecycle: deps.capturePreEndLifecycle(observed),
      preEndLifecycle: deps.capturePreEndLifecycle(observed),
      inventoryLines: deps.computeRunConsumptionLines(deps.effectiveValuesForRun(activeRun, values)),
    });
    if (deps.browserIsOnline()) void deps.flushOperationalIntentOutbox();
    const runs = base.runs.map((run, i) => i === index ? { ...run, pausedAt: undefined, endedAt } : run);
    const nextIndex = index + 1 < base.runs.length ? index + 1 : index;
    const next = { ...base, runs, currentIndex: nextIndex };
    deps.dayStateRef.current = next;
    deps.setDayState(next);
    deps.saveDayState(next);
    void deps.reportRunInsightsAfterFinalize(runs.filter((run) => run.id === activeRun.id), runs, deps.getRunInsightsSignal());
    if (nextIndex !== index) {
      const nextRun = base.runs[nextIndex];
      const nextValues = deps.loadRunValues(nextRun.id);
      deps.lastFormRunIdRef.current = nextRun.id;
      deps.form.reset(nextValues);
      deps.resetFieldArrays(nextValues);
      deps.setActiveStopId(runs[nextIndex].stoppages?.find((stop) => !stop.endedAt)?.id ?? null);
    } else deps.setActiveStopId(null);
    deps.setConfirmDeleteStopId(null);
    deps.schedulePush(next, 0);
  });

  useEffect(() => {
    if (!pauseDecisionRunId) return;
    const pauseId = pauseDecisionPauseIdRef.current;
    const pausedAt = deps.currentRun?.id === pauseDecisionRunId ? deps.currentRun.pausedAt : undefined;
    if (!pausedAt || deps.currentRun?.pausedStoppageId !== pauseId) { setPauseDecisionRunId(null); return; }
    const close = () => setPauseDecisionRunId(null);
    const timer = window.setTimeout(close, deps.pauseDecisionRemainingMs(pausedAt, Date.now()));
    const closeWhenHidden = () => {
      if (deps.shouldClosePauseDecision(pausedAt, Date.now(), document.visibilityState === "visible")) close();
    };
    document.addEventListener("visibilitychange", closeWhenHidden);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", closeWhenHidden); };
  }, [deps.currentRun, pauseDecisionRunId]);

  useEffect(() => {
    if (pauseDecisionRunId && (!deps.currentRun || deps.currentRun.id !== pauseDecisionRunId || !deps.currentRun.pausedAt)) setPauseDecisionRunId(null);
  }, [deps.currentRun, pauseDecisionRunId]);

  return {
    switchToRun, startRun, pauseRun, setPauseTunnelPolicy, resumeRun, endRun,
    pauseDecisionRunId,
    dismissPauseDecision: useEvent((_value?: null) => setPauseDecisionRunId(null)),
  };
}