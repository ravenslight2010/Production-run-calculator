import assert from "node:assert/strict";
import test from "node:test";
import { readCoverageManifest, summarizeCoverage } from "./offline-log-coverage.mts";

const start = "2026-10-24T00:00:00.000Z";
const middle = "2026-10-24T00:01:00.000Z";
const end = "2026-10-24T00:02:00.000Z";

function manifest(windows: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    event: "offline_log_capture_manifest",
    version: 1,
    captureFrom: start,
    captureUntil: end,
    expectedStreams: ["database_phase"],
    windows,
    ...overrides,
  };
}

function query(from: string, until: string, overrides: Record<string, unknown> = {}) {
  return {
    stream: "database_phase",
    from,
    until,
    queryComplete: true,
    pagesComplete: true,
    truncated: false,
    observedFrom: from,
    observedUntil: until,
    ...overrides,
  };
}

function summarize(input: unknown) {
  const read = readCoverageManifest(input);
  assert.equal(read.kind, "valid");
  if (read.kind !== "valid") throw new Error("expected valid test manifest");
  return summarizeCoverage(read.manifest, 0);
}

test("reports complete query and page coverage separately from observed time bounds", () => {
  const result = summarize(manifest([
    query(start, middle, { observedFrom: start, observedUntil: middle }),
    query(middle, end, { observedFrom: middle, observedUntil: end }),
  ]));
  assert.equal(result.status, "complete");
  assert.equal(result.captureFrom, start);
  assert.equal(result.captureUntil, end);
  assert.equal(result.scope, "declared_expected_streams_only");
  assert.deepEqual(result.streams[0], {
    stream: "database_phase",
    status: "complete",
    queryWindowCount: 2,
    observedWindowCount: 2,
    observedFrom: start,
    observedUntil: end,
    missingWindowCount: 0,
    missingIntervals: { count: 0, samples: [], samplesTruncated: false },
    overlappingWindowCount: 0,
    duplicateWindowCount: 0,
    overlappingIntervals: { count: 0, samples: [], samplesTruncated: false },
    incompleteQueryWindowCount: 0,
    incompletePageWindowCount: 0,
    truncatedWindowCount: 0,
  });
});

test("provider truncation and incomplete pagination stay partial even when bounds cover the capture", () => {
  for (const overrides of [{ truncated: true }, { pagesComplete: false }, { queryComplete: false }]) {
    const result = summarize(manifest([query(start, end, overrides)]));
    assert.equal(result.status, "partial");
    assert.equal(result.streams[0]?.status, "partial");
  }
});

test("reports missing intervals and an expected stream with no query as partial", () => {
  const gap = summarize(manifest([
    query(start, middle),
    query("2026-10-24T00:01:30.000Z", end),
  ]));
  assert.equal(gap.status, "partial");
  assert.deepEqual(gap.streams[0]?.missingIntervals.samples, [{
    from: middle,
    until: "2026-10-24T00:01:30.000Z",
  }]);

  const noWindows = summarize(manifest([]));
  assert.ok("streams" in noWindows);
  assert.ok(noWindows.streams);
  assert.equal(noWindows.streams[0]?.status, "partial");
  assert.deepEqual(noWindows.streams[0]?.missingIntervals.samples, [{ from: start, until: end }]);
});

test("duplicate and overlapping query windows are explicit partial coverage", () => {
  const overlap = summarize(manifest([
    query(start, middle),
    query(start, middle),
    query("2026-10-24T00:00:30.000Z", end),
  ]));
  assert.equal(overlap.status, "partial");
  assert.equal(overlap.streams[0]?.overlappingWindowCount, 2);
  assert.equal(overlap.streams[0]?.duplicateWindowCount, 1);
  assert.equal(overlap.streams[0]?.overlappingIntervals.count, 2);
});

test("observed telemetry windows with gaps or overlaps make coverage partial", () => {
  const read = readCoverageManifest(manifest(
    [query(start, end, { stream: "capacity_telemetry" })],
    { expectedStreams: ["capacity_telemetry"] },
  ));
  assert.equal(read.kind, "valid");
  if (read.kind !== "valid") throw new Error("expected valid test manifest");
  const missing = summarizeCoverage(read.manifest, 0, {
    capacity_telemetry: [{ from: start, until: middle }],
  });
  assert.equal(missing.status, "partial");
  assert.equal(missing.streams[0]?.observedRecordWindowCoverage?.missingWindowCount, 1);

  const overlap = summarizeCoverage(read.manifest, 0, {
    capacity_telemetry: [
      { from: start, until: middle },
      { from: "2026-10-24T00:00:30.000Z", until: end },
    ],
  });
  assert.equal(overlap.status, "partial");
  assert.equal(overlap.streams[0]?.observedRecordWindowCoverage?.overlappingWindowCount, 1);
});

test("invalid, duplicate, or absent metadata is unknown and never inferred complete", () => {
  for (const invalid of [
    manifest([query(start, end)], { captureUntil: "not-a-time" }),
    manifest([query(start, end, { stream: "private_query_label" })]),
    manifest([query(start, end)], { privatePayload: "PRIVATE_FIXTURE" }),
  ]) {
    assert.equal(readCoverageManifest(invalid).kind, "invalid");
  }
  assert.deepEqual(summarizeCoverage(undefined, 0), {
    status: "unknown",
    reason: "coverage_manifest_missing",
  });
  assert.deepEqual(summarizeCoverage(undefined, 1), {
    status: "unknown",
    reason: "invalid_or_duplicate_manifest",
    invalidManifestCount: 1,
  });
});
