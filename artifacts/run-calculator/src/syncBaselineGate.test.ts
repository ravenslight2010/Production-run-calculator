// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSyncBaselineGate, shouldAcceptSyncDaySnapshot } from "./storage";

describe("SSE sync baseline gate", () => {
  it("queues reconnect pushes until a populated initial snapshot is applied", () => {
    const gate = createSyncBaselineGate();
    gate.beginConnection();

    // EventSource can report open before the server's first data frame. The
    // reconnect push must wait, or a new device can overwrite the shared row.
    expect(gate.requestPush()).toBe(false);
    expect(gate.isReady()).toBe(false);

    // The caller applies the populated payload first, then releases exactly one
    // queued recovery push against that adopted state.
    expect(gate.completeInitialSnapshot()).toBe(true);
    expect(gate.isReady()).toBe(true);
    expect(gate.requestPush()).toBe(true);
  });

  it("treats the server's explicit empty initial frame as a safe baseline", () => {
    const gate = createSyncBaselineGate();
    gate.beginConnection();
    expect(gate.requestPush()).toBe(false);
    expect(gate.completeInitialSnapshot()).toBe(true);
    expect(gate.requestPush()).toBe(true);
  });

  it("resets readiness on each reconnect", () => {
    const gate = createSyncBaselineGate();
    gate.beginConnection();
    gate.completeInitialSnapshot();
    expect(gate.requestPush()).toBe(true);

    gate.beginConnection();
    expect(gate.requestPush()).toBe(false);
    expect(gate.completeInitialSnapshot()).toBe(true);
  });

  it("accepts a populated initial snapshot even when the local marker is newer", () => {
    expect(shouldAcceptSyncDaySnapshot({
      remoteDate: "2030-06-01",
      localDate: "2030-06-01",
      remoteResetAt: 1000,
      localResetAt: 2000,
      initialSnapshot: true,
    })).toBe(true);
  });

  it("still rejects an ordinary stale non-initial frame when local state is newer", () => {
    expect(shouldAcceptSyncDaySnapshot({
      remoteDate: "2030-06-01",
      localDate: "2030-06-01",
      remoteResetAt: 1000,
      localResetAt: 2000,
      initialSnapshot: false,
    })).toBe(false);
  });

  it("wires the first SSE frame as authoritative and re-arms the gate on reconnect errors", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(source).toContain("initialSnapshot: msg.initial === true");
    expect(source).toContain("const isReset = initialSnapshot || remoteResetAt > localResetAt;");
    const errorHandler = source.match(/es\.onerror = \(\) => \{([\s\S]*?)\n    \};/);
    expect(errorHandler?.[1]).toContain("syncBaselineGateRef.current.beginConnection()");
  });
});