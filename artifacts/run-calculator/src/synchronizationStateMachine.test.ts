import { describe, expect, it } from "vitest";
import { SynchronizationStateMachine } from "./synchronizationStateMachine";

describe("SynchronizationStateMachine", () => {
  it("holds pushes behind the initial snapshot and drains one coalesced write", () => {
    const machine = new SynchronizationStateMachine<string>();
    expect(machine.requestBaselinePush()).toBe(false);
    expect(machine.completeInitialSnapshot()).toBe(true);
    expect(machine.beginPush("a")).toBe(true);
    expect(machine.beginPush("b")).toBe(false);
    expect(machine.beginPush("c")).toBe(false);
    expect(machine.finishPush("acknowledged")).toBe("c");
    expect(machine.phase).toBe("ready");
  });

  it("blocks direct and internal retries after reconnect until the baseline lands", () => {
    const machine = new SynchronizationStateMachine<string>();
    machine.completeInitialSnapshot();
    expect(machine.beginPush("old")).toBe(true);
    machine.beginConnection();
    expect(machine.beginPush("manual-retry")).toBe(false);
    expect(machine.beginPush("internal-retry", true)).toBe(false);
    expect(machine.isInFlight).toBe(false);
    expect(machine.completeInitialSnapshot()).toBe(true);
    expect(machine.beginPush("fresh")).toBe(true);
  });

  it("keeps a failed wake blocked and rejects an obsolete acknowledgement", () => {
    const machine = new SynchronizationStateMachine<string>();
    machine.completeInitialSnapshot();
    const first = machine.beginWake();
    expect(machine.completeWake(first, false)).toBe(false);
    expect(machine.phase).toBe("waking");
    const second = machine.beginWake();
    expect(machine.completeWake(first, true)).toBe(false);
    expect(machine.completeWake(second, true)).toBe(true);
    expect(machine.phase).toBe("ready");
  });

  it("ignores an acknowledgement from a push invalidated by wake", () => {
    const machine = new SynchronizationStateMachine<string>();
    machine.completeInitialSnapshot();
    machine.beginPush("before-sleep");
    const wake = machine.beginWake();
    expect(machine.finishPush("acknowledged")).toBeNull();
    expect(machine.phase).toBe("waking");
    expect(machine.completeWake(wake, true)).toBe(true);
  });

  it("invalidates queued writes across reset generations", () => {
    const machine = new SynchronizationStateMachine<string>();
    machine.completeInitialSnapshot();
    machine.beginPush("old");
    machine.beginPush("queued");
    const generation = machine.beginReset(7);
    expect(machine.isInFlight).toBe(false);
    expect(machine.takeQueued()).toBeNull();
    expect(machine.resetEpoch).toBe(7);
    expect(machine.completeReset(generation)).toBe(true);
    expect(machine.isReady).toBe(false);
  });
});