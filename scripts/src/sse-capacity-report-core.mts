const MAX_COUNT = 10_000_000;
const MAX_LOG_BYTES = 16 * 1024 * 1024;
const MAX_LOG_LINES = 20_000;
const MAX_PLATFORM_METRICS_AGE_MS = 24 * 60 * 60 * 1_000;
const SAMPLE_EVENT = "database_capacity_sample";
const UNAVAILABLE_REASON_CODES = [
  "pool_checkout_timeout",
  "pool_checkout_failed",
  "capacity_query_timeout",
  "capacity_query_cancelled",
  "capacity_query_failed",
  "invalid_capacity_result",
  "legacy_unclassified",
] as const;
type CapacityUnavailableReason = typeof UNAVAILABLE_REASON_CODES[number];

type JsonRecord = Record<string, unknown>;

export type SseCapacityPlatformMetrics = {
  windowStartUtc: string;
  windowEndUtc: string;
  deploymentSourceFingerprintSha256: string | null;
  deploymentSourceFingerprintSource: "verified-deployment-handoff" | "unknown";
  apiProcessesPerMachine: number | null;
  apiProcessesPerMachineSource: "verified-deployment-config" | "unknown";
  representativeWindowConfirmed: boolean;
  configuredMaximumMachines: number | null;
  configuredMaximumCapturedAtUtc: string | null;
  configuredMaximumSource: "owner-reported" | "replit-config" | "unknown";
  peakActiveMachines: number | null;
  peakDatabaseClientBackends: number | null;
  peakMetricsCapturedAtUtc: string | null;
  providerConnectionLimit: number | null;
  providerReservedSlots: number | null;
  providerMetricsCapturedAtUtc: string | null;
  providerMetricsSource: "provider-capacity-evidence" | "unknown";
  peakMetricsSource: "replit-monitoring-export" | "unknown";
};

type CapacitySample = {
  capturedAtUtc: string;
  intervalMs: number;
  appBuildId: string;
  sourceFingerprintSha256: string;
  pool: {
    max: number;
    total: number;
    idle: number;
    waiting: number;
  };
  database: {
    status: "observed" | "non_primary" | "unavailable";
    primaryVerified: boolean;
    unavailableReason: CapacityUnavailableReason | null;
    maxConnections?: number;
    superuserReservedSlots?: number;
    roleReservedSlots?: number;
    serverClientBackends?: number;
    activeWaitingBackends?: number;
    lockWaitingBackends?: number;
  };
};

