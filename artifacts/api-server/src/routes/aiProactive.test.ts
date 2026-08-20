import { describe, it, expect } from "vitest";
import {
  buildProactivePrompt,
  buildIncidentPatternsSection,
  clampProactiveSettings,
  findLowCaseCorrection,
  isDayActive,
  sanitizeProactiveAlert,
  slugifyKey,
  validateOptimizeBody,
  PROACTIVE_MAX_TITLE_CHARS,
  PROACTIVE_MAX_DETAIL_CHARS,
  PROACTIVE_MAX_KEY_CHARS,
  PROACTIVE_MAX_INCIDENT_PATTERNS,
  PROACTIVE_MAX_PATTERN_HINT_CHARS,
  PROACTIVE_POLL_SECONDS_MIN,
  PROACTIVE_POLL_SECONDS_MAX,
  PROACTIVE_COOLDOWN_SECONDS_MIN,
  PROACTIVE_COOLDOWN_SECONDS_MAX,
  type OptimizeInput,
} from "./aiProactive";
import type { IncidentCluster } from "@workspace/incident-cluster";

function cluster(overrides: Partial<IncidentCluster> = {}): IncidentCluster {
  return {
    theme: "Run (web)",
    rootCauseHypothesis: "Reports cluster on the Run screen.",
    recommendedAction: "Review the Run screen reports together.",
    severity: "medium",
    incidentIds: ["i1", "i2"],
    incidentCount: 2,
    ...overrides,
  };
}

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

