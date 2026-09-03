import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFieldCheckObserver,
  emitFieldCheckSignal,
  FIELD_CHECK_SIGNAL_EVENT,
} from "./fieldChecks";

const submit = vi.hoisted(() => vi.fn().mockResolvedValue({ accepted: 1, duplicate: 0 }));
vi.mock("./inventoryShared", () => ({ submitFieldCheckObservations: submit }));

describe("field-check observer", () => {
  beforeEach(() => {
    localStorage.clear();
    submit.mockClear();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  it("records naturally occurring signals without duplicating a ten-minute bucket", async () => {
    const stop = createFieldCheckObserver("test-build");
    emitFieldCheckSignal("sync-acknowledgment", "success", { latencyMs: 12.345 });
    emitFieldCheckSignal("sync-acknowledgment", "success", { latencyMs: 12.345 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submit).toHaveBeenCalled();
    const observations = submit.mock.calls.flatMap((call) => call[0]);
    expect(observations).toHaveLength(2);
    expect(observations.every((item: { appBuild: string }) => item.appBuild === "test-build")).toBe(true);
    const syncObservations = observations.filter((item: { checkName: string }) =>
      item.checkName === "sync-acknowledgment",
    );
    expect(syncObservations).toHaveLength(1);
    expect(syncObservations[0].metrics.latencyMs).toBeCloseTo(12.345, 2);
    stop();
  });

  it("does not collect unsupported hardware checks", () => {
    const stop = createFieldCheckObserver("test-build");
    emitFieldCheckSignal("touch-accuracy", "success");
    expect(window.dispatchEvent).toBeDefined();
    expect(localStorage.getItem("run-calc-field-check-queue")).not.toContain("touch-accuracy");
    stop();
  });

  it("uses a browser event boundary for sync signals", () => {
    const listener = vi.fn();
    window.addEventListener(FIELD_CHECK_SIGNAL_EVENT, listener);
    emitFieldCheckSignal("foreground-recovery", "success");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(FIELD_CHECK_SIGNAL_EVENT, listener);
  });
});