export type ReportRevision = {
  assessmentRevision: string;
  sourceRevision: string;
  verificationFingerprintSha256: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeCount(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < minimum || value > MAX_COUNT) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function nullableCount(value: unknown, label: string, minimum = 0): number | null {
  return value === null || value === undefined ? null : safeCount(value, label, minimum);
}

function utcTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}.`);
  return new Date(parsed).toISOString();
}

function nullableUtcTimestamp(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : utcTimestamp(value, label);
}

function readPlatformMetrics(value: unknown): SseCapacityPlatformMetrics {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      value.kind !== "sse-platform-capacity-metrics") {
    throw new Error("Unsupported platform metrics input.");
  }
  const windowStartUtc = utcTimestamp(value.windowStartUtc, "platform window start");
  const windowEndUtc = utcTimestamp(value.windowEndUtc, "platform window end");
  if (Date.parse(windowEndUtc) <= Date.parse(windowStartUtc)) {
    throw new Error("Platform metrics window must have positive duration.");
  }
  if (typeof value.representativeWindowConfirmed !== "boolean") {
    throw new Error("Invalid representative-window confirmation.");
  }
  const configuredMaximumSource = value.configuredMaximumSource;
  if (configuredMaximumSource !== "owner-reported" &&
      configuredMaximumSource !== "replit-config" &&
      configuredMaximumSource !== "unknown") {
    throw new Error("Invalid configured-maximum source.");
  }
  const peakMetricsSource = value.peakMetricsSource;
  if (peakMetricsSource !== "replit-monitoring-export" && peakMetricsSource !== "unknown") {
    throw new Error("Invalid peak-metrics source.");
  }
  const providerMetricsSource = value.providerMetricsSource;
  if (providerMetricsSource !== "provider-capacity-evidence" &&
      providerMetricsSource !== "unknown") {
    throw new Error("Invalid provider-capacity source.");
  }
  const deploymentSourceFingerprintSource = value.deploymentSourceFingerprintSource;
  if (deploymentSourceFingerprintSource !== "verified-deployment-handoff" &&
      deploymentSourceFingerprintSource !== "unknown") {
    throw new Error("Invalid deployment source-fingerprint provenance.");
  }
  const deploymentSourceFingerprintSha256 = value.deploymentSourceFingerprintSha256;
  if (deploymentSourceFingerprintSource === "verified-deployment-handoff") {
    if (typeof deploymentSourceFingerprintSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(deploymentSourceFingerprintSha256)) {
      throw new Error("Verified deployment source fingerprint is missing or invalid.");
    }
  } else if (deploymentSourceFingerprintSha256 !== null &&
      deploymentSourceFingerprintSha256 !== undefined) {
    throw new Error("Unverified deployment source fingerprint must be omitted.");
  }
  const apiProcessesPerMachineSource = value.apiProcessesPerMachineSource;
  if (apiProcessesPerMachineSource !== "verified-deployment-config" &&
      apiProcessesPerMachineSource !== "unknown") {
    throw new Error("Invalid API process-count provenance.");
  }
  const apiProcessesPerMachine = nullableCount(
    value.apiProcessesPerMachine, "API processes per machine", 1,
  );
  const configuredMaximumMachines = nullableCount(
    value.configuredMaximumMachines, "configured maximum machines", 1,
  );
  const peakActiveMachines = nullableCount(value.peakActiveMachines, "peak active machines", 1);
  return {
    windowStartUtc,
    windowEndUtc,
    deploymentSourceFingerprintSha256:
      typeof deploymentSourceFingerprintSha256 === "string"
        ? deploymentSourceFingerprintSha256 : null,
    deploymentSourceFingerprintSource,
    apiProcessesPerMachine,
    apiProcessesPerMachineSource,
    representativeWindowConfirmed: value.representativeWindowConfirmed,
    configuredMaximumMachines,
    configuredMaximumCapturedAtUtc: nullableUtcTimestamp(
      value.configuredMaximumCapturedAtUtc, "configured maximum capture timestamp",
    ),
    configuredMaximumSource,
    peakActiveMachines,
    peakDatabaseClientBackends: nullableCount(
      value.peakDatabaseClientBackends, "peak database client backends",
    ),
    peakMetricsCapturedAtUtc: nullableUtcTimestamp(
      value.peakMetricsCapturedAtUtc, "peak metrics capture timestamp",
    ),
    providerConnectionLimit: nullableCount(value.providerConnectionLimit, "provider limit", 1),
    providerReservedSlots: nullableCount(value.providerReservedSlots, "provider reserved slots"),
    providerMetricsCapturedAtUtc: nullableUtcTimestamp(
      value.providerMetricsCapturedAtUtc, "provider metrics capture timestamp",
    ),
    providerMetricsSource,
    peakMetricsSource,
  };
}

function assessSourceFreshness(capturedAtUtc: string | null, generatedAtUtc: string) {
  const ageMs = capturedAtUtc === null
    ? null
    : Date.parse(generatedAtUtc) - Date.parse(capturedAtUtc);
  const status = ageMs === null
    ? "missing"
    : ageMs < 0
      ? "future"
      : ageMs > MAX_PLATFORM_METRICS_AGE_MS
        ? "stale"
        : "fresh";
  return {
    status,
    capturedAtUtc,
    ageMs,
    maxAgeMs: MAX_PLATFORM_METRICS_AGE_MS,
  } as const;
}

function parseCapacitySample(value: JsonRecord): CapacitySample {
  const build = value.build;
  const pool = value.pool;
  const database = value.database;
  if (!isRecord(build) || !isRecord(pool) || !isRecord(database)) {
    throw new Error("Capacity sample is missing required sections.");
  }
  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error("Capacity sample has an unsupported schema version.");
  }
  const appBuildId = build.appBuildId;
  const sourceFingerprintSha256 = build.sourceFingerprintSha256;
  if (typeof appBuildId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(appBuildId) ||
      typeof sourceFingerprintSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sourceFingerprintSha256)) {
    throw new Error("Capacity sample has invalid build identity.");
  }
  const status = database.status;
  if (status !== "observed" && status !== "non_primary" && status !== "unavailable") {
    throw new Error("Capacity sample has an invalid database status.");
  }
  const primaryVerified = database.primaryVerified;
  if (typeof primaryVerified !== "boolean" ||
      (status === "observed") !== primaryVerified) {
    throw new Error("Capacity sample primary status is inconsistent.");
  }
  let unavailableReason: CapacityUnavailableReason | null = null;
  if (status === "unavailable") {
    const reason = database.unavailableReason;
    if (reason === undefined && schemaVersion === 1) {
      unavailableReason = "legacy_unclassified";
    } else if (typeof reason === "string" &&
        UNAVAILABLE_REASON_CODES.includes(reason as CapacityUnavailableReason) &&
        reason !== "legacy_unclassified") {
      unavailableReason = reason as CapacityUnavailableReason;
    } else {
      throw new Error("Capacity sample has an invalid unavailable reason.");
    }
  } else if (database.unavailableReason !== undefined) {
    throw new Error("Available capacity sample cannot include an unavailable reason.");
  }
  const sample: CapacitySample = {
    capturedAtUtc: utcTimestamp(value.capturedAt, "sample timestamp"),
    intervalMs: safeCount(value.intervalMs, "sample interval", 1),
    appBuildId,
    sourceFingerprintSha256,
    pool: {
      max: safeCount(pool.max, "pool maximum", 1),
      total: safeCount(pool.total, "pool total"),
      idle: safeCount(pool.idle, "pool idle count"),
      waiting: safeCount(pool.waiting, "pool waiting count"),
    },
    database: {
      status,
      primaryVerified,
      unavailableReason,
    },
  };
  if (sample.pool.total > sample.pool.max || sample.pool.idle > sample.pool.total) {
    throw new Error("Capacity sample pool counts are inconsistent.");
  }
  if (status !== "unavailable") {
    sample.database.maxConnections = safeCount(database.maxConnections, "database maximum", 1);
    sample.database.superuserReservedSlots = safeCount(
      database.superuserReservedSlots, "superuser reserved slots",
    );
    sample.database.roleReservedSlots = safeCount(
      database.roleReservedSlots, "role reserved slots",
    );
    sample.database.serverClientBackends = safeCount(
      database.serverClientBackends, "database client backends",
    );
    const activeWaitingBackends = nullableCount(
      database.activeWaitingBackends, "active waiting backends",
    );
    const lockWaitingBackends = nullableCount(
      database.lockWaitingBackends, "lock-waiting backends",
    );
    if ((activeWaitingBackends === null) !== (lockWaitingBackends === null)) {
      throw new Error("Capacity sample has incomplete wait-event counts.");
    }
    if (activeWaitingBackends !== null && lockWaitingBackends !== null) {
      if (lockWaitingBackends > activeWaitingBackends) {
        throw new Error("Capacity sample wait-event counts are inconsistent.");
      }
      sample.database.activeWaitingBackends = activeWaitingBackends;
      sample.database.lockWaitingBackends = lockWaitingBackends;
    }
  }
  return sample;
}

function readJsonLines(text: string): { samples: CapacitySample[]; unstructuredLines: number } {
  if (Buffer.byteLength(text, "utf8") > MAX_LOG_BYTES) {
    throw new Error("Capacity log input exceeds the size limit.");
  }
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_LOG_LINES) throw new Error("Capacity log input exceeds the line limit.");
  const samples: CapacitySample[] = [];
  let unstructuredLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A mixed or damaged export cannot be treated as complete peak evidence.
      unstructuredLines += 1;
      continue;
    }
    if (!isRecord(parsed)) {
      unstructuredLines += 1;
      continue;
    }
    if (parsed.event !== SAMPLE_EVENT) continue;
    samples.push(parseCapacitySample(parsed));
  }
  return { samples, unstructuredLines };
}

export function assessConnectionBudget(input: {
  apiPoolUpperBound: number;
  observedDatabaseClientPeak: number;
  postgresOrdinarySlots: number;
  providerConnectionLimit: number;
  providerReservedSlots: number;
}): { status: "within_budget" | "over_budget"; demand: number; available: number } {
  const values = [
    input.apiPoolUpperBound,
    input.observedDatabaseClientPeak,
    input.postgresOrdinarySlots,
    input.providerConnectionLimit,
    input.providerReservedSlots,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_COUNT)) {
    throw new Error("Invalid connection budget inputs.");
  }
  const demand = input.apiPoolUpperBound + input.observedDatabaseClientPeak;
  const providerOrdinarySlots = input.providerConnectionLimit - input.providerReservedSlots;
  const available = Math.min(input.postgresOrdinarySlots, providerOrdinarySlots);
  return {
    status: demand <= available ? "within_budget" : "over_budget",
    demand,
    available,
  };
}

function analyzeCoverage(
  samples: CapacitySample[],
  windowStartUtc: string,
  windowEndUtc: string,
  unstructuredLines: number,
) {
  const start = Date.parse(windowStartUtc);
  const end = Date.parse(windowEndUtc);
  const inWindow = samples.filter((sample) => {
    const captured = Date.parse(sample.capturedAtUtc);
    return captured >= start && captured <= end;
  }).sort((a, b) => Date.parse(a.capturedAtUtc) - Date.parse(b.capturedAtUtc));
  const intervals = [...new Set(inWindow.map((sample) => sample.intervalMs))];
  const sampleIntervalMs = intervals.length === 1 ? intervals[0]! : null;
  const enoughSamples = sampleIntervalMs !== null &&
    inWindow.length >= Math.floor((end - start) / sampleIntervalMs);
  const coveredWindow = sampleIntervalMs !== null && inWindow.length > 0 &&
    Date.parse(inWindow[0]!.capturedAtUtc) - start <= sampleIntervalMs * 1.5 &&
    end - Date.parse(inWindow.at(-1)!.capturedAtUtc) <= sampleIntervalMs * 1.5 &&
    inWindow.slice(1).every((sample, index) =>
      Date.parse(sample.capturedAtUtc) - Date.parse(inWindow[index]!.capturedAtUtc) <=
        sampleIntervalMs * 1.5);
  const allPrimaryAvailable = inWindow.length > 0 &&
    inWindow.every((sample) => sample.database.status === "observed" &&
      sample.database.primaryVerified);
  return {
    samples: inWindow,
    sampleIntervalMs,
    expectedMinimumSamples: sampleIntervalMs === null
      ? null : Math.floor((end - start) / sampleIntervalMs),
    complete: unstructuredLines === 0 && intervals.length === 1 && enoughSamples &&
      coveredWindow && allPrimaryAvailable,
  };
}

export function buildSseCapacityReport(input: {
  rawLogLines: string;
  platformMetrics: unknown;
  revision: ReportRevision;
  generatedAtUtc: string;
}) {
  const platform = readPlatformMetrics(input.platformMetrics);
  const generatedAtUtc = utcTimestamp(input.generatedAtUtc, "report timestamp");
  const platformMetricsAgeMs =
    Date.parse(generatedAtUtc) - Date.parse(platform.windowEndUtc);
  const platformMetricsStatus = platformMetricsAgeMs < 0
    ? "future"
    : platformMetricsAgeMs > MAX_PLATFORM_METRICS_AGE_MS
      ? "stale"
      : "fresh";
  const platformMetricsFresh = platformMetricsStatus === "fresh";
  const autoscaleFreshness = assessSourceFreshness(
    platform.configuredMaximumCapturedAtUtc, generatedAtUtc,
  );
  const providerFreshness = assessSourceFreshness(
    platform.providerMetricsCapturedAtUtc, generatedAtUtc,
  );
  const peakFreshness = assessSourceFreshness(
    platform.peakMetricsCapturedAtUtc, generatedAtUtc,
  );
  const autoscaleFresh = autoscaleFreshness.status === "fresh";
  const providerFresh = providerFreshness.status === "fresh";
  const peakFresh = peakFreshness.status === "fresh";
  const configuredMaximumMachines = autoscaleFresh
    ? platform.configuredMaximumMachines : null;
  const configuredMaximumSource = autoscaleFresh
    ? platform.configuredMaximumSource : "unknown";
  const peakActiveMachines = peakFresh ? platform.peakActiveMachines : null;
  const peakDatabaseClientBackends = peakFresh ? platform.peakDatabaseClientBackends : null;
  const providerConnectionLimit = providerFresh ? platform.providerConnectionLimit : null;
  const providerReservedSlots = providerFresh ? platform.providerReservedSlots : null;
  const providerMetricsSource = providerFresh ? platform.providerMetricsSource : "unknown";
  const peakMetricsSource = peakFresh ? platform.peakMetricsSource : "unknown";
  if (configuredMaximumMachines !== null && peakActiveMachines !== null &&
      peakActiveMachines > configuredMaximumMachines) {
    throw new Error("Observed peak machines exceed the configured maximum.");
  }
  if (!/^test-sha256:[a-f0-9]{64}$/.test(input.revision.assessmentRevision) ||
      !/^source-sha256:[a-f0-9]{64}$/.test(input.revision.sourceRevision) ||
      !/^[a-f0-9]{64}$/.test(input.revision.verificationFingerprintSha256)) {
    throw new Error("Invalid report revision identity.");
  }
  const parsedLogs = readJsonLines(input.rawLogLines);
  const coverage = analyzeCoverage(
    parsedLogs.samples,
    platform.windowStartUtc,
    platform.windowEndUtc,
    parsedLogs.unstructuredLines,
  );
  const samples = coverage.samples;
  const observed = samples.filter((sample) => sample.database.status === "observed");
  const unavailableReasonCounts = Object.fromEntries(
    UNAVAILABLE_REASON_CODES.map((reason) => [reason, 0]),
  ) as Record<CapacityUnavailableReason, number>;
  for (const sample of samples) {
    if (sample.database.status === "unavailable" && sample.database.unavailableReason !== null) {
      unavailableReasonCounts[sample.database.unavailableReason] += 1;
    }
  }
  const identities = new Set(samples.map((sample) =>
    `${sample.appBuildId}:${sample.sourceFingerprintSha256}`));
  const sourceFingerprints = new Set(samples.map((sample) => sample.sourceFingerprintSha256));
  const poolMaximums = new Set(samples.map((sample) => sample.pool.max));
  const postgresConfigs = new Set(observed.map((sample) =>
    `${sample.database.maxConnections}:${sample.database.superuserReservedSlots}:` +
    `${sample.database.roleReservedSlots}`));
  const maxPoolSize = samples.length
    ? Math.max(...samples.map((sample) => sample.pool.max)) : null;
  const maxConnections = observed.length
    ? Math.min(...observed.map((sample) => sample.database.maxConnections!)) : null;
  const postgresOrdinarySlots = observed.length
    ? Math.min(...observed.map((sample) =>
      sample.database.maxConnections! - sample.database.superuserReservedSlots! -
      sample.database.roleReservedSlots!))
    : null;
  const sampledPeakClients = observed.length
    ? Math.max(...observed.map((sample) => sample.database.serverClientBackends!))
    : null;
  const poolWaiters = samples.filter((sample) => sample.pool.waiting > 0).length;
  const maxPoolWaiters = samples.length
    ? Math.max(...samples.map((sample) => sample.pool.waiting)) : null;
  const waitEventSamples = observed.filter((sample) =>
    sample.database.activeWaitingBackends !== undefined &&
    sample.database.lockWaitingBackends !== undefined);
  const samplesWithActiveWaiters = waitEventSamples.filter((sample) =>
    sample.database.activeWaitingBackends! > 0).length;
  const maximumActiveWaiters = waitEventSamples.length
    ? Math.max(...waitEventSamples.map((sample) => sample.database.activeWaitingBackends!))
    : null;
  const samplesWithLockWaiters = waitEventSamples.filter((sample) =>
    sample.database.lockWaitingBackends! > 0).length;
  const maximumLockWaiters = waitEventSamples.length
    ? Math.max(...waitEventSamples.map((sample) => sample.database.lockWaitingBackends!))
    : null;
  const configuredMaximumApiProcesses =
    configuredMaximumMachines !== null && platform.apiProcessesPerMachine !== null
      ? configuredMaximumMachines * platform.apiProcessesPerMachine : null;
  if (configuredMaximumApiProcesses !== null &&
      (!Number.isSafeInteger(configuredMaximumApiProcesses) ||
       configuredMaximumApiProcesses > MAX_COUNT)) {
    throw new Error("Configured API process bound exceeds the supported limit.");
  }
  const apiPoolUpperBound = configuredMaximumApiProcesses !== null && maxPoolSize !== null
    ? configuredMaximumApiProcesses * maxPoolSize : null;
  if (apiPoolUpperBound !== null &&
      (!Number.isSafeInteger(apiPoolUpperBound) || apiPoolUpperBound > MAX_COUNT)) {
    throw new Error("Calculated API connection bound exceeds the supported limit.");
  }
  const observedDatabaseClientPeak =
    peakDatabaseClientBackends === null && sampledPeakClients === null
      ? null
      : Math.max(peakDatabaseClientBackends ?? 0, sampledPeakClients ?? 0);
  const peakDatabaseClientSource = sampledPeakClients !== null
    ? peakDatabaseClientBackends !== null
      ? "combined-samples-and-monitoring"
      : "sanitized-database-samples"
    : peakDatabaseClientBackends !== null
      ? "replit-monitoring-export"
      : "unknown";
  const canAssessBudget = apiPoolUpperBound !== null && postgresOrdinarySlots !== null &&
    observedDatabaseClientPeak !== null && providerConnectionLimit !== null &&
    providerReservedSlots !== null;
  const budget = canAssessBudget
    ? assessConnectionBudget({
      apiPoolUpperBound,
      observedDatabaseClientPeak,
      postgresOrdinarySlots,
      providerConnectionLimit: providerConnectionLimit!,
      providerReservedSlots: providerReservedSlots!,
    })
    : null;
  const blockers: string[] = [];
  if (!platformMetricsFresh) blockers.push("platform_metrics_window_not_fresh");
  if (!autoscaleFresh) {
    blockers.push(`configured_machine_maximum_capture_time_${autoscaleFreshness.status}`);
  }
  if (!providerFresh) blockers.push(`provider_metrics_capture_time_${providerFreshness.status}`);
  if (!peakFresh) blockers.push(`peak_metrics_capture_time_${peakFreshness.status}`);
  if (!platform.representativeWindowConfirmed) blockers.push("peak_window_not_confirmed");
  if (peakMetricsSource !== "replit-monitoring-export") {
    blockers.push("peak_metrics_source_unverified");
  }
  if (platform.deploymentSourceFingerprintSource !== "verified-deployment-handoff" ||
      platform.deploymentSourceFingerprintSha256 === null) {
    blockers.push("deployment_source_fingerprint_unverified");
  } else if (sourceFingerprints.size !== 1 ||
      !sourceFingerprints.has(platform.deploymentSourceFingerprintSha256)) {
    blockers.push("capacity_deployment_fingerprint_mismatch");
  }
  if (platform.apiProcessesPerMachine === null) blockers.push("api_process_count_per_machine_missing");
  if (platform.apiProcessesPerMachineSource !== "verified-deployment-config") {
    blockers.push("api_process_count_source_unverified");
  }
  if (configuredMaximumMachines === null) blockers.push("configured_machine_maximum_missing");
  if (configuredMaximumSource === "unknown") {
    blockers.push("configured_machine_maximum_source_unverified");
  }
  if (peakActiveMachines === null) blockers.push("peak_machine_count_missing");
  if (observedDatabaseClientPeak === null) blockers.push("peak_database_client_count_missing");
  if (providerConnectionLimit === null) blockers.push("provider_connection_limit_missing");
  if (providerReservedSlots === null) blockers.push("provider_reserved_slots_missing");
  if (providerMetricsSource !== "provider-capacity-evidence") {
    blockers.push("provider_capacity_source_unverified");
  }
  if (!coverage.complete) blockers.push("capacity_sample_window_incomplete");
  if (identities.size !== 1) blockers.push("capacity_source_identity_inconsistent");
  if (poolMaximums.size !== 1) blockers.push("pool_maximum_inconsistent");
  if (postgresConfigs.size !== 1) blockers.push("postgres_capacity_configuration_inconsistent");
  if (parsedLogs.unstructuredLines > 0) blockers.push("unstructured_log_lines_present");
  if (peakActiveMachines !== null && configuredMaximumMachines !== null &&
      peakActiveMachines > configuredMaximumMachines) {
    blockers.push("observed_machine_peak_exceeds_configured_maximum");
  }
  if (budget?.status === "over_budget") blockers.push("connection_demand_exceeds_available_slots");
  const gate = !platformMetricsFresh
    ? "UNKNOWN"
    : budget?.status === "over_budget"
    ? "NO_GO"
    : blockers.length > 0 ? "UNKNOWN" : "PROVEN_WITHIN_BUDGET";
  const firstSample = samples[0];
  return {
    schemaVersion: 1,
    kind: "sse-capacity-report",
    generatedAtUtc,
    reportRevision: {
      assessmentRevision: input.revision.assessmentRevision,
      sourceRevision: input.revision.sourceRevision,
      verificationFingerprintSha256: input.revision.verificationFingerprintSha256,
    },
    windowUtc: {
      start: platform.windowStartUtc,
      end: platform.windowEndUtc,
      representativePeakConfirmed: platform.representativeWindowConfirmed,
    },
    platformEvidenceFreshness: {
      status: platformMetricsStatus,
      maxAgeMs: MAX_PLATFORM_METRICS_AGE_MS,
      windowEndAgeMs: platformMetricsAgeMs,
    },
    sourceCaptureFreshness: {
      autoscale: autoscaleFreshness,
      providerLimits: providerFreshness,
      peakMetrics: peakFreshness,
    },
    deploymentMetrics: {
      verifiedSourceFingerprintSha256: platform.deploymentSourceFingerprintSha256,
      sourceFingerprintSource: platform.deploymentSourceFingerprintSource,
      apiProcessesPerMachine: platform.apiProcessesPerMachine,
      apiProcessesPerMachineSource: platform.apiProcessesPerMachineSource,
      configuredMaximumMachines,
      configuredMaximumCapturedAtUtc: platform.configuredMaximumCapturedAtUtc,
      configuredMaximumSource,
      observedPeakMachines: peakActiveMachines,
      observedPeakApiProcesses: peakActiveMachines !== null &&
          platform.apiProcessesPerMachine !== null
        ? peakActiveMachines * platform.apiProcessesPerMachine : null,
      configuredMaximumApiProcesses,
      peakDatabaseClientBackends: observedDatabaseClientPeak,
      peakDatabaseClientSource,
      peakMetricsSource,
      peakMetricsCapturedAtUtc: platform.peakMetricsCapturedAtUtc,
      providerConnectionLimit,
      providerReservedSlots,
      providerMetricsCapturedAtUtc: platform.providerMetricsCapturedAtUtc,
      providerMetricsSource,
    },
    runtimeBuild: firstSample ? {
      appBuildId: identities.size === 1 ? firstSample.appBuildId : null,
      sourceFingerprintSha256: identities.size === 1
        ? firstSample.sourceFingerprintSha256 : null,
    } : null,
    capacitySamples: {
      sampleCount: samples.length,
      primaryObservedCount: observed.length,
      nonPrimaryCount: samples.filter((sample) =>
        sample.database.status === "non_primary").length,
      unavailableCount: samples.filter((sample) =>
        sample.database.status === "unavailable").length,
      unavailableReasonCounts,
      unstructuredLineCount: parsedLogs.unstructuredLines,
      sampleIntervalMs: coverage.sampleIntervalMs,
      expectedMinimumSamples: coverage.expectedMinimumSamples,
      completeForWindow: coverage.complete,
      observedPoolMaximum: maxPoolSize,
      poolMaximumConsistent: poolMaximums.size === 1,
      samplesWithPoolWaiters: poolWaiters,
      maximumPoolWaiters: maxPoolWaiters,
      postgresWaitEvents: {
        sampleCount: waitEventSamples.length,
        samplesWithActiveWaiters,
        maximumActiveWaiters,
        samplesWithLockWaiters,
        maximumLockWaiters,
      },
      postgresMaximumConnections: maxConnections,
      postgresOrdinarySlotsAfterKnownReservations: postgresOrdinarySlots,
      sampledPeakDatabaseClientBackends: sampledPeakClients,
      postgresConfigurationConsistent: postgresConfigs.size === 1,
    },
    budgetAssessment: {
      gate,
      safeBudgetProven: gate === "PROVEN_WITHIN_BUDGET",
      apiPoolConnectionUpperBound: apiPoolUpperBound,
      conservativeObservedClientCount: observedDatabaseClientPeak,
      conservativeDemand: budget?.demand ?? null,
      effectiveAvailableSlots: budget?.available ?? null,
      doubleCountsObservedApplicationClients: true,
      blockers: [...new Set(blockers)].sort(),
    },
    conclusion: {
      livePeerSseSupported: false,
      deploymentSettingsChanged: false,
    },
    sanitization: {
      rawLogLinesRetained: false,
      unrelatedLogPayloadsRetained: false,
      databaseNamesRolesHostsOrQueriesRetained: false,
      credentialsOrPersonalDataRetained: false,
    },
  };
}

export function parseSseCapacityInputs(platformJson: string, logText: string) {
  let platformMetrics: unknown;
  try {
    platformMetrics = JSON.parse(platformJson);
  } catch {
    throw new Error("Platform metrics file is not valid JSON.");
  }
  // Parse and validate the metrics here so malformed input never produces a report.
  readPlatformMetrics(platformMetrics);
  return { platformMetrics, rawLogLines: logText };
}