describe("sanitizeProactiveAlert — suggestedAction", () => {
  function validAlert(overrides: Record<string, unknown> = {}) {
    return {
      alert: {
        key: "behind-plan",
        category: "run",
        impact: "high",
        title: "Falling behind",
        detail: "Line is running slower than planned.",
        ...overrides,
      },
    };
  }

  it("passes through a valid suggestedAction", () => {
    const out = sanitizeProactiveAlert(
      validAlert({ suggested_action: { skidsCompleted: 12, casesOnCurrentSkid: 3 } }),
    );
    expect(out.alert?.suggestedAction).toEqual({ skidsCompleted: 12, casesOnCurrentSkid: 3 });
  });

  it("drops the action when skidsCompleted is negative but keeps the alert", () => {
    const out = sanitizeProactiveAlert(
      validAlert({ suggested_action: { skidsCompleted: -1, casesOnCurrentSkid: 3 } }),
    );
    expect(out.alert).not.toBeNull();
    expect(out.alert?.suggestedAction).toBeUndefined();
    expect(out.alert?.title).toBe("Falling behind");
  });

  it("drops the action when casesOnCurrentSkid is negative but keeps the alert", () => {
    const out = sanitizeProactiveAlert(
      validAlert({ suggested_action: { skidsCompleted: 5, casesOnCurrentSkid: -2 } }),
    );
    expect(out.alert).not.toBeNull();
    expect(out.alert?.suggestedAction).toBeUndefined();
  });

  it("drops the action when a value is implausibly large but keeps the alert", () => {
    const out = sanitizeProactiveAlert(
      validAlert({ suggested_action: { skidsCompleted: 99999, casesOnCurrentSkid: 0 } }),
    );
    expect(out.alert).not.toBeNull();
    expect(out.alert?.suggestedAction).toBeUndefined();
  });

  it("coerces numeric strings and rounds floats", () => {
    const out = sanitizeProactiveAlert(
      validAlert({ suggested_action: { skidsCompleted: "10", casesOnCurrentSkid: 2.7 } }),
    );
    expect(out.alert?.suggestedAction).toEqual({ skidsCompleted: 10, casesOnCurrentSkid: 3 });
  });

  it("drops the action when fields are non-numeric but keeps the alert", () => {
    const out = sanitizeProactiveAlert(
      validAlert({ suggested_action: { skidsCompleted: "many", casesOnCurrentSkid: 3 } }),
    );
    expect(out.alert).not.toBeNull();
    expect(out.alert?.suggestedAction).toBeUndefined();
  });

  it("alert without suggested_action has no suggestedAction field", () => {
    const out = sanitizeProactiveAlert(validAlert());
    expect(out.alert?.suggestedAction).toBeUndefined();
  });

  it("zero is a valid value for both fields", () => {
    const out = sanitizeProactiveAlert(
      validAlert({ suggested_action: { skidsCompleted: 0, casesOnCurrentSkid: 0 } }),
    );
    expect(out.alert?.suggestedAction).toEqual({ skidsCompleted: 0, casesOnCurrentSkid: 0 });
  });

  it("drops the action when category is not 'run', even if values are valid", () => {
    // A model that attaches a correction to a break or efficiency alert must be ignored.
    const breakAlert = sanitizeProactiveAlert({
      alert: {
        key: "break-window",
        category: "break",
        impact: "medium",
        title: "Take lunch now",
        detail: "Good window opening.",
        suggested_action: { skidsCompleted: 5, casesOnCurrentSkid: 3 },
      },
    });
    expect(breakAlert.alert).not.toBeNull();
    expect(breakAlert.alert?.category).toBe("break");
    expect(breakAlert.alert?.suggestedAction).toBeUndefined();

    const effAlert = sanitizeProactiveAlert({
      alert: {
        key: "stock-expiring",
        category: "efficiency",
        impact: "high",
        title: "Use expiring stock",
        detail: "Mozzarella expires today.",
        suggested_action: { skidsCompleted: 8, casesOnCurrentSkid: 0 },
      },
    });
    expect(effAlert.alert).not.toBeNull();
    expect(effAlert.alert?.category).toBe("efficiency");
    expect(effAlert.alert?.suggestedAction).toBeUndefined();
  });

  it("suppresses a model low-count correction when cased plus on-line progress is not low", () => {
    const input = baseInput({
      runs: [
        {
          ...baseInput().runs[0],
          casesMade: 197,
          casesOnLine: 44,
          plannedPpm: 30,
          netElapsedSec: 74 * 60,
          pizzasPerCase: 10,
          casesPerSkid: 20,
          stoppages: [],
        },
      ],
    });
    const out = sanitizeProactiveAlert(
      validAlert({
        key: "low-case-count",
        suggested_action: { skidsCompleted: 11, casesOnCurrentSkid: 2 },
      }),
      input,
    );
    expect(out.alert).toBeNull();
  });

  it("suppresses a miskeyed low-count alert even when the model omits the action", () => {
    const input = baseInput({
      runs: [
        {
          ...baseInput().runs[0],
          casesMade: 197,
          casesOnLine: 44,
          plannedPpm: 30,
          netElapsedSec: 74 * 60,
          pizzasPerCase: 10,
          casesPerSkid: 20,
          stoppages: [],
        },
      ],
    });
    const out = sanitizeProactiveAlert(
      validAlert({
        key: "behind-plan",
        title: "Case count appears low",
        detail: "The recorded case counter may not have been updated.",
      }),
      input,
    );
    expect(out.alert).toBeNull();
  });

  it("preserves a general behind-target alert when combined production is healthy", () => {
    const input = baseInput({
      runs: [
        {
          ...baseInput().runs[0],
          casesMade: 197,
          casesOnLine: 44,
          plannedPpm: 30,
          netElapsedSec: 74 * 60,
          pizzasPerCase: 10,
          casesPerSkid: 20,
          stoppages: [],
        },
      ],
    });
    const out = sanitizeProactiveAlert(
      validAlert({
        key: "behind-plan",
        title: "Finish time at risk",
        detail: "At the current pace the shift will miss the target finish time.",
      }),
      input,
    );
    expect(out.alert?.key).toBe("behind-plan");
    expect(out.alert?.suggestedAction).toBeUndefined();
  });

  it("replaces model arithmetic with the deterministic cased-only target", () => {
    const input = baseInput({
      runs: [
        {
          ...baseInput().runs[0],
          casesMade: 150,
          casesOnLine: 44,
          plannedPpm: 30,
          netElapsedSec: 74 * 60,
          pizzasPerCase: 10,
          casesPerSkid: 20,
          stoppages: [],
        },
      ],
    });
    const out = sanitizeProactiveAlert(
      validAlert({
        key: "low-case-count",
        suggested_action: { skidsCompleted: 11, casesOnCurrentSkid: 2 },
      }),
      input,
    );
    // 222 implied - 44 still on line = 178 cased target = 8 skids + 18 cases.
    expect(out.alert?.suggestedAction).toEqual({ skidsCompleted: 8, casesOnCurrentSkid: 18 });
  });
});

