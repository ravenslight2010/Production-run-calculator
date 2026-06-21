import { describe, it, expect } from "vitest";
import type { FacilityKnowledge } from "@workspace/ai-memory";
import type { ForecastPlanOut } from "./aiForecast";
import {
  formatForecastFact,
  parseForecastFact,
  summarizeActualDay,
  caseAccuracyPct,
  compareForecastToActual,
  buildForecastReviews,
  summarizeAccuracyTrend,
  formatAccuracyFact,
  formatAccuracyGrounding,
  validateForecastAccuracyBody,
  ACCURACY_MAX_TOTAL_RUNS,
  ACCURACY_GROUNDING_MAX_PRODUCTS,
  type ForecastAccuracyReviewOut,
} from "./forecastAccuracy";

function plan(overrides: Partial<ForecastPlanOut> = {}): ForecastPlanOut {
  return {
    targetDate: "2026-06-16",
    confidence: "high",
    summary: "",
    runs: [
      { brand: "Tony's", flavor: "Pepperoni", dieType: "12in", casesNeeded: 300, rationale: "" },
      { brand: "Tony's", flavor: "Cheese", dieType: "12in", casesNeeded: 150, rationale: "" },
    ],
    ...overrides,
  };
}

function fact(domain: string, key: string, factText: string): FacilityKnowledge {
  return { domain, key, fact: factText };
}

describe("formatForecastFact / parseForecastFact round-trip", () => {
  it("round-trips date, confidence, and per-product cases", () => {
    const text = formatForecastFact(plan());
    const parsed = parseForecastFact({ key: "plan:2026-06-16", fact: text });
    expect(parsed).not.toBeNull();
    expect(parsed!.date).toBe("2026-06-16");
    expect(parsed!.confidence).toBe("high");
    expect(parsed!.products).toEqual([
      { label: "Tony's Pepperoni", cases: 300 },
      { label: "Tony's Cheese", cases: 150 },
    ]);
  });

  it("collapses brand+flavor spacing and rounds cases", () => {
    const text = formatForecastFact(
      plan({ runs: [{ brand: " Tony's ", flavor: "", dieType: "", casesNeeded: 99.6, rationale: "" }] }),
    );
    expect(text).toContain("Tony's (~100cs)");
  });

  it("ignores non-plan keys (e.g. our own accuracy notes)", () => {
    expect(parseForecastFact({ key: "accuracy:2026-06-16", fact: "anything" })).toBeNull();
    expect(parseForecastFact({ key: "ppm-trend", fact: "x" })).toBeNull();
  });

  it("rejects a malformed date in the key", () => {
    expect(parseForecastFact({ key: "plan:not-a-date", fact: "x" })).toBeNull();
  });

  it("tolerates a truncated tail, keeping surviving products", () => {
    const truncated = "Forecast for 2026-06-16 [low confidence]: A B (~10cs), C D (~2";
    const parsed = parseForecastFact({ key: "plan:2026-06-16", fact: truncated });
    expect(parsed!.products).toEqual([{ label: "A B", cases: 10 }]);
    expect(parsed!.confidence).toBe("low");
  });

  it("dedupes repeated product labels by keeping the first", () => {
    const parsed = parseForecastFact({
      key: "plan:2026-06-16",
      fact: "Forecast for 2026-06-16 [medium confidence]: A B (~10cs), a b (~99cs).",
    });
    expect(parsed!.products).toEqual([{ label: "A B", cases: 10 }]);
  });
});

describe("summarizeActualDay", () => {
  it("sums cases across runs of the same product (case-insensitive label)", () => {
    const day = summarizeActualDay({
      date: "2026-06-16",
      runs: [
        { brand: "Tony's", flavor: "Pepperoni", cases: 100 },
        { brand: "tony's", flavor: "pepperoni", cases: 50 },
        { brand: "Tony's", flavor: "Cheese", cases: 40 },
      ],
    });
    expect(day.totalCases).toBe(190);
    expect(day.products.get("tony's pepperoni")!.cases).toBe(150);
    expect(day.products.get("tony's cheese")!.cases).toBe(40);
  });
});

describe("caseAccuracyPct", () => {
  it("scores equal totals (incl. both zero) at 100", () => {
    expect(caseAccuracyPct(300, 300)).toBe(100);
    expect(caseAccuracyPct(0, 0)).toBe(100);
  });
  it("falls linearly with the relative gap and clamps at 0", () => {
    expect(caseAccuracyPct(300, 270)).toBe(90);
    expect(caseAccuracyPct(100, 0)).toBe(0);
    expect(caseAccuracyPct(0, 100)).toBe(0);
  });
});

