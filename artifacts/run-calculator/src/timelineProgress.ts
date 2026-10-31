import { buildTimelineRuns, type TimelineRun } from "./dayTimeline";
import { loadPackagingProgress } from "./packagingProgress";
import type { FormValues, RunMeta } from "./types";

/** Read-only adapter shared by Schedule and Summary. Recipe/draft inputs stay
 * caller-owned; packaging counters come from this run's authoritative register.
 * Future-date plans must not borrow today's progress, even if IDs coincide.
 */
export function buildProgressAwareTimelineRuns(
  runs: RunMeta[],
  values: (run: RunMeta) => Partial<FormValues> | undefined,
  nowMs: number,
  isToday: boolean,
): TimelineRun[] {
  const progressByRun: ReturnType<typeof loadPackagingProgress> = isToday ? loadPackagingProgress() : {};
  return buildTimelineRuns(runs, run => {
    const base = values(run);
    const progress = progressByRun[run.id];
    if (!base || !progress) return base;
    return {
      ...base,
      skidsCompleted: progress.skidsCompleted,
      casesOnCurrentSkid: progress.casesOnCurrentSkid,
    };
  }, nowMs);
}
