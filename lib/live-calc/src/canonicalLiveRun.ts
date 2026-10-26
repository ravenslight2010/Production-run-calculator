/** Shared displays follow lifecycle, never a device's screen selection.
 * Prefer the latest started, unended run (including paused); otherwise retain
 * the latest ended run for drain displays, or the first pending run for setup.
 * Equal lifecycle times use schedule order as a deterministic tie-break.
 */
export function selectCanonicalLiveRun<T extends {
  id?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
}>(runs: readonly T[] | undefined): T | undefined {
  let active: T | undefined;
  let ended: T | undefined;
  let pending: T | undefined;
  const positiveTime = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  for (const run of runs ?? []) {
    if (typeof run.id !== "string" || !run.id) continue;
    if (positiveTime(run.startedAt) && run.endedAt == null) {
      if (!active || positiveTime(run.startedAt) >= positiveTime(active.startedAt)) active = run;
    } else if (positiveTime(run.endedAt)) {
      if (!ended || positiveTime(run.endedAt) >= positiveTime(ended.endedAt)) ended = run;
    } else if (run.startedAt == null && run.endedAt == null) {
      pending ??= run;
    }
  }
  return active ?? ended ?? pending;
}
