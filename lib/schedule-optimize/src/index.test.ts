import { describe, it, expect } from "vitest";
import {
  optimizeSchedule,
  scheduleMetrics,
  countChangeovers,
  buildSchedulePromptBlock,
  type ScheduleRun,
} from "./index";
import type { ProductionRule } from "@workspace/production-rules";

function run(partial: Partial<ScheduleRun> & { id: string }): ScheduleRun {
  return {
    label: partial.label ?? `Run ${partial.id}`,
    brand: "BrandA",
    flavor: "Cheese",
    allergen: "none",
    dieType: "16in",
    ...partial,
  };
}

describe("countChangeovers", () => {
  it("counts adjacent brand/die changes", () => {
    const runs = [
      run({ id: "1", brand: "A", dieType: "16in" }),
      run({ id: "2", brand: "A", dieType: "16in" }),
      run({ id: "3", brand: "B", dieType: "16in" }),
      run({ id: "4", brand: "B", dieType: "12in" }),
    ];
    expect(countChangeovers(runs)).toBe(2);
  });

  it("is zero for a single run or empty list", () => {
    expect(countChangeovers([])).toBe(0);
    expect(countChangeovers([run({ id: "1" })])).toBe(0);
  });
});

describe("optimizeSchedule allergen ordering", () => {
  it("moves allergen runs to the end of the day", () => {
    const runs = [
      run({ id: "egg", brand: "A", allergen: "egg" }),
      run({ id: "none1", brand: "A", allergen: "none" }),
      run({ id: "none2", brand: "A", allergen: "none" }),
    ];
    const res = optimizeSchedule(runs);
    expect(res.order[res.order.length - 1]).toBe("egg");
    expect(res.after.allergenViolations).toBe(0);
    expect(res.changed).toBe(true);
    expect(res.improved).toBe(true);
  });

  it("groups allergens together and after all non-allergen runs", () => {
    const runs = [
      run({ id: "soy", brand: "A", allergen: "soy" }),
      run({ id: "none1", brand: "A", allergen: "none" }),
      run({ id: "egg", brand: "A", allergen: "egg" }),
      run({ id: "none2", brand: "A", allergen: "none" }),
    ];
    const res = optimizeSchedule(runs);
    const tier = res.ordered.map((r) => r.allergen);
    // non-allergen runs come first, allergen runs last
    expect(tier.slice(0, 2).every((a) => a === "none")).toBe(true);
    expect(tier.slice(2).every((a) => a !== "none")).toBe(true);
  });
});

describe("optimizeSchedule changeover grouping", () => {
  it("groups same brand together to cut changeovers", () => {
    const runs = [
      run({ id: "1", brand: "A", allergen: "none" }),
      run({ id: "2", brand: "B", allergen: "none" }),
      run({ id: "3", brand: "A", allergen: "none" }),
      run({ id: "4", brand: "B", allergen: "none" }),
    ];
    const before = scheduleMetrics(runs).changeovers;
    const res = optimizeSchedule(runs);
    expect(res.after.changeovers).toBeLessThan(before);
    expect(res.after.changeovers).toBe(1);
  });
});

describe("optimizeSchedule stability / no-op", () => {
  it("returns changed=false and improved=false when already optimal", () => {
    const runs = [
      run({ id: "1", brand: "A", allergen: "none" }),
      run({ id: "2", brand: "A", allergen: "none" }),
      run({ id: "3", brand: "A", allergen: "egg" }),
    ];
    const res = optimizeSchedule(runs);
    expect(res.changed).toBe(false);
    expect(res.improved).toBe(false);
  });

  it("does not mutate the input array", () => {
    const runs = [
      run({ id: "egg", allergen: "egg" }),
      run({ id: "none1", allergen: "none" }),
    ];
    const snapshot = runs.map((r) => r.id);
    optimizeSchedule(runs);
    expect(runs.map((r) => r.id)).toEqual(snapshot);
  });

  it("handles empty input", () => {
    const res = optimizeSchedule([]);
    expect(res.order).toEqual([]);
    expect(res.changed).toBe(false);
    expect(res.improved).toBe(false);
  });
});

describe("optimizeSchedule with production sequence rules", () => {
  const eggBeforeNoneRule: ProductionRule = {
    id: "r1",
    name: "Egg before none",
    type: "sequence",
    enforcement: "strict",
    enabled: true,
    attribute: "allergen",
    before: "egg",
    after: "none",
  };

  it("counts and resolves a sequence-rule violation by reordering", () => {
    const runs = [
      run({ id: "egg", allergen: "egg" }),
      run({ id: "none1", allergen: "none" }),
    ];
    expect(scheduleMetrics(runs, [eggBeforeNoneRule]).ruleViolations).toBe(1);
    const res = optimizeSchedule(runs, [eggBeforeNoneRule]);
    expect(res.after.ruleViolations).toBe(0);
  });
});

describe("buildSchedulePromptBlock", () => {
  it("includes counts and the suggested order", () => {
    const runs = [
      run({ id: "egg", label: "Run 1 · Caesar", allergen: "egg" }),
      run({ id: "none1", label: "Run 2 · Cheese", allergen: "none" }),
    ];
    const res = optimizeSchedule(runs);
    const block = buildSchedulePromptBlock(res);
    expect(block).toContain("Suggested run order:");
    expect(block).toContain("Run 2 · Cheese");
    expect(block).toContain("Run 1 · Caesar");
    expect(block).toContain("allergen: egg");
  });
});
