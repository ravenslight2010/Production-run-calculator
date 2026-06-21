import { describe, it, expect, vi } from "vitest";
import {
  dispatchVoiceCommand,
  VOICE_COMMAND_ROLES,
  VOICE_COMMAND_KINDS,
  type VoiceCommandAction,
  type VoiceCommandHandlers,
  type VoiceCommandOutcome,
} from "@workspace/voice-commands";

// Build a handlers object where every method is a spy returning a successful
// outcome, so a test can assert which handler an action kind routes to and with
// what arguments. dispatchVoiceCommand is the parity-critical mapping shared by
// web + mobile, so the wiring is what we lock down here.
function makeHandlers(overrides: Partial<VoiceCommandHandlers> = {}): VoiceCommandHandlers {
  const ok = (message: string): VoiceCommandOutcome => ({ ok: true, message });
  return {
    setTargetTime: vi.fn(() => ok("set time")),
    clearTargetTime: vi.fn(() => ok("cleared time")),
    setRunTarget: vi.fn(() => ok("set target")),
    reorderRun: vi.fn(() => ok("reordered")),
    addRun: vi.fn(() => ok("added")),
    removeRun: vi.fn(() => ok("removed")),
    switchRun: vi.fn(() => ok("switched")),
    updateRunMeta: vi.fn(() => ok("renamed")),
    finishRun: vi.fn(() => ok("finished")),
    startStoppage: vi.fn(() => ok("started stoppage")),
    endStoppage: vi.fn(() => ok("ended stoppage")),
    setRunProgress: vi.fn(() => ok("progress")),
    logActualCases: vi.fn(() => ok("logged actual")),
    logWaste: vi.fn(() => ok("logged waste")),
    restockItem: vi.fn(() => ok("restocked")),
    adjustItem: vi.fn(() => ok("adjusted")),
    rollover: vi.fn(() => ok("rolled over")),
    ...overrides,
  };
}

describe("dispatchVoiceCommand — routing", () => {
  it("routes each action kind to the matching handler with the right arguments", async () => {
    const h = makeHandlers();
    const actions: VoiceCommandAction[] = [
      { kind: "set_target_time", label: "", time: "14:30" },
      { kind: "clear_target_time", label: "" },
      { kind: "set_run_target", label: "", runId: "r1", casesNeeded: 50 },
      { kind: "reorder_run", label: "", runId: "r1", beforeRunId: "r2" },
      { kind: "add_run", label: "", brand: "DiGiorno", flavor: "Pepperoni" },
      { kind: "remove_run", label: "", runId: "r1" },
      { kind: "switch_run", label: "", runId: "r2" },
      { kind: "update_run_meta", label: "", runId: "r1", brand: "B", flavor: "F" },
      { kind: "finish_run", label: "", runId: "r1" },
      { kind: "start_stoppage", label: "", runId: "r1", reason: "Jam", stoppageType: "jam" },
      { kind: "end_stoppage", label: "", runId: "r1" },
      {
        kind: "set_run_progress",
        label: "",
        runId: "r1",
        skidsCompleted: 2,
        casesOnCurrentSkid: 3,
        casesPerSkid: 40,
      },
      { kind: "log_actual_cases", label: "", runId: "r1", actualCases: 99 },
      { kind: "log_waste", label: "", runId: "r1", wasteLbs: 12.5 },
      {
        kind: "restock_item",
        label: "",
        itemKey: "cheese:mozz",
        category: "cheese",
        name: "Mozzarella",
        unit: "lbs",
        qty: 100,
      },
      { kind: "adjust_item", label: "", itemId: 7, qtyDelta: -5, note: "spill" },
      { kind: "rollover", label: "" },
    ];

    const results = await dispatchVoiceCommand(actions, h, true);

    expect(results).toHaveLength(actions.length);
    expect(results.every((r) => r.ok)).toBe(true);

    expect(h.setTargetTime).toHaveBeenCalledWith("14:30");
    expect(h.clearTargetTime).toHaveBeenCalledTimes(1);
    expect(h.setRunTarget).toHaveBeenCalledWith("r1", 50);
    expect(h.reorderRun).toHaveBeenCalledWith("r1", "r2");
    expect(h.addRun).toHaveBeenCalledWith("DiGiorno", "Pepperoni");
    expect(h.removeRun).toHaveBeenCalledWith("r1");
    expect(h.switchRun).toHaveBeenCalledWith("r2");
    expect(h.updateRunMeta).toHaveBeenCalledWith("r1", "B", "F");
    expect(h.finishRun).toHaveBeenCalledWith("r1");
    expect(h.startStoppage).toHaveBeenCalledWith("r1", "Jam", "jam");
    expect(h.endStoppage).toHaveBeenCalledWith("r1");
    expect(h.setRunProgress).toHaveBeenCalledWith("r1", {
      skidsCompleted: 2,
      casesOnCurrentSkid: 3,
      casesPerSkid: 40,
    });
    expect(h.logActualCases).toHaveBeenCalledWith("r1", 99);
    expect(h.logWaste).toHaveBeenCalledWith("r1", 12.5);
    expect(h.restockItem).toHaveBeenCalledWith({
      itemKey: "cheese:mozz",
      category: "cheese",
      name: "Mozzarella",
      unit: "lbs",
      qty: 100,
    });
    expect(h.adjustItem).toHaveBeenCalledWith({ itemId: 7, qtyDelta: -5, note: "spill" });
    expect(h.rollover).toHaveBeenCalledTimes(1);
  });

  it("carries the action label and undo through to the result", async () => {
    const undo = vi.fn();
    const h = makeHandlers({
      removeRun: vi.fn(() => ({ ok: true, message: "removed", undo })),
    });
    const results = await dispatchVoiceCommand(
      [{ kind: "remove_run", label: "Remove DiGiorno", runId: "r1" }],
      h,
      false,
    );
    expect(results[0].label).toBe("Remove DiGiorno");
    expect(results[0].undo).toBe(undo);
  });
});