describe("compareForecastToActual", () => {
  it("classifies hit / over / under / missed / unexpected", () => {
    const forecast = {
      date: "2026-06-16",
      confidence: "high" as const,
      products: [
        { label: "A Hit", cases: 100 }, // actual 105 -> hit (within 10%)
        { label: "B Over", cases: 200 }, // actual 100 -> over
        { label: "C Under", cases: 50 }, // actual 120 -> under
        { label: "D Missed", cases: 80 }, // actual 0 -> missed
      ],
    };
    const actual = summarizeActualDay({
      date: "2026-06-16",
      runs: [
        { brand: "A", flavor: "Hit", cases: 105 },
        { brand: "B", flavor: "Over", cases: 100 },
        { brand: "C", flavor: "Under", cases: 120 },
        { brand: "E", flavor: "Surprise", cases: 30 }, // unexpected
      ],
    });
    const review = compareForecastToActual(forecast, actual);
    const byLabel = Object.fromEntries(review.products.map((p) => [p.label, p.status]));
    expect(byLabel["A Hit"]).toBe("hit");
    expect(byLabel["B Over"]).toBe("over");
    expect(byLabel["C Under"]).toBe("under");
    expect(byLabel["D Missed"]).toBe("missed");
    expect(byLabel["E Surprise"]).toBe("unexpected");
    expect(review.predictedTotalCases).toBe(430);
    expect(review.actualTotalCases).toBe(355);
  });
});

describe("buildForecastReviews", () => {
  const knowledge: FacilityKnowledge[] = [
    fact("forecast", "plan:2026-06-16", "Forecast for 2026-06-16 [high confidence]: A B (~100cs)."),
    fact("forecast", "plan:2026-06-17", "Forecast for 2026-06-17 [low confidence]: C D (~50cs)."),
    fact("forecast", "accuracy:2026-06-16", "Forecast accuracy for 2026-06-16: ..."),
    fact("oven", "oven-1", "unrelated domain"),
  ];

  it("only reviews dates that were forecast AND have finished actual runs", () => {
    const reviews = buildForecastReviews(knowledge, [
      { date: "2026-06-16", runs: [{ brand: "A", flavor: "B", cases: 90 }] },
      // 2026-06-17 forecast exists but no actual history -> no review
      { date: "2026-06-15", runs: [{ brand: "X", flavor: "Y", cases: 10 }] }, // actual w/o forecast
    ]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].date).toBe("2026-06-16");
    expect(reviews[0].predictedTotalCases).toBe(100);
    expect(reviews[0].actualTotalCases).toBe(90);
  });

  it("returns newest first", () => {
    const reviews = buildForecastReviews(knowledge, [
      { date: "2026-06-16", runs: [{ brand: "A", flavor: "B", cases: 90 }] },
      { date: "2026-06-17", runs: [{ brand: "C", flavor: "D", cases: 50 }] },
    ]);
    expect(reviews.map((r) => r.date)).toEqual(["2026-06-17", "2026-06-16"]);
  });
});

describe("summarizeAccuracyTrend", () => {
  function review(
    date: string,
    caseAccuracyPct: number,
    products: ForecastAccuracyReviewOut["products"],
  ): ForecastAccuracyReviewOut {
    return {
      date,
      confidence: "medium",
      predictedTotalCases: 0,
      actualTotalCases: 0,
      caseAccuracyPct,
      products,
    };
  }

  it("averages case accuracy and counts the days scored", () => {
    const trend = summarizeAccuracyTrend([
      review("2026-06-17", 90, []),
      review("2026-06-16", 70, []),
      review("2026-06-15", 80, []),
    ]);
    expect(trend.daysScored).toBe(3);
    expect(trend.averageCaseAccuracyPct).toBe(80);
  });

  it("returns zeros and empty lists when there are no reviews", () => {
    const trend = summarizeAccuracyTrend([]);
    expect(trend).toEqual({
      daysScored: 0,
      averageCaseAccuracyPct: 0,
      chronicOver: [],
      chronicUnder: [],
    });
  });

  it("flags products over/under-predicted on at least two days (case-insensitive)", () => {
    const trend = summarizeAccuracyTrend([
      review("2026-06-17", 80, [
        { label: "Tony's Pepperoni", predictedCases: 200, actualCases: 100, status: "over" },
        { label: "Tony's Cheese", predictedCases: 50, actualCases: 120, status: "under" },
      ]),
      review("2026-06-16", 80, [
        { label: "tony's pepperoni", predictedCases: 180, actualCases: 90, status: "over" },
        { label: "Tony's Cheese", predictedCases: 60, actualCases: 130, status: "under" },
      ]),
    ]);
    expect(trend.chronicOver).toEqual([
      { label: "Tony's Pepperoni", daysOver: 2, daysUnder: 0, daysScored: 2 },
    ]);
    expect(trend.chronicUnder).toEqual([
      { label: "Tony's Cheese", daysOver: 0, daysUnder: 2, daysScored: 2 },
    ]);
  });

  it("does not flag a one-off miss or a hit", () => {
    const trend = summarizeAccuracyTrend([
      review("2026-06-17", 90, [
        { label: "A B", predictedCases: 100, actualCases: 200, status: "under" },
        { label: "C D", predictedCases: 100, actualCases: 105, status: "hit" },
      ]),
      review("2026-06-16", 90, [
        { label: "C D", predictedCases: 100, actualCases: 100, status: "hit" },
      ]),
    ]);
    expect(trend.chronicOver).toEqual([]);
    expect(trend.chronicUnder).toEqual([]);
  });

  it("classifies by dominant direction when a product misses both ways", () => {
    const trend = summarizeAccuracyTrend([
      review("2026-06-18", 80, [
        { label: "A B", predictedCases: 200, actualCases: 100, status: "over" },
      ]),
      review("2026-06-17", 80, [
        { label: "A B", predictedCases: 200, actualCases: 100, status: "over" },
      ]),
      review("2026-06-16", 80, [
        { label: "A B", predictedCases: 50, actualCases: 120, status: "under" },
      ]),
    ]);
    expect(trend.chronicOver).toEqual([
      { label: "A B", daysOver: 2, daysUnder: 1, daysScored: 3 },
    ]);
    expect(trend.chronicUnder).toEqual([]);
  });
});

