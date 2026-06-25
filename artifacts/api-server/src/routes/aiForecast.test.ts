import { describe, it, expect } from "vitest";
import {
  buildForecastPrompt,
  forecastTargetDates,
  computeSeasonality,
  sanitizeForecasts,
  FORECAST_MAX_HORIZON,
  type ForecastInput,
} from "./aiForecast";

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    nowMs: Date.now(),
    targetDate: "2026-06-23",
    history: [
      {
        date: "2026-06-16",
        runs: [{ brand: "Tony's", flavor: "Pepperoni", dieType: "12in", cases: 300, netRunMin: 120 }],
      },
      {
        date: "2026-06-09",
        runs: [{ brand: "Tony's", flavor: "Pepperoni", dieType: "12in", cases: 280, netRunMin: 110 }],
      },
    ],
    ...overrides,
  } as ForecastInput;
}

describe("buildForecastPrompt accuracy grounding", () => {
  it("embeds the accuracy grounding section when provided", () => {
    const grounding =
      "RECENT FORECAST ACCURACY (calibrate):\n- Consistently OVER-predicted — scale these DOWN: \"Tony's Pepperoni\" (over on 2 of 2 day(s)).";
    const { system, user } = buildForecastPrompt(input(), grounding);
    expect(user).toContain("RECENT FORECAST ACCURACY");
    expect(user).toContain('"Tony\'s Pepperoni" (over on 2 of 2 day(s))');
    // The accuracy block sits before the JSON return instruction.
    expect(user.indexOf("RECENT FORECAST ACCURACY")).toBeLessThan(user.indexOf("Return ONLY JSON"));
    // The system prompt instructs the model to lean on the accuracy feedback.
    expect(system).toContain("RECENT FORECAST ACCURACY");
  });

  it("omits the accuracy section when no grounding is given", () => {
    const { user } = buildForecastPrompt(input());
    expect(user).not.toContain("RECENT FORECAST ACCURACY");
  });

  it("omits the accuracy section for an empty grounding string", () => {
    const { user } = buildForecastPrompt(input(), "   ");
    expect(user).not.toContain("RECENT FORECAST ACCURACY");
  });
});

describe("forecastTargetDates", () => {
  it("returns just the start date for a 1-day (or omitted) horizon", () => {
    expect(forecastTargetDates("2026-06-23")).toEqual(["2026-06-23"]);
    expect(forecastTargetDates("2026-06-23", 1)).toEqual(["2026-06-23"]);
  });

  it("expands to consecutive calendar dates, crossing a month boundary", () => {
    expect(forecastTargetDates("2026-06-29", 3)).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
    ]);
  });

  it("clamps the horizon to [1, FORECAST_MAX_HORIZON]", () => {
    expect(forecastTargetDates("2026-06-23", 0)).toEqual(["2026-06-23"]);
    expect(forecastTargetDates("2026-06-23", -5)).toEqual(["2026-06-23"]);
    expect(forecastTargetDates("2026-06-23", 99)).toHaveLength(FORECAST_MAX_HORIZON);
  });

  it("returns the raw value for an unparseable date", () => {
    expect(forecastTargetDates("not-a-date", 3)).toEqual(["not-a-date"]);
  });
});

