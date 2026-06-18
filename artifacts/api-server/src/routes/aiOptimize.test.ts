import { describe, it, expect } from "vitest";
import {
  sanitizeAction,
  sanitizeRecommendations,
  validateOptimizeBody,
  MAX_TARGET_CASES,
  MAX_ACTION_LABEL_CHARS,
  MAX_RUNS,
  MAX_RECOMMENDATIONS,
  MAX_TITLE_CHARS,
  MAX_DETAIL_CHARS,
  type OptimizeAction,
} from "./aiOptimize";

// The set of "real" run ids the model's actions are cross-checked against.
const KNOWN = new Set(["run-1", "run-2", "run-3"]);

describe("sanitizeAction — guards", () => {
  it("drops null / undefined / non-object input", () => {
    expect(sanitizeAction(null, KNOWN)).toBeNull();
    expect(sanitizeAction(undefined, KNOWN)).toBeNull();
    expect(sanitizeAction("nope", KNOWN)).toBeNull();
    expect(sanitizeAction(42, KNOWN)).toBeNull();
  });

  it("drops actions whose kind maps to nothing", () => {
    expect(sanitizeAction({ kind: "" }, KNOWN)).toBeNull();
    expect(sanitizeAction({ kind: "delete_everything" }, KNOWN)).toBeNull();
    expect(sanitizeAction({}, KNOWN)).toBeNull();
  });
});

describe("sanitizeAction — set_target_time (HH:MM validation)", () => {
  it("accepts a valid 24h time and supplies a default label", () => {
    expect(sanitizeAction({ kind: "set_target_time", time: "14:30" }, KNOWN)).toEqual({
      kind: "set_target_time",
      label: "Set finish time to 14:30",
      time: "14:30",
    });
  });

  it("accepts the boundary times 00:00 and 23:59", () => {
    expect(
      (sanitizeAction({ kind: "set_target_time", time: "00:00" }, KNOWN) as OptimizeAction).time,
    ).toBe("00:00");
    expect(
      (sanitizeAction({ kind: "set_target_time", time: "23:59" }, KNOWN) as OptimizeAction).time,
    ).toBe("23:59");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(
      (sanitizeAction({ kind: "set_target_time", time: "  09:05 " }, KNOWN) as OptimizeAction).time,
    ).toBe("09:05");
  });

  it("rejects out-of-range, unpadded, malformed, or missing times", () => {
    for (const time of ["24:00", "12:60", "9:30", "1430", "07:5", "", "noon", "07:60"]) {
      expect(sanitizeAction({ kind: "set_target_time", time }, KNOWN)).toBeNull();
    }
    expect(sanitizeAction({ kind: "set_target_time" }, KNOWN)).toBeNull();
  });

  it("uses a provided label and clamps it to the max length", () => {
    expect(
      (sanitizeAction(
        { kind: "set_target_time", time: "08:00", label: "Wrap by 8am" },
        KNOWN,
      ) as OptimizeAction).label,
    ).toBe("Wrap by 8am");

    const long = "x".repeat(MAX_ACTION_LABEL_CHARS + 50);
    const clamped = (sanitizeAction(
      { kind: "set_target_time", time: "08:00", label: long },
      KNOWN,
    ) as OptimizeAction).label;
    expect(clamped.length).toBe(MAX_ACTION_LABEL_CHARS);
  });
});

