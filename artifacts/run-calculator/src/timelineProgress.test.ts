import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadRunValues, saveRunValues } from "./adapters/browserRunPersistence";
import { calculateDayTimeline } from "./dayTimeline";
import { buildProgressAwareTimelineRuns } from "./timelineProgress";
import { loadPackagingProgress, savePackagingProgress } from "./packagingProgress";
import { DEFAULT_VALUES, type FormValues, type RunMeta } from "./types";

const day = "2026-10-26";
const at = (clock: string) => new Date(`${day}T${clock}:00`).getTime();
const now = at("06:20");
const runs: RunMeta[] = [
  { id: "active-unselected", brand: "Fixture", flavor: "A", subTab: "crusts", startedAt: at("06:00") },
  { id: "selected", brand: "Fixture", flavor: "B", subTab: "crusts" },
];
const base: FormValues = {
  ...DEFAULT_VALUES,
  casesNeeded: 100, pizzasPerCase: 12, approxLineSpeed: 40, freezerTime: 15,
  casesPerSkid: 50, skidsCompleted: 0, casesOnCurrentSkid: 0,
};

describe("Schedule/Summary authoritative packaging input path", () => {
  beforeEach(() => {
    localStorage.clear();
    saveRunValues(runs[0].id, base);
    saveRunValues(runs[1].id, { ...base, casesNeeded: 50 });
    savePackagingProgress({
      [runs[0].id]: { skidsCompleted: 1, casesOnCurrentSkid: 10, correctionGeneration: 1, updatedAt: now, manualOverrideUntil: 0 },
      [runs[1].id]: { skidsCompleted: 0, casesOnCurrentSkid: 0, correctionGeneration: 1, updatedAt: now, manualOverrideUntil: 0 },
    });
  });

  it("both views use 60 packaged cases, not stale zeroes or the selected run's counters", () => {
    // Use the actual storage adapters used by Schedule and the Summary snapshot,
    // not a supplied progress object. Selecting another run must not change A.
    const selectedValues = { ...loadRunValues(runs[1].id), skidsCompleted: 8 };
    const storedSnapshot = new Map(runs.map(run => [run.id, loadRunValues(run.id)]));
    const scheduleDrafts = Object.fromEntries(runs.map(run => [run.id, loadRunValues(run.id)]));
    const scheduleInputs = buildProgressAwareTimelineRuns(runs, run => ({
      ...scheduleDrafts[run.id],
      ...(run.id === runs[1].id ? selectedValues : loadRunValues(run.id)),
      casesNeeded: scheduleDrafts[run.id].casesNeeded,
    }), now, true);
    const summaryInputs = buildProgressAwareTimelineRuns(runs, run =>
      run.id === runs[1].id ? selectedValues : storedSnapshot.get(run.id), now, true);
    const preview = calculateDayTimeline({ date: day, nowMs: now, runs: scheduleInputs });
    const summary = calculateDayTimeline({ date: day, nowMs: now, runs: summaryInputs });
    // 40 remaining cases × 12 pizzas ÷ 40 ppm = 12 minutes; freezer already full.
    expect(preview.runs[0].estimate?.completedCases).toBe(60);
    expect(preview.runs[0].finishMs).toBe(at("06:32"));
    expect(summary.runs[0].finishMs).toBe(preview.runs[0].finishMs);
    expect(summary.projectedFinishMs).toBe(preview.projectedFinishMs);
    expect(summary.projectedFinishMs).toBe(at("07:02"));
    expect(loadRunValues(runs[0].id).skidsCompleted).toBe(0);
    expect(loadPackagingProgress()[runs[0].id].skidsCompleted).toBe(1);
  });

  it("overlays only progress while retaining editor draft quantities, pack and rate", () => {
    const draft = { ...loadRunValues(runs[0].id), casesNeeded: 120, pizzasPerCase: 24, approxLineSpeed: 60 };
    const inputs = buildProgressAwareTimelineRuns([runs[0]], () => draft, now, true);
    const timeline = calculateDayTimeline({ date: day, nowMs: now, runs: inputs });
    expect(inputs[0].estimate).toMatchObject({ cases: 120, pizzasPerCase: 24, ppm: 60, completedCases: 60 });
    expect(timeline.runs[0].finishMs).toBe(at("06:44"));
    expect(draft.skidsCompleted).toBe(0);
    expect(loadRunValues(runs[0].id).casesNeeded).toBe(100);
  });

  it("future plans ignore today's register and do not create missing recipe inputs", () => {
    const future = [{ ...runs[0], startedAt: undefined }];
    const inputs = buildProgressAwareTimelineRuns(future, run => loadRunValues(run.id), now, false);
    expect(inputs[0].durationSec).toBe(45 * 60);
    expect(inputs[0].estimate?.completedCases).toBeUndefined();
    const missing = buildProgressAwareTimelineRuns([runs[0]], () => undefined, now, true);
    expect(missing[0].durationSec).toBeUndefined();
    expect(missing[0].remainingSec).toBeUndefined();
  });

  it("both production views call the shared register-aware adapter", () => {
    for (const file of ["./pages/home.tsx", "./components/live-stations/LiveSummaryTabContent.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("runs: buildProgressAwareTimelineRuns(");
      expect(source).not.toContain("runs: buildTimelineRuns(");
    }
  });
});
