import { describe, expect, it } from "vitest";
import {
  browserIsOnline,
  resolveEndRunRoute,
  resolveForegroundStopIntent,
  type ForegroundStopIntent,
} from "./foregroundLifecycleIntent";

const intent: ForegroundStopIntent = { action: "stop", runId: "run-1" };

describe("foreground Stop intent", () => {
  it("applies only when the originally displayed run is still running", () => {
    expect(
      resolveForegroundStopIntent(
        intent,
        "run-1",
        { id: "run-1", brand: "A", flavor: "B", startedAt: 100 },
      ),
    ).toEqual({ kind: "apply", runId: "run-1" });
  });

  it.each([
    ["ended", { id: "run-1", brand: "A", flavor: "B", startedAt: 100, endedAt: 200 }],
    ["paused", { id: "run-1", brand: "A", flavor: "B", startedAt: 100, pausedAt: 150 }],
    ["not-started", { id: "run-1", brand: "A", flavor: "B" }],
  ] as const)("does not apply when the canonical run is %s", (_reason, run) => {
    expect(resolveForegroundStopIntent(intent, "run-1", run)).toEqual({
      kind: "not-applied",
      reason: _reason,
    });
  });

  it("does not redirect the intent to a different displayed run", () => {
    expect(
      resolveForegroundStopIntent(
        intent,
        "run-2",
        { id: "run-2", brand: "C", flavor: "D", startedAt: 300 },
      ),
    ).toEqual({ kind: "not-applied", reason: "changed" });
  });
});

describe("End run route", () => {
  it("uses inventory consumption only when the browser explicitly reports online", () => {
    expect(resolveEndRunRoute(true)).toBe("online-consume");
    expect(browserIsOnline({ onLine: true })).toBe(true);
  });

  it("uses the durable review intent when offline or browser status is unavailable", () => {
    expect(resolveEndRunRoute(false)).toBe("offline-intent");
    expect(resolveEndRunRoute(undefined)).toBe("offline-intent");
    expect(browserIsOnline({ onLine: false })).toBe(false);
    expect(browserIsOnline(null)).toBe(false);
  });
});
