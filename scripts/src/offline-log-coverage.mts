const STREAMS = [
  "capacity_telemetry",
  "database_phase",
  "endpoint_metrics",
  "auto_track",
  "queue_monitor",
  "database_capacity_sample",
  "event_loop",
] as const;

const MAX_WINDOWS = 5_000;
const MAX_INTERVAL_SAMPLES = 50;

type Stream = typeof STREAMS[number];
type CoverageWindow = {
  from: string;
  until: string;
  queryComplete: boolean;
  pagesComplete: boolean;
  truncated: boolean;
  observedFrom: string | null;
  observedUntil: string | null;
};

export type CoverageManifest = {
  captureFrom: string;
  captureUntil: string;
  expectedStreams: Stream[];
  windows: Array<CoverageWindow & { stream: Stream }>;
};

export type CoverageManifestRead =
  | { kind: "not-manifest" }
  | { kind: "invalid" }
  | { kind: "valid"; manifest: CoverageManifest };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isStream(value: unknown): value is Stream {
  return typeof value === "string" && STREAMS.includes(value as Stream);
}

export function readCoverageManifest(value: unknown): CoverageManifestRead {
  if (!isRecord(value) || value.event !== "offline_log_capture_manifest") {
    return { kind: "not-manifest" };
  }
  const keys = ["event", "version", "captureFrom", "captureUntil", "expectedStreams", "windows"];
  if (!hasExactKeys(value, keys) || value.version !== 1 ||
    !canonicalTimestamp(value.captureFrom) || !canonicalTimestamp(value.captureUntil) ||
    Date.parse(value.captureUntil) <= Date.parse(value.captureFrom) ||
    !Array.isArray(value.expectedStreams) || value.expectedStreams.length === 0 ||
    value.expectedStreams.length > STREAMS.length ||
    !value.expectedStreams.every(isStream) ||
    new Set(value.expectedStreams).size !== value.expectedStreams.length ||
    !Array.isArray(value.windows) || value.windows.length > MAX_WINDOWS) {
    return { kind: "invalid" };
  }

  const expectedStreams = value.expectedStreams as Stream[];
  const windows: CoverageManifest["windows"] = [];
  for (const candidate of value.windows) {
    if (!isRecord(candidate) ||
      !hasExactKeys(candidate, [
        "stream", "from", "until", "queryComplete", "pagesComplete", "truncated",
        "observedFrom", "observedUntil",
      ]) ||
      !isStream(candidate.stream) || !expectedStreams.includes(candidate.stream) ||
      !canonicalTimestamp(candidate.from) || !canonicalTimestamp(candidate.until) ||
      Date.parse(candidate.until) <= Date.parse(candidate.from) ||
      Date.parse(candidate.from) < Date.parse(value.captureFrom) ||
      Date.parse(candidate.until) > Date.parse(value.captureUntil) ||
      typeof candidate.queryComplete !== "boolean" ||
      typeof candidate.pagesComplete !== "boolean" ||
      typeof candidate.truncated !== "boolean") {
      return { kind: "invalid" };
    }

    const noObservedBounds = candidate.observedFrom === null && candidate.observedUntil === null;
    const validObservedBounds =
      canonicalTimestamp(candidate.observedFrom) &&
      canonicalTimestamp(candidate.observedUntil) &&
      Date.parse(candidate.observedUntil) >= Date.parse(candidate.observedFrom);
    if (!noObservedBounds && !validObservedBounds) return { kind: "invalid" };

    windows.push({
      stream: candidate.stream,
      from: candidate.from,
      until: candidate.until,
      queryComplete: candidate.queryComplete,
      pagesComplete: candidate.pagesComplete,
      truncated: candidate.truncated,
      observedFrom: candidate.observedFrom as string | null,
      observedUntil: candidate.observedUntil as string | null,
    });
  }

  return {
    kind: "valid",
    manifest: {
      captureFrom: value.captureFrom,
      captureUntil: value.captureUntil,
      expectedStreams: [...expectedStreams],
      windows,
    },
  };
}

function sampleIntervals(intervals: Array<{ from: string; until: string }>) {
  return {
    count: intervals.length,
    samples: intervals.slice(0, MAX_INTERVAL_SAMPLES),
    samplesTruncated: intervals.length > MAX_INTERVAL_SAMPLES,
  };
}

function summarizeObservedIntervals(
  captureFrom: string,
  captureUntil: string,
  intervals: readonly { from: string; until: string }[],
) {
  const sorted = [...intervals].sort((a, b) =>
    Date.parse(a.from) - Date.parse(b.from) || Date.parse(a.until) - Date.parse(b.until)
  );
  let cursor = Date.parse(captureFrom);
  let missingWindowCount = 0;
  let overlappingWindowCount = 0;
  let duplicateWindowCount = 0;
  const missingIntervals: Array<{ from: string; until: string }> = [];
  const overlappingIntervals: Array<{ from: string; until: string }> = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const interval = sorted[index]!;
    const from = Date.parse(interval.from);
    const until = Date.parse(interval.until);
    if (from > cursor) {
      missingWindowCount += 1;
      missingIntervals.push({ from: new Date(cursor).toISOString(), until: interval.from });
    } else if (from < cursor) {
      overlappingWindowCount += 1;
      const overlapUntil = Math.min(cursor, until);
      if (overlapUntil > from) overlappingIntervals.push({ from: interval.from, until: new Date(overlapUntil).toISOString() });
    }
    if (index > 0 && interval.from === sorted[index - 1]!.from && interval.until === sorted[index - 1]!.until) {
      duplicateWindowCount += 1;
    }
    cursor = Math.max(cursor, until);
  }
  const captureEnd = Date.parse(captureUntil);
  if (cursor < captureEnd) {
    missingWindowCount += 1;
    missingIntervals.push({ from: new Date(cursor).toISOString(), until: captureUntil });
  }
  return {
    status: missingWindowCount === 0 && overlappingWindowCount === 0 ? "complete" as const : "partial" as const,
    windowCount: sorted.length,
    observedFrom: sorted.length ? sorted[0]!.from : null,
    observedUntil: sorted.length
      ? sorted.reduce((latest, interval) =>
        Date.parse(interval.until) > Date.parse(latest) ? interval.until : latest,
      sorted[0]!.until)
      : null,
    missingWindowCount,
    missingIntervals: sampleIntervals(missingIntervals),
    overlappingWindowCount,
    duplicateWindowCount,
    overlappingIntervals: sampleIntervals(overlappingIntervals),
  };
}

