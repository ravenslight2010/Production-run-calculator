import { describe, it, expect } from "vitest";
import {
  buildProactivePrompt,
  clampProactiveSettings,
  isDayActive,
  sanitizeProactiveAlert,
  slugifyKey,
  validateOptimizeBody,
  PROACTIVE_MAX_TITLE_CHARS,
  PROACTIVE_MAX_DETAIL_CHARS,
  PROACTIVE_MAX_KEY_CHARS,
  PROACTIVE_POLL_SECONDS_MIN,
  PROACTIVE_POLL_SECONDS_MAX,
  PROACTIVE_COOLDOWN_SECONDS_MIN,
  PROACTIVE_COOLDOWN_SECONDS_MAX,
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

describe("clampProactiveSettings", () => {
  it("passes through in-range values, rounding to integers", () => {
    expect(
      clampProactiveSettings({ enabled: true, pollSeconds: 240, cooldownSeconds: 1800 }),
    ).toEqual({ enabled: true, pollSeconds: 240, cooldownSeconds: 1800 });
    expect(
      clampProactiveSettings({ enabled: false, pollSeconds: 120.6, cooldownSeconds: 600.4 }),
    ).toEqual({ enabled: false, pollSeconds: 121, cooldownSeconds: 600 });
  });

  it("clamps the poll cadence into its bounds", () => {
    expect(
      clampProactiveSettings({ enabled: true, pollSeconds: 1, cooldownSeconds: 1800 }).pollSeconds,
    ).toBe(PROACTIVE_POLL_SECONDS_MIN);
    expect(
      clampProactiveSettings({ enabled: true, pollSeconds: 999999, cooldownSeconds: 1800 })
        .pollSeconds,
    ).toBe(PROACTIVE_POLL_SECONDS_MAX);
  });

  it("clamps the cooldown into its bounds (0 allowed)", () => {
    expect(
      clampProactiveSettings({ enabled: true, pollSeconds: 240, cooldownSeconds: -50 })
        .cooldownSeconds,
    ).toBe(PROACTIVE_COOLDOWN_SECONDS_MIN);
    expect(
      clampProactiveSettings({ enabled: true, pollSeconds: 240, cooldownSeconds: 999999 })
        .cooldownSeconds,
    ).toBe(PROACTIVE_COOLDOWN_SECONDS_MAX);
  });

  it("preserves the enabled flag verbatim", () => {
    expect(
      clampProactiveSettings({ enabled: false, pollSeconds: 240, cooldownSeconds: 1800 }).enabled,
    ).toBe(false);
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

  it("renders an empty at-risk stock section by default", () => {
    const { system, user } = buildProactivePrompt(baseInput());
    expect(user).toContain("AT-RISK STOCK (expired or expiring soon):");
    expect(user).toMatch(/AT-RISK STOCK[^]*\(none\)/);
    // The watcher must be told a stock nudge is a valid kind of alert.
    expect(system).toMatch(/expir/i);
    expect(user).toContain("stock-expiring");
  });

  it("lists flagged at-risk stock with quantity and expiry timing", () => {
    const { user } = buildProactivePrompt(baseInput(), [
      {
        key: "mozz",
        name: "Mozzarella",
        category: "Cheese",
        unit: "lb",
        status: "soon",
        qtyAtRisk: 120,
        earliestExpiration: "2026-06-23",
        daysUntilExpiry: 2,
      },
      {
        key: "sauce",
        name: "Marinara",
        category: "Sauce",
        unit: "gal",
        status: "expired",
        qtyAtRisk: 8,
        earliestExpiration: "2026-06-19",
        daysUntilExpiry: -2,
      },
    ]);
    expect(user).toContain("- Mozzarella [Cheese] — 120 lb at risk, expires in 2d (2026-06-23)");
    expect(user).toContain("- Marinara [Sauce] — 8 gal at risk, expired 2d ago (2026-06-19)");
  });

  it("renders an empty low-stock section by default", () => {
    const { system, user } = buildProactivePrompt(baseInput());
    expect(user).toContain("LOW STOCK (at or below reorder point — reorder now):");
    expect(user).toMatch(/LOW STOCK[^]*\(none\)/);
    // The watcher must be told a reorder nudge is a valid kind of alert.
    expect(system).toMatch(/reorder point/i);
    expect(user).toContain("reorder-now");
  });

  it("lists low-stock items with on-hand, reorder point and suggested order qty", () => {
    const { user } = buildProactivePrompt(baseInput(), [], [
      {
        key: "pep",
        name: "Pepperoni",
        category: "ingredient",
        unit: "lb",
        onHand: 5,
        reorderThreshold: 20,
        demand: 0,
        projectedOnHand: 5,
        suggestedQty: 15,
      },
      {
        key: "box",
        name: "12in Box",
        category: "packaging",
        unit: "ea",
        onHand: 0,
        reorderThreshold: 100,
        demand: 0,
        projectedOnHand: 0,
        suggestedQty: 100,
      },
    ]);
    expect(user).toContain(
      "- Pepperoni [ingredient] — 5 lb on hand (reorder point 20), suggest ordering 15 lb",
    );
    expect(user).toContain(
      "- 12in Box [packaging] — 0 ea on hand (reorder point 100), suggest ordering 100 ea",
    );
  });

  it("allows all four nudge kinds while a run is active", () => {
    const { system } = buildProactivePrompt(baseInput());
    expect(system).toMatch(/shift is currently in progress/i);
    expect(system).toMatch(/falling behind/i);
    expect(system).toMatch(/break or changeover/i);
    expect(system).toMatch(/expir/i);
    expect(system).toMatch(/reorder point/i);
  });

  it("restricts to stock-only nudges when the day is idle (no run started)", () => {
    const { system, user } = buildProactivePrompt(
      baseInput({ runs: [{ ...baseInput().runs[0], status: "upcoming" }] }),
    );
    expect(system).toMatch(/the day is idle/i);
    expect(system).toMatch(/never raise a behind-plan or break/i);
    expect(system).toMatch(/at-risk-stock/i);
    // The watcher may still raise a reorder nudge on an idle day.
    expect(system).toMatch(/reorder point/i);
    // The stock sections + JSON contract are still present so a stock nudge can
    // still be emitted on an idle day.
    expect(user).toContain("AT-RISK STOCK (expired or expiring soon):");
    expect(user).toContain("stock-expiring");
    expect(user).toContain("LOW STOCK (at or below reorder point — reorder now):");
    expect(user).toContain("reorder-now");
  });
});

describe("isDayActive", () => {
  it("is true when at least one run is running", () => {
    expect(isDayActive(baseInput())).toBe(true);
  });

  it("is false when there are no runs", () => {
    expect(isDayActive(baseInput({ runs: [] }))).toBe(false);
  });

  it("is false when every run is upcoming or finished", () => {
    const r = baseInput().runs[0];
    expect(
      isDayActive(
        baseInput({
          runs: [
            { ...r, id: "a", status: "upcoming" },
            { ...r, id: "b", status: "finished" },
          ],
        }),
      ),
    ).toBe(false);
  });
});
