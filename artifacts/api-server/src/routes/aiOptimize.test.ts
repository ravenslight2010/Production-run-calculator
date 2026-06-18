import { describe, it, expect } from "vitest";
import {
  sanitizeAction,
  sanitizeRecommendations,
  MAX_TARGET_CASES,
  MAX_ACTION_LABEL_CHARS,
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