export function summarizeCoverage(
  manifest: CoverageManifest | undefined,
  invalidManifestCount: number,
  observedRecordWindows?: Partial<Record<Stream, readonly { from: string; until: string }[]>>,
) {
  if (invalidManifestCount > 0) {
    return {
      status: "unknown" as const,
      reason: "invalid_or_duplicate_manifest",
      invalidManifestCount,
    };
  }
  if (!manifest) {
    return { status: "unknown" as const, reason: "coverage_manifest_missing" };
  }

  const streams = manifest.expectedStreams.map((stream) => {
    const windows = manifest.windows
      .filter((window) => window.stream === stream)
      .sort((a, b) => Date.parse(a.from) - Date.parse(b.from) || Date.parse(a.until) - Date.parse(b.until));
    let cursor = Date.parse(manifest.captureFrom);
    let missingWindowCount = 0;
    const missingIntervals: Array<{ from: string; until: string }> = [];
    const overlappingIntervals: Array<{ from: string; until: string }> = [];
    let overlappingWindowCount = 0;
    let duplicateWindowCount = 0;
    let allQueriesComplete = windows.length > 0;
    let truncatedWindowCount = 0;
    let incompleteQueryWindowCount = 0;
    let incompletePageWindowCount = 0;
    const observed = windows.filter((window) => window.observedFrom !== null);

    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index]!;
      const from = Date.parse(window.from);
      const until = Date.parse(window.until);
      if (from > cursor) {
        missingWindowCount += 1;
        missingIntervals.push({ from: new Date(cursor).toISOString(), until: window.from });
      } else if (from < cursor) {
        overlappingWindowCount += 1;
        const overlapUntil = Math.min(cursor, until);
        if (overlapUntil > from) {
          overlappingIntervals.push({ from: window.from, until: new Date(overlapUntil).toISOString() });
        }
      }
      if (index > 0 && window.from === windows[index - 1]!.from && window.until === windows[index - 1]!.until) {
        duplicateWindowCount += 1;
      }
      cursor = Math.max(cursor, until);
      if (window.truncated) truncatedWindowCount += 1;
      if (!window.queryComplete) incompleteQueryWindowCount += 1;
      if (!window.pagesComplete) incompletePageWindowCount += 1;
      if (!window.queryComplete || !window.pagesComplete || window.truncated) allQueriesComplete = false;
    }
    const captureUntil = Date.parse(manifest.captureUntil);
    if (cursor < captureUntil) {
      missingWindowCount += 1;
      missingIntervals.push({ from: new Date(cursor).toISOString(), until: manifest.captureUntil });
    }
    const status = allQueriesComplete && missingWindowCount === 0 && overlappingWindowCount === 0
      ? "complete"
      : "partial";
    const observedFrom = observed.length
      ? observed.reduce((earliest, window) =>
        Date.parse(window.observedFrom!) < Date.parse(earliest) ? window.observedFrom! : earliest,
      observed[0]!.observedFrom!)
      : null;
    const observedUntil = observed.length
      ? observed.reduce((latest, window) =>
        Date.parse(window.observedUntil!) > Date.parse(latest) ? window.observedUntil! : latest,
      observed[0]!.observedUntil!)
      : null;
    const observedRecordWindowCoverage = observedRecordWindows &&
      Object.prototype.hasOwnProperty.call(observedRecordWindows, stream)
      ? summarizeObservedIntervals(manifest.captureFrom, manifest.captureUntil, observedRecordWindows[stream]!)
      : undefined;
    return {
      stream,
      status: status === "complete" && observedRecordWindowCoverage?.status === "partial" ? "partial" : status,
      queryWindowCount: windows.length,
      observedWindowCount: observed.length,
      observedFrom,
      observedUntil,
      missingWindowCount,
      missingIntervals: sampleIntervals(missingIntervals),
      overlappingWindowCount,
      duplicateWindowCount,
      overlappingIntervals: sampleIntervals(overlappingIntervals),
      incompleteQueryWindowCount,
      incompletePageWindowCount,
      truncatedWindowCount,
      ...(observedRecordWindowCoverage ? { observedRecordWindowCoverage } : {}),
    };
  });

  return {
    status: streams.every((stream) => stream.status === "complete") ? "complete" as const : "partial" as const,
    scope: "declared_expected_streams_only",
    captureFrom: manifest.captureFrom,
    captureUntil: manifest.captureUntil,
    streams,
  };
}