describe("sanitizeAction — set_run_target (run id + case bounds)", () => {
  it("accepts a known run id with a positive case target", () => {
    expect(
      sanitizeAction({ kind: "set_run_target", runId: "run-2", casesNeeded: 480 }, KNOWN),
    ).toEqual({
      kind: "set_run_target",
      label: "Set target to 480 cases",
      runId: "run-2",
      casesNeeded: 480,
    });
  });

  it("rounds fractional case targets to the nearest integer", () => {
    expect(
      (sanitizeAction(
        { kind: "set_run_target", runId: "run-1", casesNeeded: 12.4 },
        KNOWN,
      ) as OptimizeAction).casesNeeded,
    ).toBe(12);
    expect(
      (sanitizeAction(
        { kind: "set_run_target", runId: "run-1", casesNeeded: 12.6 },
        KNOWN,
      ) as OptimizeAction).casesNeeded,
    ).toBe(13);
  });

  it("rejects unknown or missing run ids", () => {
    expect(
      sanitizeAction({ kind: "set_run_target", runId: "ghost", casesNeeded: 10 }, KNOWN),
    ).toBeNull();
    expect(sanitizeAction({ kind: "set_run_target", casesNeeded: 10 }, KNOWN)).toBeNull();
  });

  it("rejects non-numeric case targets", () => {
    expect(
      sanitizeAction({ kind: "set_run_target", runId: "run-1", casesNeeded: "lots" }, KNOWN),
    ).toBeNull();
    expect(sanitizeAction({ kind: "set_run_target", runId: "run-1" }, KNOWN)).toBeNull();
    expect(
      sanitizeAction(
        { kind: "set_run_target", runId: "run-1", casesNeeded: Number.NaN },
        KNOWN,
      ),
    ).toBeNull();
  });

  it("rejects out-of-bounds case targets (<= 0 or above the cap)", () => {
    expect(
      sanitizeAction({ kind: "set_run_target", runId: "run-1", casesNeeded: 0 }, KNOWN),
    ).toBeNull();
    expect(
      sanitizeAction({ kind: "set_run_target", runId: "run-1", casesNeeded: -5 }, KNOWN),
    ).toBeNull();
    expect(
      sanitizeAction(
        { kind: "set_run_target", runId: "run-1", casesNeeded: MAX_TARGET_CASES + 1 },
        KNOWN,
      ),
    ).toBeNull();
  });

  it("accepts a case target exactly at the cap", () => {
    expect(
      (sanitizeAction(
        { kind: "set_run_target", runId: "run-1", casesNeeded: MAX_TARGET_CASES },
        KNOWN,
      ) as OptimizeAction).casesNeeded,
    ).toBe(MAX_TARGET_CASES);
  });
});

describe("sanitizeAction — reorder_run (run id cross-checks)", () => {
  it("accepts a known run moved to last (beforeRunId null)", () => {
    expect(sanitizeAction({ kind: "reorder_run", runId: "run-1", beforeRunId: null }, KNOWN)).toEqual({
      kind: "reorder_run",
      label: "Reorder run",
      runId: "run-1",
      beforeRunId: null,
    });
  });

  it("treats a missing beforeRunId as 'move last'", () => {
    expect(
      (sanitizeAction({ kind: "reorder_run", runId: "run-1" }, KNOWN) as OptimizeAction).beforeRunId,
    ).toBeNull();
  });

  it("accepts a known run moved before another known run", () => {
    expect(
      sanitizeAction({ kind: "reorder_run", runId: "run-3", beforeRunId: "run-1" }, KNOWN),
    ).toEqual({
      kind: "reorder_run",
      label: "Reorder run",
      runId: "run-3",
      beforeRunId: "run-1",
    });
  });

  it("rejects unknown runId or unknown beforeRunId", () => {
    expect(
      sanitizeAction({ kind: "reorder_run", runId: "ghost", beforeRunId: "run-1" }, KNOWN),
    ).toBeNull();
    expect(
      sanitizeAction({ kind: "reorder_run", runId: "run-1", beforeRunId: "ghost" }, KNOWN),
    ).toBeNull();
    expect(sanitizeAction({ kind: "reorder_run" }, KNOWN)).toBeNull();
  });

  it("rejects moving a run before itself", () => {
    expect(
      sanitizeAction({ kind: "reorder_run", runId: "run-2", beforeRunId: "run-2" }, KNOWN),
    ).toBeNull();
  });
});

