import { describe, it, expect } from "vitest";
import {
  validateCommandBody,
  sanitizeCommand,
  MAX_UTTERANCE_CHARS,
  MAX_COMMAND_ACTIONS,
  MAX_TARGET_CASES,
  MAX_QTY,
  type CommandGrounding,
} from "./aiCommand";
import type { OptimizeInput } from "./aiOptimize";

// A minimal but valid day-state that validateOptimizeBody accepts, so we can
// exercise the command envelope around it.
function dayState(): OptimizeInput {
  return {
    date: "2026-06-21",
    nowMs: 1_750_000_000_000,
    runs: [
      {
        id: "run-1",
        label: "Run run-1",
        brand: "Brand",
        flavor: "Cheese",
        dieType: "12in",
        status: "running",
        casesNeeded: 100,
        casesMade: 10,
        casesLeft: 90,
        plannedPpm: 60,
        actualPpm: 55,
        minutesRemaining: 30,
        netElapsedSec: 600,
        downtimeSec: 0,
        stoppages: [],
      },
    ],
  } as unknown as OptimizeInput;
}

// A grounding with two known runs and two known inventory items, so resolution
// of fuzzy references and the "drop hallucinated ids" rule can be tested.
function grounding(): CommandGrounding {
  return {
    runs: new Map([
      ["r1", { label: "Run 1", brand: "DiGiorno", flavor: "Pepperoni" }],
      ["r2", { label: "Run 2", brand: "Tombstone", flavor: "Cheese" }],
    ]),
    inventoryByKey: new Map([
      ["cheese:mozz", { id: 10, category: "cheese", name: "Mozzarella", unit: "lbs" }],
    ]),
    inventoryById: new Map([[10, { key: "cheese:mozz", name: "Mozzarella", unit: "lbs" }]]),
  };
}

