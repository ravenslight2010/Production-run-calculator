import type { FormValues, RunMeta } from "./types";

/**
 * Packaging completion belongs to a started run. A pending run can legitimately
 * carry staged dough counters, but never completed skids/cases from another run.
 *
 * Returning the original object for started runs and already-clean pending runs
 * keeps normal live calculations referentially stable.
 */
export function isolatePendingRunPackagingProgress(
  run: RunMeta | undefined,
  values: FormValues,
): FormValues {
  if (
    run?.startedAt ||
    (Number(values.skidsCompleted) === 0 && Number(values.casesOnCurrentSkid) === 0)
  ) {
    return values;
  }

  return {
    ...values,
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
  };
}