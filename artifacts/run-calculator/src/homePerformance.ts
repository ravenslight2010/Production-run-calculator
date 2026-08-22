import type { FormValues, RunMeta } from "./types";

/**
 * Reads persisted values once for a stable day snapshot. The current form is
 * overlaid separately so typing in the active run never causes storage reads
 * for every other run.
 */
export function buildPersistedRunValues(
  runs: readonly RunMeta[],
  loadValues: (runId: string) => FormValues,
): ReadonlyMap<string, FormValues> {
  const values = new Map<string, FormValues>();
  for (const run of runs) values.set(run.id, loadValues(run.id));
  return values;
}

export function overlayCurrentRunValues(
  persistedValues: ReadonlyMap<string, FormValues>,
  currentRunId: string,
  currentValues: FormValues,
): ReadonlyMap<string, FormValues> {
  const values = new Map(persistedValues);
  if (currentRunId) values.set(currentRunId, currentValues);
  return values;
}

export function buildRunSummarySnapshot<T>(
  runs: readonly RunMeta[],
  valuesById: ReadonlyMap<string, FormValues>,
  summarize: (values: FormValues) => T,
): ReadonlyMap<string, T> {
  const summaries = new Map<string, T>();
  for (const run of runs) {
    const values = valuesById.get(run.id);
    if (values) summaries.set(run.id, summarize(values));
  }
  return summaries;
}

export function buildActiveRunIds(runs: readonly RunMeta[]): readonly string[] {
  return runs.filter((run) => !run.endedAt).map((run) => run.id);
}