describe("sanitizeAction — action kind mapping", () => {
  it("maps the canonical kind aliases for set_target_time", () => {
    for (const kind of ["set_target_time", "set_finish_time", "target_time"]) {
      expect(sanitizeAction({ kind, time: "10:00" }, KNOWN)?.kind).toBe("set_target_time");
    }
  });

  it("maps the canonical kind aliases for set_run_target", () => {
    for (const kind of ["set_run_target", "set_cases", "bump_target"]) {
      expect(
        sanitizeAction({ kind, runId: "run-1", casesNeeded: 5 }, KNOWN)?.kind,
      ).toBe("set_run_target");
    }
  });

  it("maps the canonical kind aliases for reorder_run", () => {
    for (const kind of ["reorder_run", "move_run", "reorder"]) {
      expect(
        sanitizeAction({ kind, runId: "run-1", beforeRunId: null }, KNOWN)?.kind,
      ).toBe("reorder_run");
    }
  });

  it("normalizes spaces and hyphens in the kind", () => {
    expect(
      sanitizeAction({ kind: "Set-Run Target", runId: "run-1", casesNeeded: 5 }, KNOWN)?.kind,
    ).toBe("set_run_target");
  });

  it("uses fuzzy fallbacks, with 'time'/'finish' winning over 'target'", () => {
    expect(sanitizeAction({ kind: "adjust finish time", time: "10:00" }, KNOWN)?.kind).toBe(
      "set_target_time",
    );
    expect(
      sanitizeAction({ kind: "resequence the line", runId: "run-1" }, KNOWN)?.kind,
    ).toBe("reorder_run");
    expect(
      sanitizeAction({ kind: "more cases please", runId: "run-1", casesNeeded: 5 }, KNOWN)?.kind,
    ).toBe("set_run_target");
  });
});

describe("sanitizeRecommendations — action wiring", () => {
  it("keeps the card but nulls a hallucinated-run action", () => {
    const out = sanitizeRecommendations(
      {
        recommendations: [
          {
            category: "run",
            title: "Bump run target",
            detail: "We are behind plan; raise the target.",
            impact: "high",
            action: { kind: "set_run_target", runId: "ghost", casesNeeded: 10 },
          },
        ],
      },
      KNOWN,
    );
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0]?.action).toBeNull();
  });

  it("passes a valid action through with the run id cross-check", () => {
    const out = sanitizeRecommendations(
      {
        recommendations: [
          {
            category: "run",
            title: "Bump run target",
            detail: "We are behind plan; raise the target.",
            impact: "high",
            action: { kind: "set_run_target", runId: "run-1", casesNeeded: 200 },
          },
        ],
      },
      KNOWN,
    );
    expect(out.recommendations[0]?.action).toEqual({
      kind: "set_run_target",
      label: "Set target to 200 cases",
      runId: "run-1",
      casesNeeded: 200,
    });
  });

  it("defaults knownRunIds to empty, dropping every run-targeted action", () => {
    const out = sanitizeRecommendations({
      recommendations: [
        {
          category: "run",
          title: "Reorder run",
          detail: "Move the slow run later.",
          impact: "medium",
          action: { kind: "reorder_run", runId: "run-1", beforeRunId: null },
        },
      ],
    });
    expect(out.recommendations[0]?.action).toBeNull();
  });
});

// A minimal run object that satisfies the AiOptimizeBody run schema.
function makeRun(id: string) {
  return {
    id,
    label: `Run ${id}`,
    brand: "Brand",
    flavor: "Cheese",
    dieType: "12in",
    status: "running" as const,
    casesNeeded: 100,
    casesMade: 10,
    casesLeft: 90,
    plannedPpm: 60,
    actualPpm: 55,
    minutesRemaining: 30,
    netElapsedSec: 600,
    downtimeSec: 0,
    stoppages: [],
  };
}

function makeScheduledRun(date: string) {
  return {
    date,
    brand: "Brand",
    flavor: "Pepperoni",
    dieType: "12in",
    casesNeeded: 200,
  };
}

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-06-18",
    nowMs: 1_750_000_000_000,
    runs: [makeRun("run-1")],
    ...overrides,
  };
}

describe("validateOptimizeBody — happy path", () => {
  it("accepts a well-formed body and returns the parsed data", () => {
    const body = makeBody({
      runToTime: "16:00",
      todayPpm: 58,
      benchmarkPpm: 60,
      scheduledRuns: [makeScheduledRun("2026-06-19")],
      historyRuns: [makeRun("hist-1")],
    });
    const result = validateOptimizeBody(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.runs).toHaveLength(1);
      expect(result.data.scheduledRuns).toHaveLength(1);
      expect(result.data.historyRuns).toHaveLength(1);
      expect(result.data.date).toBe("2026-06-18");
    }
  });

  it("accepts a body with only the required fields", () => {
    const result = validateOptimizeBody(makeBody());
    expect(result.ok).toBe(true);
  });
});

