import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("./summarize-capacity-telemetry.mts", import.meta.url));
function run(input: string) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), cli, input], {
    encoding: "utf8", timeout: 10_000,
  });
}

const distribution = (count: number, p50: number, p95: number, p99: number, max: number) => ({
  count, p50, p95, p99, max,
});

function capacityRecord(overrides: Record<string, unknown> = {}) {
  return {
    event: "capacity_telemetry",
    observedFrom: "2026-10-24T00:00:00.000Z",
    observedUntil: "2026-10-24T00:01:00.000Z",
    windowMs: 60_000,
    counters: {
      "db.pool.acquisition.auto_track.success.count": 12,
      "db.pool.acquisition.auto_track.error.count": 2,
      "db.pool.acquisition_error.count": 2,
    },
    distributions: {
      "db.pool.acquisition.auto_track.duration_ms": distribution(14, 2, 25, 80, 95),
      "db.pool.acquisition_ms": distribution(14, 2, 25, 80, 95),
    },
    ...overrides,
  };
}

function withInput(lines: string[], callback: (input: string) => void) {
  const directory = mkdtempSync(path.join(tmpdir(), "capacity-summary-fixture-"));
  try {
    const input = path.join(directory, "synthetic.jsonl");
    writeFileSync(input, lines.join("\n"));
    callback(input);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("projects allowlisted pool acquisition data per original observation window", () => {
  const first = capacityRecord();
  const second = capacityRecord({
    observedFrom: "2026-10-24T00:01:00.000Z",
    observedUntil: "2026-10-24T00:02:00.000Z",
    windowMs: 60_000,
    counters: {
      "db.pool.acquisition.auto_track.success.count": 40,
    },
    distributions: {
      "db.pool.acquisition.auto_track.duration_ms": distribution(40, 120, 220, 400, 900),
    },
  });
  withInput([JSON.stringify(first), JSON.stringify(second)], (input) => {
    const result = run(input);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.windows.length, 2);
    assert.deepEqual(summary.windows[0].operations.auto_track, {
      successCount: 12,
      errorCount: 2,
      duration: distribution(14, 2, 25, 80, 95),
    });
    assert.deepEqual(summary.windows[1].operations.auto_track, {
      successCount: 40,
      duration: distribution(40, 120, 220, 400, 900),
    });
    assert.equal(summary.windows[0].acquisitionErrorCount, 2);
    assert.deepEqual(summary.windows[0].overallDuration, distribution(14, 2, 25, 80, 95));
    assert.equal(summary.windows[1].overallDuration, undefined);
  });
});

test("counts malformed input safely and omits unknown labels and fields", () => {
  const unknownOnly = capacityRecord({
    counters: { "db.pool.acquisition.private_operation.success.count": 999 },
    distributions: { "db.pool.acquisition.private_operation.duration_ms": distribution(1, 1, 1, 1, 1) },
    privatePayload: "PRIVATE_FIXTURE",
  });
  const partlyKnown = capacityRecord({
    counters: {
      "db.pool.acquisition.auto_track.success.count": 1,
      "db.pool.acquisition.private_operation.success.count": 999,
    },
    distributions: {
      "db.pool.acquisition.private_operation.duration_ms": distribution(1, 1, 1, 1, 1),
    },
    password: "PRIVATE_FIXTURE",
    sql: "SELECT PRIVATE_FIXTURE",
  });
  withInput([
    "MALFORMED_PRIVATE_FIXTURE",
    JSON.stringify({ event: "capacity_telemetry", observedFrom: "invalid", counters: {}, distributions: {} }),
    JSON.stringify(unknownOnly),
    JSON.stringify(partlyKnown),
    JSON.stringify({ event: "unrelated", payload: "PRIVATE_FIXTURE" }),
  ], (input) => {
    const result = run(input);
    assert.equal(result.status, 1);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.invalidJsonLines, 1);
    assert.equal(summary.invalidRecords, 1);
    assert.equal(summary.ignoredRecords, 2);
    assert.equal(summary.windows.length, 1);
    assert.deepEqual(Object.keys(summary.windows[0].operations), ["auto_track"]);
    assert.deepEqual(summary.windows[0].operations.auto_track, { successCount: 1 });
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_FIXTURE|private_operation|password|sql|payload/i);
  });
});

test("omits out-of-range and inconsistent metric values without echoing them", () => {
  const invalid = capacityRecord({
    counters: {
      "db.pool.acquisition.auto_track.success.count": -1,
      "db.pool.acquisition.auto_track.error.count": Number.MAX_SAFE_INTEGER + 1,
    },
    distributions: {
      "db.pool.acquisition.auto_track.duration_ms": distribution(0, 1, 2, 3, 4),
      "db.pool.acquisition.health_check.duration_ms": distribution(1, 10, 9, 12, 15),
      "db.pool.acquisition.outbox.duration_ms": distribution(1, 1, 2, 3, 600_001),
    },
  });
  withInput([JSON.stringify(invalid)], (input) => {
    const result = run(input);
    assert.equal(result.status, 1);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.invalidMetricValues, 5);
    assert.equal(summary.windows.length, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /600001|9007199254740992/);
  });
});

test("fails closed on oversized lines without printing input or paths", () => {
  withInput([JSON.stringify({ payload: "PRIVATE_FIXTURE".repeat(6_000) })], (input) => {
    const result = run(input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Cannot summarize/);
    assert.doesNotMatch(result.stderr, /PRIVATE_FIXTURE|capacity-summary-fixture/);
  });
});

test("fails closed before output when summarized-window cardinality exceeds its bound", () => {
  const line = JSON.stringify(capacityRecord());
  withInput(Array.from({ length: 5_001 }, () => line), (input) => {
    const result = run(input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /5000 summarized windows/);
    assert.doesNotMatch(result.stderr, /capacity-summary-fixture|capacity_telemetry/);
  });
});
