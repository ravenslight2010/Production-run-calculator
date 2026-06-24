import { describe, it, expect } from "vitest";
import {
  normalizeCycleCountSchedule,
  normalizeCycleCountSchedules,
  daysSince,
  buildCycleCountDueList,
  DEFAULT_CADENCE_DAYS,
  type CycleCountSchedule,
} from "@workspace/cycle-count";

// Tests live in the artifact (libs hold no tests). Exercise the pure
// cycle-count model that both web and mobile feed into.

describe("normalizeCycleCountSchedule", () => {
  it("defaults cadenceDays to 7, enabled true, lastCountedAt null", () => {
    const s = normalizeCycleCountSchedule({ section: "Freezer" });
    expect(s).toMatchObject({
      section: "Freezer",
      cadenceDays: DEFAULT_CADENCE_DAYS,
      lastCountedAt: null,
      enabled: true,
    });
    expect(s?.id).toBeTruthy();
  });

  it("drops entries with no section", () => {
    expect(normalizeCycleCountSchedule({ cadenceDays: 5 })).toBeNull();
    expect(normalizeCycleCountSchedule({ section: "   " })).toBeNull();
    expect(normalizeCycleCountSchedule(null)).toBeNull();
  });

  it("trims section, keeps provided id, clamps cadence to >= 1", () => {
    const s = normalizeCycleCountSchedule({
      id: "abc",
      section: "  Dry Storage  ",
      cadenceDays: 0,
    });
    expect(s).toMatchObject({
      id: "abc",
      section: "Dry Storage",
      cadenceDays: 1,
    });
  });

  it("coerces cadenceDays from a numeric string and truncates", () => {
    const s = normalizeCycleCountSchedule({ section: "Cooler", cadenceDays: "14.9" });
    expect(s?.cadenceDays).toBe(14);
  });

  it("trims an ISO timestamp lastCountedAt to its date part", () => {
    const s = normalizeCycleCountSchedule({
      section: "Cooler",
      lastCountedAt: "2026-06-20T13:45:00.000Z",
    });
    expect(s?.lastCountedAt).toBe("2026-06-20");
  });

  it("treats a malformed lastCountedAt as null", () => {
    const s = normalizeCycleCountSchedule({ section: "Cooler", lastCountedAt: "nope" });
    expect(s?.lastCountedAt).toBeNull();
  });

  it("honors enabled false", () => {
    const s = normalizeCycleCountSchedule({ section: "Cooler", enabled: false });
    expect(s?.enabled).toBe(false);
  });
});

describe("normalizeCycleCountSchedules", () => {
  it("drops malformed entries and dedupes by section (case-insensitive)", () => {
    const list = normalizeCycleCountSchedules([
      { section: "Freezer", cadenceDays: 7 },
      { section: "freezer", cadenceDays: 3 },
      { cadenceDays: 9 },
      "bad",
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ section: "freezer", cadenceDays: 3 });
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeCycleCountSchedules(null)).toEqual([]);
    expect(normalizeCycleCountSchedules({})).toEqual([]);
  });
});

describe("daysSince", () => {
  it("counts whole calendar days between dates (UTC)", () => {
    expect(daysSince("2026-06-20", "2026-06-27")).toBe(7);
    expect(daysSince("2026-06-27", "2026-06-27")).toBe(0);
  });

  it("returns NaN for unparseable dates", () => {
    expect(Number.isNaN(daysSince("nope", "2026-06-27"))).toBe(true);
  });
});

describe("buildCycleCountDueList", () => {
  const today = "2026-06-27";

  function s(partial: Partial<CycleCountSchedule> & { section: string }): CycleCountSchedule {
    return {
      id: partial.id ?? partial.section.toLowerCase(),
      section: partial.section,
      cadenceDays: partial.cadenceDays ?? DEFAULT_CADENCE_DAYS,
      lastCountedAt: partial.lastCountedAt ?? null,
      enabled: partial.enabled ?? true,
    };
  }

  it("flags a never-counted section as due", () => {
    const due = buildCycleCountDueList({
      schedules: [s({ section: "Freezer", lastCountedAt: null })],
      today,
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ section: "Freezer", daysSince: null, overdueDays: 0 });
  });

  it("flags a section counted longer ago than its cadence", () => {
    const due = buildCycleCountDueList({
      schedules: [s({ section: "Cooler", cadenceDays: 7, lastCountedAt: "2026-06-18" })],
      today,
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ section: "Cooler", daysSince: 9, overdueDays: 2 });
  });

  it("is due exactly on the cadence boundary", () => {
    const due = buildCycleCountDueList({
      schedules: [s({ section: "Cooler", cadenceDays: 7, lastCountedAt: "2026-06-20" })],
      today,
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ daysSince: 7, overdueDays: 0 });
  });

  it("excludes a section counted recently enough", () => {
    const due = buildCycleCountDueList({
      schedules: [s({ section: "Cooler", cadenceDays: 7, lastCountedAt: "2026-06-24" })],
      today,
    });
    expect(due).toHaveLength(0);
  });

  it("excludes disabled schedules", () => {
    const due = buildCycleCountDueList({
      schedules: [s({ section: "Freezer", lastCountedAt: null, enabled: false })],
      today,
    });
    expect(due).toHaveLength(0);
  });

  it("sorts never-counted first, then most overdue, then by section", () => {
    const due = buildCycleCountDueList({
      schedules: [
        s({ section: "Slightly", cadenceDays: 7, lastCountedAt: "2026-06-19" }), // 1 over
        s({ section: "Never B", lastCountedAt: null }),
        s({ section: "Never A", lastCountedAt: null }),
        s({ section: "Very", cadenceDays: 7, lastCountedAt: "2026-06-10" }), // 10 over
      ],
      today,
    });
    expect(due.map((d) => d.section)).toEqual([
      "Never A",
      "Never B",
      "Very",
      "Slightly",
    ]);
  });
});