describe("computeSeasonality", () => {
  it("builds a per-weekday volume profile from history", () => {
    // Two Tuesdays (2026-06-16, 2026-06-23) and one Monday (2026-06-22).
    const s = computeSeasonality(
      input({
        history: [
          { date: "2026-06-16", runs: [{ brand: "A", flavor: "", dieType: "", cases: 100, netRunMin: 60 }] },
          { date: "2026-06-23", runs: [{ brand: "A", flavor: "", dieType: "", cases: 200, netRunMin: 60 }] },
          { date: "2026-06-22", runs: [{ brand: "A", flavor: "", dieType: "", cases: 50, netRunMin: 60 }] },
        ],
      }),
    );
    const tue = s.weekdays.find((w) => w.dow === 2);
    const mon = s.weekdays.find((w) => w.dow === 1);
    expect(tue).toEqual({ dow: 2, days: 2, avgCases: 150 });
    expect(mon).toEqual({ dow: 1, days: 1, avgCases: 50 });
    // sorted Sun→Sat (Monday before Tuesday)
    expect(s.weekdays.map((w) => w.dow)).toEqual([1, 2]);
  });

  it("stays steady with too little history (n < 4)", () => {
    const s = computeSeasonality(
      input({
        history: [
          { date: "2026-06-01", runs: [{ brand: "A", flavor: "", dieType: "", cases: 100, netRunMin: 60 }] },
          { date: "2026-06-02", runs: [{ brand: "A", flavor: "", dieType: "", cases: 500, netRunMin: 60 }] },
        ],
      }),
    );
    expect(s.trend).toBe("steady");
  });

  it("detects a rising trend when the recent third is up >15%", () => {
    const day = (date: string, cases: number) => ({
      date,
      runs: [{ brand: "A", flavor: "", dieType: "", cases, netRunMin: 60 }],
    });
    const s = computeSeasonality(
      input({
        history: [
          day("2026-06-01", 100),
          day("2026-06-02", 100),
          day("2026-06-03", 100),
          day("2026-06-04", 100),
          day("2026-06-05", 100),
          day("2026-06-06", 300),
        ],
      }),
    );
    expect(s.trend).toBe("rising");
  });

  it("detects a falling trend when the recent third is down >15%", () => {
    const day = (date: string, cases: number) => ({
      date,
      runs: [{ brand: "A", flavor: "", dieType: "", cases, netRunMin: 60 }],
    });
    const s = computeSeasonality(
      input({
        history: [
          day("2026-06-01", 300),
          day("2026-06-02", 300),
          day("2026-06-03", 300),
          day("2026-06-04", 300),
          day("2026-06-05", 300),
          day("2026-06-06", 50),
        ],
      }),
    );
    expect(s.trend).toBe("falling");
  });
});

describe("sanitizeForecasts", () => {
  const plan = (targetDate: string, brand: string) => ({
    targetDate,
    confidence: "high",
    summary: "ok",
    runs: [{ brand, flavor: "Pep", dieType: "12in", casesNeeded: 100, rationale: "why" }],
  });

  it("returns one clean plan per usable day, in date order", () => {
    const dates = ["2026-06-23", "2026-06-24", "2026-06-25"];
    const { forecasts } = sanitizeForecasts(
      { forecasts: [plan("2026-06-25", "C"), plan("2026-06-23", "A"), plan("2026-06-24", "B")] },
      dates,
    );
    expect(forecasts.map((f) => f.targetDate)).toEqual(dates);
  });

  it("dedupes plans that share a date", () => {
    const dates = ["2026-06-23", "2026-06-24"];
    const { forecasts } = sanitizeForecasts(
      { forecasts: [plan("2026-06-23", "A"), plan("2026-06-23", "B")] },
      dates,
    );
    expect(forecasts).toHaveLength(1);
    expect(forecasts[0].targetDate).toBe("2026-06-23");
  });

  it("caps the number of plans to the requested horizon", () => {
    const dates = ["2026-06-23", "2026-06-24"];
    const { forecasts } = sanitizeForecasts(
      { forecasts: [plan("2026-06-23", "A"), plan("2026-06-24", "B"), plan("2026-06-25", "C")] },
      dates,
    );
    expect(forecasts).toHaveLength(2);
  });

  it("accepts the legacy single {forecast} shape", () => {
    const { forecasts } = sanitizeForecasts({ forecast: plan("2026-06-23", "A") }, ["2026-06-23"]);
    expect(forecasts).toHaveLength(1);
    expect(forecasts[0].runs[0].brand).toBe("A");
  });

  it("returns an empty list (with note) when nothing is usable", () => {
    const { forecasts, note } = sanitizeForecasts(
      { forecasts: [], note: "not enough history" },
      ["2026-06-23"],
    );
    expect(forecasts).toEqual([]);
    expect(note).toBe("not enough history");
  });
});

describe("buildForecastPrompt multi-day", () => {
  it("lists each forecast day and emits the seasonality section", () => {
    const day = (date: string, cases: number) => ({
      date,
      runs: [{ brand: "A", flavor: "Pep", dieType: "12in", cases, netRunMin: 60 }],
    });
    const multi = input({
      targetDate: "2026-06-23",
      horizonDays: 3,
      history: [
        day("2026-06-01", 100),
        day("2026-06-08", 110),
        day("2026-06-15", 120),
        day("2026-06-22", 130),
      ],
    } as Partial<ForecastInput>);
    const { user } = buildForecastPrompt(multi);
    expect(user).toContain("2026-06-23");
    expect(user).toContain("2026-06-25");
    expect(user.toUpperCase()).toContain("SEASONALITY");
    // The multi-day JSON shape is requested.
    expect(user).toContain('"forecasts"');
    // Still instructs JSON-only output (shared literal the route relies on).
    expect(user).toContain("Return ONLY JSON");
  });
});
