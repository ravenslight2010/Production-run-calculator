// Blank/unnamed placeholder runs (e.g. the auto-seeded run created when
// someone signs in on an off day) must not appear in the Summary-tab history:
// they are filtered at archive time AND at display time (so history polluted
// before this change, or by older peers over sync, cleans up too).

import { describe, it, expect, beforeEach } from "vitest";
import {
  isDisplayableHistoryRun,
  filterMeaningfulHistory,
  archiveDayToHistory,
  loadHistory,
  freshDayState,
} from "./storage";
import { DEFAULT_VALUES, RUN_KEY, type HistoryDay, type RunMeta } from "./types";

const run = (over: Partial<RunMeta> = {}): RunMeta =>
  ({ id: over.id ?? "r1", brand: "", flavor: "", ...over }) as RunMeta;

beforeEach(() => localStorage.clear());

describe("isDisplayableHistoryRun", () => {
  it("hides blank unnamed runs, keeps named/started/noted ones", () => {
    expect(isDisplayableHistoryRun(run())).toBe(false);
    expect(isDisplayableHistoryRun(run({ seeded: true }))).toBe(false);
    expect(isDisplayableHistoryRun(run({ brand: "Aldo's" }))).toBe(true);
    expect(isDisplayableHistoryRun(run({ flavor: "Cheese" }))).toBe(true);
    expect(isDisplayableHistoryRun(run({ startedAt: Date.now() }))).toBe(true);
    expect(isDisplayableHistoryRun(run({ notes: "test batch" }))).toBe(true);
    expect(isDisplayableHistoryRun(run({ notes: "   " }))).toBe(false);
  });
});

describe("filterMeaningfulHistory", () => {
  it("drops blank runs from days and drops days left empty", () => {
    const days: HistoryDay[] = [
      { date: "2026-07-20", runs: [run({ id: "a", brand: "Aldo's" }), run({ id: "b" })], runValues: {} },
      { date: "2026-07-19", runs: [run({ id: "c" })], runValues: {} },
    ];
    const out = filterMeaningfulHistory(days);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-07-20");
    expect(out[0].runs.map(r => r.id)).toEqual(["a"]);
  });
});

describe("archiveDayToHistory", () => {
  it("does not archive a day that only has the blank placeholder run", () => {
    archiveDayToHistory(freshDayState(), "2026-07-21");
    expect(loadHistory()).toHaveLength(0);
  });

  it("archives only the meaningful runs of a mixed day", () => {
    const ds = freshDayState();
    const real = run({ id: "real1", brand: "Aldo's", flavor: "Cheese", startedAt: 1, endedAt: 2 });
    ds.runs.push(real);
    localStorage.setItem(RUN_KEY("real1"), JSON.stringify({ ...DEFAULT_VALUES, casesNeeded: 100 }));
    archiveDayToHistory(ds, "2026-07-21");
    const hist = loadHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].runs.map(r => r.id)).toEqual(["real1"]);
    expect(hist[0].runValues["real1"].casesNeeded).toBe(100);
  });
});
