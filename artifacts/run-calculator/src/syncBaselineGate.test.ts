// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createSyncBaselineGate,
  shouldAcceptSyncDaySnapshot,
  shouldAtomicallyAdoptFirstSnapshot,
} from "./storage";

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

  it("uses the atomic path only for the first untouched automatic placeholder", () => {
    const seeded = { id: "seed", brand: "", flavor: "", seeded: true };
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: true,
        localRuns: [seeded],
        hasLocalUserEdit: false,
      }),
    ).toBe(true);
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: false,
        localRuns: [seeded],
      }),
    ).toBe(false);
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: true,
        localRuns: [{ id: "new-run", brand: "", flavor: "" }],
      }),
    ).toBe(false);
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: true,
        localRuns: [{ ...seeded, brand: "Acme" }],
      }),
    ).toBe(false);
    expect(
      shouldAtomicallyAdoptFirstSnapshot({
        initialSnapshot: true,
        localRuns: [seeded],
        hasLocalUserEdit: true,
      }),
    ).toBe(false);
  });

  it("wires the first SSE frame as authoritative and re-arms the gate on reconnect errors", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(source).toContain("initialSnapshot: msg.initial === true");
    expect(source).toContain("shouldAtomicallyAdoptFirstSnapshot");
    expect(source).toContain("hasLocalUserEdit: form.formState.isDirty");
    expect(source).toContain("const isReset = atomicSeedSnapshot || remoteResetAt > localResetAt;");
    expect(source).toContain("const formHandoffRef = useRef(false);");
    const errorHandler = source.match(/es\.onerror = \(\) => \{([\s\S]*?)\n    \};/);
    expect(errorHandler?.[1]).toContain("syncBaselineGateRef.current.beginConnection()");
  });

  it("binds the adopted form before it publishes the incoming run selection", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const handoff = source.slice(
      source.indexOf("if (atomicSeedSnapshot) {"),
      source.indexOf("// ── Merge tombstones"),
    );
    expect(handoff).toContain("formHandoffRef.current = true;");
    expect(handoff.indexOf("form.reset(adoptedValues)")).toBeGreaterThan(-1);
    expect(handoff).toContain("lastFormRunIdRef.current = adopted.id;");
    // The state merge is intentionally after the complete form binding block.
    expect(source.indexOf("setDayState(prev =>")).toBeGreaterThan(
      source.indexOf("form.reset(adoptedValues)"),
    );
  });

  it("claims a seed after a genuine form edit, while programmatic resets stay local-only", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const autosave = source.slice(
      source.indexOf("if (deepEqual(loadRunValues(runId), v)) return;"),
      source.indexOf("schedulePush(ds);"),
    );
    expect(autosave).toContain("if (run.seeded)");
    expect(autosave).toContain("seeded: false");
    expect(autosave).toContain("saveDayState(ds);");
  });

  it("coalesces ordinary edits quickly while keeping recovery pushes immediate", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(source).toContain("const SYNC_EDIT_DEBOUNCE_MS = 120;");
    expect(source).toContain("function schedulePush(");
    expect(source).toContain("delay = SYNC_EDIT_DEBOUNCE_MS");
    expect(source).toContain("setInterval(() => { schedulePush(dayStateRef.current, 0, \"periodic\"); }, 30_000)");
    expect(source).toContain("syncMeta: { queuedAt: timing.queuedAtEpoch }");
    expect(source).toContain("X-Sync-Response-Bytes");
  });

  it("omits unchanged history from hot pushes and records it only after acknowledgement", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(source).toContain("lastSyncedHistorySigRef");
    expect(source).toContain("historySig !== lastSyncedHistorySigRef.current");
    expect(source).toContain("if (payload.history !== undefined)");
    expect(source).toContain("lastSyncedHistorySigRef.current = JSON.stringify(payload.history)");
  });
});