describe("validateCommandBody", () => {
  it("accepts a well-formed body and trims the utterance", () => {
    const res = validateCommandBody({ utterance: "  set finish to 2pm  ", dayState: dayState() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.utterance).toBe("set finish to 2pm");
  });

  it("rejects an empty/whitespace utterance", () => {
    const res = validateCommandBody({ utterance: "   ", dayState: dayState() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it("rejects an over-long utterance", () => {
    const res = validateCommandBody({
      utterance: "x".repeat(MAX_UTTERANCE_CHARS + 1),
      dayState: dayState(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it("rejects a malformed body", () => {
    const res = validateCommandBody({ nope: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
});

describe("sanitizeCommand — classification", () => {
  const g = grounding();

  it("routes a question to the unchanged ask flow", () => {
    expect(sanitizeCommand('{"type":"question"}', g)).toEqual({ type: "question" });
  });

  it("collapses unparseable JSON to none", () => {
    expect(sanitizeCommand("not json", g)).toEqual({
      type: "none",
      note: "I didn't catch that.",
    });
  });

  it("collapses empty content to none", () => {
    expect(sanitizeCommand("   ", g)).toEqual({ type: "none", note: "I didn't catch that." });
  });

  it("collapses a shapeless response to none", () => {
    expect(sanitizeCommand("[1,2,3]", g)).toEqual({
      type: "none",
      note: "I didn't catch that.",
    });
  });

  it("returns none with the model note when a command has no surviving actions", () => {
    const out = sanitizeCommand(
      JSON.stringify({ type: "command", note: "Couldn't find that run", actions: [] }),
      g,
    );
    expect(out.type).toBe("none");
    if (out.type === "none") expect(out.note).toBe("Couldn't find that run");
  });
});

describe("sanitizeCommand — action resolution & grounding", () => {
  const g = grounding();

  it("resolves a valid run-targeted action and attaches a friendly label", () => {
    const out = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "set_run_target", runId: "r1", casesNeeded: 50 }],
      }),
      g,
    );
    expect(out.type).toBe("command");
    if (out.type === "command") {
      expect(out.actions).toHaveLength(1);
      const a = out.actions[0];
      expect(a.kind).toBe("set_run_target");
      if (a.kind === "set_run_target") {
        expect(a.runId).toBe("r1");
        expect(a.casesNeeded).toBe(50);
        expect(a.label).toContain("DiGiorno");
      }
    }
  });

  it("drops an action that references a hallucinated run id", () => {
    const out = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "set_run_target", runId: "ghost", casesNeeded: 50 }],
      }),
      g,
    );
    expect(out.type).toBe("none");
  });

  it("drops a restock for an unknown item key but fills metadata from the resolved item", () => {
    const bad = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "restock_item", itemKey: "cheese:unknown", qty: 100 }],
      }),
      g,
    );
    expect(bad.type).toBe("none");

    const good = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "restock_item", itemKey: "cheese:mozz", qty: 100 }],
      }),
      g,
    );
    expect(good.type).toBe("command");
    if (good.type === "command" && good.actions[0].kind === "restock_item") {
      const a = good.actions[0];
      expect(a.name).toBe("Mozzarella");
      expect(a.unit).toBe("lbs");
      expect(a.category).toBe("cheese");
      expect(a.qty).toBe(100);
    }
  });

  it("rejects out-of-bounds numeric values", () => {
    const overTarget = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "set_run_target", runId: "r1", casesNeeded: MAX_TARGET_CASES + 1 }],
      }),
      g,
    );
    expect(overTarget.type).toBe("none");

    const overQty = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "restock_item", itemKey: "cheese:mozz", qty: MAX_QTY + 1 }],
      }),
      g,
    );
    expect(overQty.type).toBe("none");

    const zeroQty = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "restock_item", itemKey: "cheese:mozz", qty: 0 }],
      }),
      g,
    );
    expect(zeroQty.type).toBe("none");
  });

  it("normalizes a free-text stoppage category to a fixed kind", () => {
    const out = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "start_stoppage", reason: "belt is jammed", stoppageType: "blah" }],
      }),
      g,
    );
    expect(out.type).toBe("command");
    if (out.type === "command" && out.actions[0].kind === "start_stoppage") {
      expect(out.actions[0].stoppageType).toBe("jam");
    }
  });

  it("allows clear_target_time and stoppage actions without a runId (current run)", () => {
    const out = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "clear_target_time" }, { kind: "end_stoppage" }],
      }),
      g,
    );
    expect(out.type).toBe("command");
    if (out.type === "command") expect(out.actions).toHaveLength(2);
  });

  it("rejects a stoppage that names an unknown run", () => {
    const out = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [{ kind: "end_stoppage", runId: "ghost" }],
      }),
      g,
    );
    expect(out.type).toBe("none");
  });

  it("caps the number of actions at MAX_COMMAND_ACTIONS", () => {
    const actions = Array.from({ length: MAX_COMMAND_ACTIONS + 3 }, () => ({
      kind: "switch_run",
      runId: "r1",
    }));
    const out = sanitizeCommand(JSON.stringify({ type: "command", actions }), g);
    expect(out.type).toBe("command");
    if (out.type === "command") expect(out.actions).toHaveLength(MAX_COMMAND_ACTIONS);
  });

  it("drops malformed actions but keeps the valid ones in order", () => {
    const out = sanitizeCommand(
      JSON.stringify({
        type: "command",
        actions: [
          { kind: "switch_run", runId: "ghost" },
          { kind: "switch_run", runId: "r2" },
          { kind: "nonsense" },
          { kind: "clear_target_time" },
        ],
      }),
      g,
    );
    expect(out.type).toBe("command");
    if (out.type === "command") {
      expect(out.actions.map((a) => a.kind)).toEqual(["switch_run", "clear_target_time"]);
      if (out.actions[0].kind === "switch_run") expect(out.actions[0].runId).toBe("r2");
    }
  });

  it("resolves a rollover action and attaches a friendly label (no grounding needed)", () => {
    const out = sanitizeCommand(
      JSON.stringify({ type: "command", actions: [{ kind: "rollover" }] }),
      g,
    );
    expect(out.type).toBe("command");
    if (out.type === "command") {
      expect(out.actions).toHaveLength(1);
      expect(out.actions[0].kind).toBe("rollover");
      expect(out.actions[0].label).toBeTruthy();
    }
  });
});