describe("dispatchVoiceCommand — error isolation", () => {
  it("does not let one throwing handler abort the rest", async () => {
    const h = makeHandlers({
      removeRun: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    const results = await dispatchVoiceCommand(
      [
        { kind: "remove_run", label: "Remove", runId: "r1" },
        { kind: "switch_run", label: "Switch", runId: "r2" },
      ],
      h,
      true,
    );
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toBe("boom");
    expect(results[1].ok).toBe(true);
    expect(h.switchRun).toHaveBeenCalledWith("r2");
  });

  it("reports a generic message when a handler throws a non-Error", async () => {
    const h = makeHandlers({
      switchRun: vi.fn(() => {
        throw "nope";
      }),
    });
    const [result] = await dispatchVoiceCommand(
      [{ kind: "switch_run", label: "Switch", runId: "r2" }],
      h,
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Couldn't apply that.");
  });
});

describe("dispatchVoiceCommand — role gating", () => {
  it("blocks the manager-only rollover for non-managers with a failed result, not a silent skip", async () => {
    const h = makeHandlers();
    const results = await dispatchVoiceCommand([{ kind: "rollover", label: "Roll over" }], h, false);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toBe("That action needs a manager.");
    expect(h.rollover).not.toHaveBeenCalled();
  });

  it("allows the manager-only rollover for managers", async () => {
    const h = makeHandlers();
    const results = await dispatchVoiceCommand([{ kind: "rollover", label: "Roll over" }], h, true);
    expect(results[0].ok).toBe(true);
    expect(h.rollover).toHaveBeenCalledTimes(1);
  });

  it("every kind has a role, and only rollover is manager-gated", () => {
    for (const kind of VOICE_COMMAND_KINDS) {
      expect(VOICE_COMMAND_ROLES[kind]).toBeDefined();
    }
    expect(VOICE_COMMAND_ROLES.rollover).toBe("manager");
    for (const kind of VOICE_COMMAND_KINDS) {
      if (kind === "rollover") continue;
      expect(VOICE_COMMAND_ROLES[kind]).toBe("operator");
    }
  });
});
