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
  }, [currentRunId]);

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

    const now = Date.now();
    if (run.seeded) {
      dayState = {
        ...dayState,
        runs: dayState.runs.map((candidate) =>
          candidate.id === runId ? { ...candidate, seeded: false } : candidate,
        ),
      };
      dayStateRef.current = dayState;
      // Home owns canonical day persistence; this is the intentional edit-side
      // mutation before its canonical sync payload is built.
      saveDayState(dayState);
      setDayState(dayState);
    }
    saveRunValues(runId, values);
    markRunValuesUpdated(runId, now);
    if (canManageProfiles && (run.brand || run.flavor)) {
      if (saveProfileForRun(run.brand, run.flavor, values)) {
        void propagateProfileToPendingRuns(run.brand, run.flavor);
      }
    }
    lastLocalEditRef.current = now;
    schedulePush(dayState, undefined, "edit");
    flashSaved();
  }, [values]);
}