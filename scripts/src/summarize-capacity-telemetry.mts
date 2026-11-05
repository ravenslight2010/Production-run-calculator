import { createReadStream } from "node:fs";
import { StringDecoder } from "node:string_decoder";

// Offline only. Never print paths, rejected records, or parse errors with content.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_LINES = 100_000;
const MAX_OUTPUT_WINDOWS = 5_000;
const MAX_METRIC_VALUE = 10 * 60 * 1_000;
const MAX_COUNTER_VALUE = Number.MAX_SAFE_INTEGER;
const OPERATIONS = [
  "auto_track",
  "outbox",
  "server_job",
  "health_check",
  "foreground_sync",
  "unknown",
] as const;
type Operation = typeof OPERATIONS[number];
type Distribution = { count: number; p50: number; p95: number; p99: number; max: number };
type OperationSummary = {
  successCount?: number;
  errorCount?: number;
  duration?: Distribution;
};
type WindowSummary = {
  observedFrom: string;
  observedUntil: string;
  windowMs: number;
  acquisitionErrorCount?: number;
  overallDuration?: Distribution;
  operations: Partial<Record<Operation, OperationSummary>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function boundedInteger(value: unknown, maximum: number, minimum = 0): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum;
}

function canonicalTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function hasValidWindowMetadata(value: Record<string, unknown>): value is Record<string, unknown> & {
  observedFrom: string;
  observedUntil: string;
  windowMs: number;
  counters: Record<string, unknown>;
  distributions: Record<string, unknown>;
} {
  const observedFrom = canonicalTimestamp(value.observedFrom);
  const observedUntil = canonicalTimestamp(value.observedUntil);
  return Boolean(
    observedFrom &&
    observedUntil &&
    Date.parse(observedUntil) >= Date.parse(observedFrom) &&
    boundedInteger(value.windowMs, MAX_COUNTER_VALUE) &&
    isRecord(value.counters) &&
    isRecord(value.distributions)
  );
}

function readDistribution(value: unknown): Distribution | undefined {
  if (!isRecord(value)) return undefined;
  const { count, p50, p95, p99, max } = value;
  if (
    !boundedInteger(count, MAX_COUNTER_VALUE, 1) ||
    !boundedInteger(p50, MAX_METRIC_VALUE) ||
    !boundedInteger(p95, MAX_METRIC_VALUE) ||
    !boundedInteger(p99, MAX_METRIC_VALUE) ||
    !boundedInteger(max, MAX_METRIC_VALUE) ||
    p50 > p95 ||
    p95 > p99 ||
    p99 > max
  ) return undefined;
  return { count, p50, p95, p99, max };
}

function projectWindow(value: unknown, onInvalidMetric: () => void): WindowSummary | undefined {
  if (!isRecord(value) || value.event !== "capacity_telemetry") return undefined;
  if (!hasValidWindowMetadata(value)) return undefined;

  const { observedFrom, observedUntil } = value;
  const counters = value.counters;
  const distributions = value.distributions;
  const summary: WindowSummary = {
    observedFrom,
    observedUntil,
    windowMs: value.windowMs,
    operations: {},
  };
  let validMetrics = 0;

  const errorCountKey = "db.pool.acquisition_error.count";
  if (hasOwn(counters, errorCountKey)) {
    if (boundedInteger(counters[errorCountKey], MAX_COUNTER_VALUE)) {
      summary.acquisitionErrorCount = counters[errorCountKey] as number;
      validMetrics += 1;
    } else {
      onInvalidMetric();
    }
  }

  const overallKey = "db.pool.acquisition_ms";
  if (hasOwn(distributions, overallKey)) {
    const duration = readDistribution(distributions[overallKey]);
    if (duration) {
      summary.overallDuration = duration;
      validMetrics += 1;
    } else {
      onInvalidMetric();
    }
  }

  for (const operation of OPERATIONS) {
    const operationSummary: OperationSummary = {};
    for (const [outcome, field] of [["success", "successCount"], ["error", "errorCount"]] as const) {
      const key = `db.pool.acquisition.${operation}.${outcome}.count`;
      if (!hasOwn(counters, key)) continue;
      const count = counters[key];
      if (boundedInteger(count, MAX_COUNTER_VALUE)) {
        operationSummary[field] = count;
        validMetrics += 1;
      } else {
        onInvalidMetric();
      }
    }

    const distributionKey = `db.pool.acquisition.${operation}.duration_ms`;
    if (hasOwn(distributions, distributionKey)) {
      const duration = readDistribution(distributions[distributionKey]);
      if (duration) {
        operationSummary.duration = duration;
        validMetrics += 1;
      } else {
        onInvalidMetric();
      }
    }

    if (Object.keys(operationSummary).length > 0) {
      summary.operations[operation] = operationSummary;
    }
  }

  return validMetrics > 0 ? summary : undefined;
}

async function main(): Promise<void> {
  if (process.argv.length !== 3) throw new Error("usage");
  let bytes = 0;
  let physicalLines = 0;
  let invalidJsonLines = 0;
  let invalidRecords = 0;
  let ignoredRecords = 0;
  let invalidMetricValues = 0;
  let pending = "";
  const decoder = new StringDecoder("utf8");
  const windows: WindowSummary[] = [];

  function consumeLine(line: string): void {
    physicalLines += 1;
    if (physicalLines > MAX_LINES || Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("size");
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      invalidJsonLines += 1;
      return;
    }

    if (!isRecord(parsed)) {
      invalidRecords += 1;
      return;
    }
    if (parsed.event !== "capacity_telemetry") {
      ignoredRecords += 1;
      return;
    }
    const projected = projectWindow(parsed, () => { invalidMetricValues += 1; });
    if (!projected) {
      // Distinguish malformed window metadata from an otherwise valid window
      // with no usable allowlisted acquisition metrics, without exposing fields.
      if (!hasValidWindowMetadata(parsed)) {
        invalidRecords += 1;
      } else {
        ignoredRecords += 1;
      }
      return;
    }
    if (windows.length >= MAX_OUTPUT_WINDOWS) throw new Error("size");
    windows.push(projected);
  }

  const stream = createReadStream(process.argv[2]!);
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error("size");
    pending += decoder.write(chunk);
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      consumeLine(line);
    }
    if (Buffer.byteLength(pending) > MAX_LINE_BYTES) throw new Error("size");
  }
  pending += decoder.end();
  if (pending) consumeLine(pending);

  console.log(JSON.stringify({
    format: "capacity_telemetry_pool_waits_v1",
    windows,
    invalidJsonLines,
    invalidRecords,
    ignoredRecords,
    invalidMetricValues,
    provenance: "offline_input_environment_and_revision_not_verified",
  }, null, 2));
  if (invalidJsonLines || invalidRecords || invalidMetricValues) process.exitCode = 1;
}

main().catch(() => {
  console.error(
    "Cannot summarize: provide one readable capacity telemetry JSONL file, at most 16 MiB, 100000 lines, 64 KiB per line, and 5000 summarized windows.",
  );
  process.exitCode = 1;
});