describe("formatAccuracyFact", () => {
  it("produces a concise human-readable accuracy note", () => {
    const review = compareForecastToActual(
      { date: "2026-06-16", confidence: "medium", products: [{ label: "A B", cases: 100 }] },
      summarizeActualDay({ date: "2026-06-16", runs: [{ brand: "A", flavor: "B", cases: 90 }] }),
    );
    const text = formatAccuracyFact(review);
    expect(text).toContain("2026-06-16");
    expect(text).toContain("predicted 100cs");
    expect(text).toContain("actual 90cs");
    expect(text).toContain("% case accuracy");
  });
});

describe("formatAccuracyGrounding", () => {
  it("returns an empty string when nothing has been scored yet", () => {
    expect(
      formatAccuracyGrounding({
        daysScored: 0,
        averageCaseAccuracyPct: 0,
        chronicOver: [],
        chronicUnder: [],
      }),
    ).toBe("");
  });

  it("names chronic over- and under-predicted products with day counts", () => {
    const text = formatAccuracyGrounding({
      daysScored: 4,
      averageCaseAccuracyPct: 78,
      chronicOver: [{ label: "Tony's Pepperoni", daysOver: 3, daysUnder: 0, daysScored: 4 }],
      chronicUnder: [{ label: "Tony's Cheese", daysOver: 0, daysUnder: 2, daysScored: 2 }],
    });
    expect(text).toContain("RECENT FORECAST ACCURACY");
    expect(text).toContain("4 reviewed day(s): 78%");
    expect(text).toContain("OVER-predicted");
    expect(text).toContain('"Tony\'s Pepperoni" (over on 3 of 4 day(s))');
    expect(text).toContain("UNDER-predicted");
    expect(text).toContain('"Tony\'s Cheese" (under on 2 of 2 day(s))');
  });

  it("notes when no product is consistently mispredicted but days were scored", () => {
    const text = formatAccuracyGrounding({
      daysScored: 2,
      averageCaseAccuracyPct: 95,
      chronicOver: [],
      chronicUnder: [],
    });
    expect(text).toContain("2 reviewed day(s): 95%");
    expect(text).toContain("No single product is consistently over- or under-predicted yet.");
  });

  it("caps the number of named products per direction", () => {
    const many = Array.from({ length: ACCURACY_GROUNDING_MAX_PRODUCTS + 5 }, (_, i) => ({
      label: `Brand ${i}`,
      daysOver: 3,
      daysUnder: 0,
      daysScored: 3,
    }));
    const text = formatAccuracyGrounding({
      daysScored: 3,
      averageCaseAccuracyPct: 60,
      chronicOver: many,
      chronicUnder: [],
    });
    const overLine = text.split("\n").find((l) => l.includes("OVER-predicted"))!;
    const named = overLine.split("\"").filter((_, i) => i % 2 === 1).length;
    expect(named).toBe(ACCURACY_GROUNDING_MAX_PRODUCTS);
  });
});

describe("validateForecastAccuracyBody", () => {
  it("accepts a well-formed body", () => {
    const res = validateForecastAccuracyBody({
      nowMs: Date.now(),
      history: [
        {
          date: "2026-06-16",
          runs: [{ brand: "A", flavor: "B", dieType: "", cases: 90, netRunMin: 60 }],
        },
      ],
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a malformed body", () => {
    const res = validateForecastAccuracyBody({ history: "nope" });
    expect(res.ok).toBe(false);
  });

  it("rejects too many runs", () => {
    const runs = Array.from({ length: ACCURACY_MAX_TOTAL_RUNS + 1 }, () => ({
      brand: "A",
      flavor: "B",
      dieType: "",
      cases: 1,
      netRunMin: 1,
    }));
    const res = validateForecastAccuracyBody({ nowMs: 0, history: [{ date: "2026-06-16", runs }] });
    expect(res.ok).toBe(false);
  });
});
