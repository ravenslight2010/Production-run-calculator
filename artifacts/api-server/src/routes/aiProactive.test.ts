import { describe, it, expect } from "vitest";
import {
  buildProactivePrompt,
  sanitizeProactiveAlert,
  slugifyKey,
  validateOptimizeBody,
  PROACTIVE_MAX_TITLE_CHARS,
  PROACTIVE_MAX_DETAIL_CHARS,
  PROACTIVE_MAX_KEY_CHARS,
  type OptimizeInput,
} from "./aiProactive";

function baseInput(overrides: Partial<OptimizeInput> = {}): OptimizeInput {
  return {
    date: "2026-06-21",
    nowMs: Date.UTC(2026, 5, 21, 14, 30),
    runToTime: "16:00",
    todayPpm: 90,
    benchmarkPpm: 100,
    runs: [
      {
        id: "run-1",
        label: "Run 1",
        brand: "Acme",
        flavor: "Cheese",
        dieType: "12in",
        status: "running",
        casesNeeded: 500,
        casesMade: 100,
        casesLeft: 400,
        plannedPpm: 120,
        actualPpm: 80,
        minutesRemaining: 200,
        netElapsedSec: 3600,
        downtimeSec: 600,
        stoppages: [{ reason: "Jam", durationSec: 600, open: false }],
      },
    ],
    scheduledRuns: [],
    historyRuns: [],
    ...overrides,
  } as OptimizeInput;
}

describe("slugifyKey", () => {
  it("normalizes free text into a stable lowercase slug", () => {
    expect(slugifyKey("Behind Plan!", "run")).toBe("behind-plan");
    expect(slugifyKey("  Break / Changeover  ", "break")).toBe("break-changeover");
    expect(slugifyKey("downtime_spike", "efficiency")).toBe("downtime-spike");
  });

  it("falls back to the category when nothing usable is provided", () => {
    expect(slugifyKey("", "run")).toBe("run");
    expect(slugifyKey("   ", "break")).toBe("break");
    expect(slugifyKey("!!!", "efficiency")).toBe("efficiency");
    expect(slugifyKey(undefined, "run")).toBe("run");
  });

  it("clamps overly long keys", () => {
    const long = "x".repeat(200);
    expect(slugifyKey(long, "run").length).toBeLessThanOrEqual(PROACTIVE_MAX_KEY_CHARS);
  });
});

describe("sanitizeProactiveAlert — guards", () => {
  it("returns no alert for malformed top-level input", () => {
    expect(sanitizeProactiveAlert(null)).toEqual({ alert: null });
    expect(sanitizeProactiveAlert(42)).toEqual({ alert: null });
    expect(sanitizeProactiveAlert("nope")).toEqual({ alert: null });
  });

  it("treats a missing or null alert as 'nothing to surface'", () => {
    expect(sanitizeProactiveAlert({})).toEqual({ alert: null });
    expect(sanitizeProactiveAlert({ alert: null })).toEqual({ alert: null });
  });

  it("preserves a note even when there is no alert", () => {
    expect(sanitizeProactiveAlert({ alert: null, note: "all on pace" })).toEqual({
      alert: null,
      note: "all on pace",
    });
  });

  it("drops an alert missing a title or detail", () => {
    expect(sanitizeProactiveAlert({ alert: { title: "Behind", detail: "" } })).toEqual({
      alert: null,
    });
    expect(sanitizeProactiveAlert({ alert: { title: "", detail: "Catch up" } })).toEqual({
      alert: null,
    });
  });
});

describe("sanitizeProactiveAlert — normalization", () => {
  it("maps category/impact and derives a key", () => {
    expect(
      sanitizeProactiveAlert({
        alert: {
          key: "Behind Plan",
          category: "break",
          impact: "high",
          title: "Take lunch now",
          detail: "Changeover window is open for ~15 min.",
        },
      }),
    ).toEqual({
      alert: {
        key: "behind-plan",
        category: "break",
        impact: "high",
        title: "Take lunch now",
        detail: "Changeover window is open for ~15 min.",
      },
    });
  });

  it("defaults the key to the category when none is given", () => {
    const out = sanitizeProactiveAlert({
      alert: { category: "efficiency", title: "Slow", detail: "PPM is below benchmark." },
    });
    expect(out.alert?.key).toBe("efficiency");
  });

  it("falls back to run/medium for unknown enums", () => {
    const out = sanitizeProactiveAlert({
      alert: { category: "weird", impact: "huge", title: "T", detail: "D" },
    });
    expect(out.alert?.category).toBe("run");
    expect(out.alert?.impact).toBe("medium");
  });

  it("clamps overly long title and detail", () => {
    const out = sanitizeProactiveAlert({
      alert: {
        title: "t".repeat(500),
        detail: "d".repeat(2000),
      },
    });
    expect(out.alert?.title.length).toBeLessThanOrEqual(PROACTIVE_MAX_TITLE_CHARS);
    expect(out.alert?.detail.length).toBeLessThanOrEqual(PROACTIVE_MAX_DETAIL_CHARS);
  });

  it("coerces non-string fields leniently", () => {
    const out = sanitizeProactiveAlert({
      alert: { key: 12, title: 5, detail: 9, category: 1, impact: 2 },
    });
    expect(out.alert).not.toBeNull();
    expect(typeof out.alert?.title).toBe("string");
  });
});

describe("validateOptimizeBody (reused by /ai/proactive-alert)", () => {
  it("accepts a valid live-day body", () => {
    const result = validateOptimizeBody(baseInput());
    expect(result.ok).toBe(true);
  });

  it("rejects a body with no runs array", () => {
    const result = validateOptimizeBody({ date: "2026-06-21", nowMs: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("buildProactivePrompt", () => {
  it("includes the current time, target finish, and run facts", () => {
    const { system, user } = buildProactivePrompt(baseInput());
    expect(system).toMatch(/proactive/i);
    expect(user).toContain("TARGET FINISH TIME: 16:00");
    expect(user).toContain('label="Run 1"');
    expect(user).toContain("casesLeft=400");
    expect(user).toContain("stoppages=[Jam(10m)]");
  });

  it("asks for a single nullable alert with a stable key", () => {
    const { user } = buildProactivePrompt(baseInput());
    expect(user).toContain('"alert"');
    expect(user).toMatch(/null/);
    expect(user).toMatch(/stable lowercase slug/i);
  });

  it("renders (none) when there are no runs", () => {
    const { user } = buildProactivePrompt(baseInput({ runs: [] }));
    expect(user).toContain("(none)");
  });
});
