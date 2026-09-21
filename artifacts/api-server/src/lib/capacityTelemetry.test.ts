import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  capacityTelemetrySnapshot,
  clearCapacityTelemetryForTests,
  recordLegacySyncWrite,
  recordSseFrame,
  recordSyncParserRejection,
  recordSyncPut,
  reportCapacityTelemetry,
  syncRunCountBucket,
} from "./capacityTelemetry";

beforeEach(() => clearCapacityTelemetryForTests());

describe("capacity telemetry", () => {
  it("reports bounded percentile distributions without operational identifiers", () => {
    for (const durationMs of [1, 2, 3, 4, 100]) {
      recordSyncPut({
        mode: "partial",
        outcome: "accepted",
        runsBucket: "21-50",
        sanitizedBytes: 200,
        wireBytes: 240,
        durationMs,
      });
    }
    recordSseFrame({ mode: "complete", frameBytes: 800, durationMs: 7, outcome: "sent" });
    recordLegacySyncWrite("accepted");
    const snapshot = capacityTelemetrySnapshot();
    expect(snapshot.distributions["sync.put.partial.accepted.duration_ms"]).toEqual({
      count: 5,
      p50: 3,
      p95: 100,
      p99: 100,
      max: 100,
    });
    expect(snapshot.counters).toMatchObject({
      "sync.put.partial.accepted.count": 5,
      "sync.put.runs.21-50": 5,
      "sync.sse.complete.sent.count": 1,
      "sync.put.legacy_unversioned.accepted.count": 1,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/payload|runId|recipe|user|facility|errorText/i);
  });

  it("classifies bounded run counts", () => {
    expect(syncRunCountBucket({ dayState: { runs: [] } })).toBe("0");
    expect(syncRunCountBucket({ dayState: { runs: [{}] } })).toBe("1-5");
    expect(syncRunCountBucket({ dayState: { runs: Array(20).fill({}) } })).toBe("6-20");
    expect(syncRunCountBucket({ dayState: { runs: Array(80).fill({}) } })).toBe("21-50");
  });

  it("emits one aggregate report and clears its window", () => {
    const info = vi.fn();
    recordSyncPut({
      mode: "fallback",
      outcome: "rejected",
      runsBucket: "0",
      sanitizedBytes: 0,
      wireBytes: 12,
      durationMs: 4,
      parserRejected: true,
    });
    recordSyncParserRejection(4_096);
    reportCapacityTelemetry({ info } as never);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "capacity_telemetry",
        counters: expect.objectContaining({
          "sync.put.fallback.rejected.count": 1,
          "sync.put.parser_rejected.count": 2,
        }),
      }),
      "bounded capacity telemetry",
    );
    expect(capacityTelemetrySnapshot().counters).toEqual({});
  });
});