describe("buildProactivePrompt — suggestedAction guidance", () => {
  it("includes suggested_action in the JSON schema instruction", () => {
    const { user } = buildProactivePrompt(baseInput());
    expect(user).toContain("suggested_action");
    expect(user).toContain("skidsCompleted");
    expect(user).toContain("casesOnCurrentSkid");
  });

  it("instructs model to omit suggested_action for stock and break nudges", () => {
    const { user } = buildProactivePrompt(baseInput());
    expect(user).toMatch(/omit.*suggested_action.*stock.*break|stock.*break.*omit.*suggested_action/i);
  });

  it("instructs model to use plannedPPM (not actualPPM) for the independent throughput signal", () => {
    const { user } = buildProactivePrompt(baseInput());
    expect(user).toContain("pizzasPerCase");
    expect(user).toContain("casesPerSkid");
    // The prompt must use plannedPPM (config-derived, independent of casesMade) not
    // actualPPM (which is derived from casesMade and would be circular).
    expect(user).toMatch(/plannedPPM.*netRunMin.*pizzasPerCase|pizzasPerCase.*plannedPPM/i);
    expect(user).toMatch(/do not use actualPPM/i);
  });

  it("includes pizzasPerCase and casesPerSkid in each run's formatted line", () => {
    const { user } = buildProactivePrompt(baseInput());
    // The run formatter should emit these fields so the model can use them
    expect(user).toContain("pizzasPerCase=");
    expect(user).toContain("casesPerSkid=");
  });

  it("counts on-line work for eligibility but excludes it from the cased correction", () => {
    const input = baseInput({
      runs: [{ ...baseInput().runs[0], casesMade: 197, casesOnLine: 44 }],
    });
    const { user } = buildProactivePrompt(input);
    expect(user).toContain("casesMade=197");
    expect(user).toContain("casesOnLine=44");
    expect(user).toContain("combinedProgress = casesMade + casesOnLine");
    expect(user).toContain("impliedCases - casesOnLine");
    expect(user).toMatch(/MUST NEVER be converted into completed skid output/i);
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

  it("accepts both new casesOnLine data and older payloads that omit it", () => {
    const withWip = baseInput({
      runs: [{ ...baseInput().runs[0], casesOnLine: 44 }],
    });
    const withoutWip = baseInput({
      runs: [{ ...baseInput().runs[0], casesOnLine: undefined }],
    });
    expect(validateOptimizeBody(withWip).ok).toBe(true);
    expect(validateOptimizeBody(withoutWip).ok).toBe(true);
  });
});

describe("findLowCaseCorrection", () => {
  it("does not flag 197 cased plus 44 on-line against 222 implied cases", () => {
    const input = baseInput({
      runs: [
        {
          ...baseInput().runs[0],
          casesMade: 197,
          casesOnLine: 44,
          plannedPpm: 30,
          netElapsedSec: 74 * 60,
          pizzasPerCase: 10,
          casesPerSkid: 20,
          stoppages: [],
        },
      ],
    });
    expect(findLowCaseCorrection(input)).toBeNull();
  });

  it("returns a cased-only correction for a genuine low recorded count", () => {
    const input = baseInput({
      runs: [
        {
          ...baseInput().runs[0],
          casesMade: 150,
          casesOnLine: 44,
          plannedPpm: 30,
          netElapsedSec: 74 * 60,
          pizzasPerCase: 10,
          casesPerSkid: 20,
          stoppages: [],
        },
      ],
    });
    expect(findLowCaseCorrection(input)).toMatchObject({
      impliedCases: 222,
      combinedProgressCases: 194,
      casedTargetCases: 178,
      suggestedAction: { skidsCompleted: 8, casesOnCurrentSkid: 18 },
    });
  });

  it("defaults missing WIP to zero for backward-compatible older payloads", () => {
    const input = baseInput({
      runs: [
        {
          ...baseInput().runs[0],
          casesMade: 197,
          casesOnLine: undefined,
          plannedPpm: 30,
          netElapsedSec: 74 * 60,
          pizzasPerCase: 10,
          casesPerSkid: 20,
          stoppages: [],
        },
      ],
    });
    expect(findLowCaseCorrection(input)?.suggestedAction).toEqual({
      skidsCompleted: 11,
      casesOnCurrentSkid: 2,
    });
  });
});

describe("buildProactivePrompt", () => {
  it("includes the current time, target finish, and run facts", () => {
    const { system, user } = buildProactivePrompt(baseInput());
    expect(system).toMatch(/proactive/i);
    expect(user).toContain("TARGET FINISH TIME: 4:00 PM");
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

  it("folds recurring incident patterns into the prompt as context", () => {
    const { user } = buildProactivePrompt(baseInput(), [], [], [
      cluster({ theme: "Run (web)", incidentCount: 4, severity: "high" }),
    ]);
    expect(user).toContain("RECENT REPORTED ISSUES");
    expect(user).toContain("- [high] Run (web) — reported 4x");
  });

  it("omits the incident-patterns section when there are no recurring patterns", () => {
    const { user } = buildProactivePrompt(baseInput(), [], [], [
      cluster({ incidentCount: 1 }),
    ]);
    expect(user).not.toContain("RECENT REPORTED ISSUES");
  });

  it("omits the incident-patterns section when none are provided", () => {
    const { user } = buildProactivePrompt(baseInput());
    expect(user).not.toContain("RECENT REPORTED ISSUES");
  });
});

describe("buildIncidentPatternsSection", () => {
  it("returns empty string when given no clusters", () => {
    expect(buildIncidentPatternsSection([])).toBe("");
  });

  it("drops one-off (non-recurring) clusters", () => {
    expect(buildIncidentPatternsSection([cluster({ incidentCount: 1 })])).toBe("");
  });

  it("keeps only recurring clusters and formats each as one line", () => {
    const out = buildIncidentPatternsSection([
      cluster({ theme: "Run (web)", incidentCount: 3, severity: "high" }),
      cluster({ theme: "Setup (mobile)", incidentCount: 1 }),
    ]);
    expect(out).toContain("RECENT REPORTED ISSUES");
    expect(out).toContain("- [high] Run (web) — reported 3x: Review the Run screen reports together.");
    expect(out).not.toContain("Setup (mobile)");
  });

  it("falls back to the root-cause hypothesis when no recommended action", () => {
    const out = buildIncidentPatternsSection([
      cluster({ recommendedAction: "", rootCauseHypothesis: "Likely a shared trigger." }),
    ]);
    expect(out).toContain("Likely a shared trigger.");
  });

  it("caps the number of patterns surfaced", () => {
    const many = Array.from({ length: PROACTIVE_MAX_INCIDENT_PATTERNS + 4 }, (_, i) =>
      cluster({ theme: `Screen ${i}`, incidentCount: 2 }),
    );
    const out = buildIncidentPatternsSection(many);
    const lines = out.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(PROACTIVE_MAX_INCIDENT_PATTERNS);
  });

  it("clamps a long hint", () => {
    const long = "x".repeat(PROACTIVE_MAX_PATTERN_HINT_CHARS + 50);
    const out = buildIncidentPatternsSection([cluster({ recommendedAction: long })]);
    const hintLine = out.split("\n").find((l) => l.startsWith("- "))!;
    // line prefix "- [medium] Run (web) — reported 2x: " plus the clamped hint
    expect(hintLine).toContain("x".repeat(PROACTIVE_MAX_PATTERN_HINT_CHARS));
    expect(hintLine).not.toContain("x".repeat(PROACTIVE_MAX_PATTERN_HINT_CHARS + 1));
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
