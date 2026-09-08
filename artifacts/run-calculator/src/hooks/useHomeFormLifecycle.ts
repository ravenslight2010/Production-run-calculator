import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { DayState, FormValues } from "../types";
import {
  deepEqual,
  isEmptyOverPopulated,
  shouldHealFormFromStored,
  shouldResetFormOnRunSwitch,
} from "../domain/runSyncPolicy";
import { loadRunValues, markRunValuesUpdated, saveRunValues } from "../adapters/browserRunPersistence";
import { KeyedDurableWriter } from "../keyedDurableWriter";

const AUTOSAVE_DURABLE_DELAY_MS = 120;
const homeFormDurableWriter = new KeyedDurableWriter(AUTOSAVE_DURABLE_DELAY_MS);

/** Flush pending attributed form writes before an imperative durability boundary. */
export function flushPendingHomeFormWrites(): void {
  homeFormDurableWriter.flushAll();
}

export interface HomeFormIdentityFences {
  /** The run for which the visible form has been explicitly settled. */
  lastFormRunIdRef: MutableRefObject<string>;
  /** Prevents watch emissions during an atomic sync/reset handoff from saving. */
  formHandoffRef: MutableRefObject<boolean>;
}

/** Pure guard kept testable independently of react-hook-form's watch timing. */
export function shouldAutosaveHomeForm(
  stored: FormValues,
  incoming: FormValues,
  formRunId: string,
  currentRunId: string,
  handoffInProgress: boolean,
): boolean {
  return formRunId === currentRunId
    && !handoffInProgress
    && !deepEqual(stored, incoming)
    && !isEmptyOverPopulated(incoming, stored);
}

export function clearSeededFlagForAutosave(
  current: DayState,
  runId: string,
  capturedRunWasSeeded: boolean,
): { dayState: DayState; changed: boolean } {
  if (!capturedRunWasSeeded) return { dayState: current, changed: false };
  const selected = current.runs[current.currentIndex];
  if (selected?.id !== runId || !selected.seeded) {
    return { dayState: current, changed: false };
  }
  return {
    dayState: {
      ...current,
      runs: current.runs.map((candidate) =>
        candidate.id === runId ? { ...candidate, seeded: false } : candidate,
      ),
    },
    changed: true,
  };
}

/**
 * Owns the two synchronous form identity fences. Home deliberately retains
 * canonical day state and chooses every imperative reset target.
 */
export function useHomeFormIdentityFences(): HomeFormIdentityFences {
  return {
    lastFormRunIdRef: useRef(""),
    formHandoffRef: useRef(false),
  };
}

interface HomeFormLifecycleOptions {
  currentRunId: string;
  persistenceScope: string;
  dayStateRef: MutableRefObject<DayState>;
  form: UseFormReturn<FormValues>;
  values: FormValues;
  fences: HomeFormIdentityFences;
  lastLocalEditRef: MutableRefObject<number>;
  resetFieldArrays: (values: FormValues) => void;
  mergeRunDefaults: (values: Partial<FormValues> | undefined) => FormValues;
  saveDayState: (dayState: DayState) => void;
  setDayState: Dispatch<SetStateAction<DayState>>;
  canManageProfiles: boolean;
  saveProfileForRun: (brand: string, flavor: string, values: FormValues) => boolean;
  propagateProfileToPendingRuns: (brand: string, flavor: string) => Promise<unknown>;
  schedulePush: (dayState: DayState, delay?: number, trigger?: "edit") => void;
  flashSaved: () => void;
}

/**
 * Keeps the form bound to Home's current run and persists genuine form edits.
 * The guards intentionally live together: moving either away from the other
 * makes an intermediate run switch capable of copying a prior run's values.
 */
export function useHomeFormLifecycle({
  currentRunId,
  persistenceScope,
  dayStateRef,
  form,
  values,
  fences,
  lastLocalEditRef,
  resetFieldArrays,
  mergeRunDefaults,
  saveDayState,
  setDayState,
  canManageProfiles,
  saveProfileForRun,
  propagateProfileToPendingRuns,
  schedulePush,
  flashSaved,
}: HomeFormLifecycleOptions) {
  useEffect(() => {
    // The previous run/scope's delayed callback captured its immutable identity.
    // Persist it before settling the visible form for a different identity.
    flushPendingHomeFormWrites();
    if (!currentRunId) return;
    const stored = loadRunValues(currentRunId);
    if (
      shouldHealFormFromStored(
        form.getValues(),
        stored,
        lastLocalEditRef.current,
        Date.now(),
      )
    ) {
      const merged = mergeRunDefaults(stored);
      fences.lastFormRunIdRef.current = currentRunId;
      form.reset(merged);
      resetFieldArrays(merged);
    } else if (
      shouldResetFormOnRunSwitch(
        form.getValues(),
        mergeRunDefaults(stored),
        fences.lastFormRunIdRef.current === currentRunId,
      )
    ) {
      const merged = mergeRunDefaults(stored);
      fences.lastFormRunIdRef.current = currentRunId;
      form.reset(merged);
      resetFieldArrays(merged);
    } else {
      fences.lastFormRunIdRef.current = currentRunId;
    }
    // A run identity transition, not changing helper identities, owns this heal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRunId, persistenceScope]);

  useEffect(() => {
    const flush = () => flushPendingHomeFormWrites();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    let dayState = dayStateRef.current;
    const run = dayState.runs[dayState.currentIndex];
    const runId = run?.id;
    if (!runId) return;
    const stored = loadRunValues(runId);
    if (!shouldAutosaveHomeForm(
      stored,
      values,
      fences.lastFormRunIdRef.current,
      runId,
      fences.formHandoffRef.current,
    )) return;

    const capturedRun = { ...run };
    const capturedValues = structuredClone(values);
    const writeKey = `${persistenceScope}:${runId}`;
    homeFormDurableWriter.schedule(writeKey, () => {
      const now = Date.now();
      const seededPatch = clearSeededFlagForAutosave(
        dayStateRef.current,
        runId,
        capturedRun.seeded === true,
      );
      if (seededPatch.changed) {
        dayStateRef.current = seededPatch.dayState;
        saveDayState(seededPatch.dayState);
        setDayState(seededPatch.dayState);
      }
      saveRunValues(runId, capturedValues);
      markRunValuesUpdated(runId, now);
      if (canManageProfiles && (capturedRun.brand || capturedRun.flavor)) {
        if (saveProfileForRun(capturedRun.brand, capturedRun.flavor, capturedValues)) {
          void propagateProfileToPendingRuns(capturedRun.brand, capturedRun.flavor);
        }
      }
      lastLocalEditRef.current = now;
      // Build the server push from the latest canonical day. A sync adoption or
      // lifecycle edit during the debounce window must never be replaced by the
      // older render that originally scheduled this run-value write.
      schedulePush(dayStateRef.current, undefined, "edit");
      flashSaved();
    });
  }, [values, persistenceScope]);
}