describe("validateOptimizeBody — MAX_RUNS cap", () => {
  it("accepts a body exactly at the run cap (counting all three lists)", () => {
    const runs = Array.from({ length: 100 }, (_, i) => makeRun(`run-${i}`));
    const scheduledRuns = Array.from({ length: 50 }, (_, i) =>
      makeScheduledRun(`2026-07-${(i % 28) + 1}`),
    );
    const historyRuns = Array.from({ length: 50 }, (_, i) => makeRun(`hist-${i}`));
    expect(runs.length + scheduledRuns.length + historyRuns.length).toBe(MAX_RUNS);
    const result = validateOptimizeBody(makeBody({ runs, scheduledRuns, historyRuns }));
    expect(result.ok).toBe(true);
  });

  it("rejects when runs + scheduledRuns + historyRuns exceeds MAX_RUNS", () => {
    const runs = Array.from({ length: 100 }, (_, i) => makeRun(`run-${i}`));
    const scheduledRuns = Array.from({ length: 60 }, (_, i) =>
      makeScheduledRun(`2026-07-${(i % 28) + 1}`),
    );
    const historyRuns = Array.from({ length: 41 }, (_, i) => makeRun(`hist-${i}`));
    expect(runs.length + scheduledRuns.length + historyRuns.length).toBeGreaterThan(MAX_RUNS);
    const result = validateOptimizeBody(makeBody({ runs, scheduledRuns, historyRuns }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain(String(MAX_RUNS));
    }
  });

  it("counts each list toward the cap (overflow from a single list)", () => {
    const runs = Array.from({ length: MAX_RUNS + 1 }, (_, i) => makeRun(`run-${i}`));
    const result = validateOptimizeBody(makeBody({ runs }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("validateOptimizeBody — schema rejection", () => {
  it("rejects a body missing required fields with status 400", () => {
    const result = validateOptimizeBody({ date: "2026-06-18" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a non-object body with status 400", () => {
    for (const bad of [null, undefined, 42, "nope", []]) {
      const result = validateOptimizeBody(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
  });

  it("rejects a run with an invalid status enum with status 400", () => {
    const result = validateOptimizeBody(
      makeBody({ runs: [{ ...makeRun("run-1"), status: "paused" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a run with a wrong-typed field with status 400", () => {
    const result = validateOptimizeBody(
      makeBody({ runs: [{ ...makeRun("run-1"), casesNeeded: "lots" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("sanitizeRecommendations — top-level shape", () => {
  it("collapses to [] when the top-level shape is wrong", () => {
    expect(sanitizeRecommendations(null).recommendations).toEqual([]);
    expect(sanitizeRecommendations(42).recommendations).toEqual([]);
    expect(sanitizeRecommendations("nope").recommendations).toEqual([]);
    expect(sanitizeRecommendations({ recommendations: "not-an-array" }).recommendations).toEqual([]);
  });

  it("returns [] (no note key) when recommendations is absent", () => {
    const out = sanitizeRecommendations({});
    expect(out.recommendations).toEqual([]);
    expect(out.note).toBeUndefined();
  });
});

describe("sanitizeRecommendations — card field guards", () => {
  it("drops cards missing a title or detail", () => {
    const out = sanitizeRecommendations({
      recommendations: [
        { category: "run", title: "", detail: "has detail", impact: "high" },
        { category: "run", title: "has title", detail: "", impact: "high" },
        { category: "run", title: "   ", detail: "whitespace title", impact: "high" },
        { category: "run", detail: "no title key", impact: "high" },
        { category: "run", title: "no detail key", impact: "high" },
      ],
    });
    expect(out.recommendations).toEqual([]);
  });

  it("keeps a card that has both a title and a detail", () => {
    const out = sanitizeRecommendations({
      recommendations: [
        { category: "run", title: "Keep me", detail: "I am valid", impact: "high" },
      ],
    });
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0]?.title).toBe("Keep me");
  });

  it("trims title/detail and nulls a blank appliesTo", () => {
    const out = sanitizeRecommendations({
      recommendations: [
        {
          category: "run",
          title: "  Padded title  ",
          detail: "  Padded detail  ",
          impact: "high",
          appliesTo: "   ",
        },
      ],
    });
    expect(out.recommendations[0]?.title).toBe("Padded title");
    expect(out.recommendations[0]?.detail).toBe("Padded detail");
    expect(out.recommendations[0]?.appliesTo).toBeNull();
  });
});

describe("sanitizeRecommendations — length clamping", () => {
  it("clamps title and detail to their max lengths", () => {
    const out = sanitizeRecommendations({
      recommendations: [
        {
          category: "run",
          title: "t".repeat(MAX_TITLE_CHARS + 50),
          detail: "d".repeat(MAX_DETAIL_CHARS + 50),
          impact: "high",
        },
      ],
    });
    expect(out.recommendations[0]?.title.length).toBe(MAX_TITLE_CHARS);
    expect(out.recommendations[0]?.detail.length).toBe(MAX_DETAIL_CHARS);
  });

  it("clamps appliesTo to the title max length", () => {
    const out = sanitizeRecommendations({
      recommendations: [
        {
          category: "run",
          title: "Valid",
          detail: "Valid detail",
          impact: "high",
          appliesTo: "a".repeat(MAX_TITLE_CHARS + 50),
        },
      ],
    });
    expect(out.recommendations[0]?.appliesTo?.length).toBe(MAX_TITLE_CHARS);
  });

  it("clamps the top-level note to the detail max length", () => {
    const out = sanitizeRecommendations({
      recommendations: [],
      note: "n".repeat(MAX_DETAIL_CHARS + 50),
    });
    expect(out.note?.length).toBe(MAX_DETAIL_CHARS);
  });

  it("omits the note key when the note is blank", () => {
    const out = sanitizeRecommendations({ recommendations: [], note: "   " });
    expect(out.note).toBeUndefined();
  });
});

describe("sanitizeRecommendations — MAX_RECOMMENDATIONS cap", () => {
  it("caps the returned list at MAX_RECOMMENDATIONS", () => {
    const recommendations = Array.from({ length: MAX_RECOMMENDATIONS + 5 }, (_, i) => ({
      category: "run",
      title: `Card ${i}`,
      detail: `Detail ${i}`,
      impact: "medium",
    }));
    const out = sanitizeRecommendations({ recommendations });
    expect(out.recommendations).toHaveLength(MAX_RECOMMENDATIONS);
  });
});

describe("sanitizeRecommendations — category/impact mapping", () => {
  it("maps known and prefixed categories to the allowed enums", () => {
    const cases: Array<[string, string]> = [
      ["break", "break"],
      ["breaks", "break"],
      ["efficiency", "efficiency"],
      ["eff", "efficiency"],
      ["app insight", "efficiency"],
      ["insight", "efficiency"],
      ["run", "run"],
    ];
    for (const [input, expected] of cases) {
      const out = sanitizeRecommendations({
        recommendations: [
          { category: input, title: "T", detail: "D", impact: "high" },
        ],
      });
      expect(out.recommendations[0]?.category).toBe(expected);
    }
  });

  it("falls back to 'run' for unknown or missing categories", () => {
    const out = sanitizeRecommendations({
      recommendations: [
        { category: "nonsense", title: "T1", detail: "D1", impact: "high" },
        { title: "T2", detail: "D2", impact: "high" },
      ],
    });
    expect(out.recommendations[0]?.category).toBe("run");
    expect(out.recommendations[1]?.category).toBe("run");
  });

  it("maps high/low and falls back to 'medium' for unknown or missing impact", () => {
    const cases: Array<[unknown, string]> = [
      ["high", "high"],
      ["HIGH", "high"],
      ["low", "low"],
      ["medium", "medium"],
      ["whatever", "medium"],
      [undefined, "medium"],
    ];
    for (const [input, expected] of cases) {
      const out = sanitizeRecommendations({
        recommendations: [
          { category: "run", title: "T", detail: "D", impact: input },
        ],
      });
      expect(out.recommendations[0]?.impact).toBe(expected);
    }
  });
});
