import { describe, it, expect } from "vitest";
import {
  detectAnomalies,
  yieldPct,
  buildAnomalyPromptBlock,
  MIN_BASELINE_SAMPLES,
  type AnomalyRun,
} from "./index";

function run(partial: Partial<AnomalyRun> & { brand: string }): AnomalyRun {
  return {
    flavor: "Cheese",
    casesPlanned: 100,
    casesProduced: 100,
    downtimeMinutes: 5,
    stoppageCount: 1,
    ...partial,
  };
}

// A clean baseline of N near-perfect runs for one product.
function baseline(brand: string, n: number, over: Partial<AnomalyRun> = {}): AnomalyRun[] {
  return Array.from({ length: n }, () => run({ brand, ...over }));
}

describe("yieldPct", () => {
  it("computes attainment percent", () => {
    expect(yieldPct(run({ brand: "A", casesPlanned: 100, casesProduced: 80 }))).toBe(80);
  });
  it("returns null with no plan", () => {
    expect(yieldPct(run({ brand: "A", casesPlanned: 0 }))).toBeNull();
  });
});

describe("detectAnomalies — baseline gating", () => {
  it("flags nothing without enough baseline samples", () => {
    const res = detectAnomalies({
      today: [run({ brand: "A", downtimeMinutes: 120 })],
      history: baseline("A", MIN_BASELINE_SAMPLES - 1),
    });
    expect(res.anomalies).toHaveLength(0);
    expect(res.checkedRuns).toBe(1);
  });

  it("uses the global baseline when the product has thin history", () => {
    // Product "B" has no history, but other products give a global baseline.
    const res = detectAnomalies({
      today: [run({ brand: "B", downtimeMinutes: 120 })],
      history: baseline("A", 5, { downtimeMinutes: 5 }),
    });
    expect(res.anomalies.some((a) => a.metric === "downtime")).toBe(true);
  });
});

describe("detectAnomalies — downtime", () => {
  it("flags a downtime spike vs product baseline", () => {
    const res = detectAnomalies({
      today: [run({ brand: "A", downtimeMinutes: 60 })],
      history: baseline("A", 4, { downtimeMinutes: 5 }),
    });
    const a = res.anomalies.find((x) => x.metric === "downtime");
    expect(a).toBeTruthy();
    expect(a!.severity).toBe("high");
    expect(a!.observed).toBe(60);
    expect(a!.baseline).toBe(5);
  });

  it("does NOT flag downtime within normal range", () => {
    const res = detectAnomalies({
      today: [run({ brand: "A", downtimeMinutes: 6 })],
      history: baseline("A", 4, { downtimeMinutes: 5 }),
    });
    expect(res.anomalies.some((a) => a.metric === "downtime")).toBe(false);
  });

  it("requires both relative AND absolute gap (small numbers don't trip)", () => {
    // 2 min vs 1 min baseline = 2x ratio but only +1 min absolute → no flag.
    const res = detectAnomalies({
      today: [run({ brand: "A", downtimeMinutes: 2 })],
      history: baseline("A", 4, { downtimeMinutes: 1 }),
    });
    expect(res.anomalies.some((a) => a.metric === "downtime")).toBe(false);
  });
});

describe("detectAnomalies — yield", () => {
  it("flags a yield drop below baseline", () => {
    const res = detectAnomalies({
      today: [run({ brand: "A", casesPlanned: 100, casesProduced: 60 })],
      history: baseline("A", 4, { casesPlanned: 100, casesProduced: 100 }),
    });
    const a = res.anomalies.find((x) => x.metric === "yield");
    expect(a).toBeTruthy();
    expect(a!.severity).toBe("high"); // 40pt drop
    expect(a!.observed).toBe(60);
  });

  it("does not flag near-target yield even if baseline is 100%", () => {
    const res = detectAnomalies({
      today: [run({ brand: "A", casesPlanned: 100, casesProduced: 97 })],
      history: baseline("A", 4, { casesProduced: 100 }),
    });
    expect(res.anomalies.some((a) => a.metric === "yield")).toBe(false);
  });
});

describe("detectAnomalies — stoppages", () => {
  it("flags a stoppage spike", () => {
    const res = detectAnomalies({
      today: [run({ brand: "A", stoppageCount: 8 })],
      history: baseline("A", 4, { stoppageCount: 1 }),
    });
    const a = res.anomalies.find((x) => x.metric === "stoppages");
    expect(a).toBeTruthy();
    expect(a!.severity).toBe("high");
  });
});

describe("detectAnomalies — ordering & empty", () => {
  it("orders high severity before medium", () => {
    const res = detectAnomalies({
      today: [
        run({ brand: "A", downtimeMinutes: 16 }), // ~3.2x of 5 → +11 → medium-ish/high
        run({ brand: "C", casesPlanned: 100, casesProduced: 60 }), // high yield drop
      ],
      history: [
        ...baseline("A", 4, { downtimeMinutes: 5 }),
        ...baseline("C", 4, { casesProduced: 100 }),
      ],
    });
    expect(res.anomalies.length).toBeGreaterThan(0);
    const severities = res.anomalies.map((a) => a.severity);
    // first should be the most severe
    expect(severities[0]).toBe("high");
  });

  it("returns no anomalies for a clean day", () => {
    const res = detectAnomalies({
      today: [run({ brand: "A" })],
      history: baseline("A", 5),
    });
    expect(res.anomalies).toHaveLength(0);
    expect(buildAnomalyPromptBlock(res)).toContain("No anomalies");
  });

  it("handles empty input", () => {
    const res = detectAnomalies({ today: [], history: [] });
    expect(res.anomalies).toHaveLength(0);
    expect(res.checkedRuns).toBe(0);
    expect(res.baselineRuns).toBe(0);
  });
});

describe("buildAnomalyPromptBlock", () => {
  it("lists flagged anomalies", () => {
    const res = detectAnomalies({
      today: [run({ brand: "A", downtimeMinutes: 60 })],
      history: baseline("A", 4, { downtimeMinutes: 5 }),
    });
    const block = buildAnomalyPromptBlock(res);
    expect(block).toContain("downtime");
    expect(block).toContain("baseline");
  });
});
