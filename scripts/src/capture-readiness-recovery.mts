import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const READINESS_EVIDENCE_SCHEMA_VERSION = 1;
export const READINESS_DEPLOYMENT_HANDOFF_SCHEMA_VERSION = 1;
export const READINESS_EVIDENCE_MAX_SAMPLES = 60;
export const READINESS_EVIDENCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const READINESS_EVIDENCE_MIN_NORMAL_SAMPLES = 2;
export const READINESS_EVIDENCE_MAX_RESPONSE_BYTES = 32_000;
export const READINESS_EVIDENCE_MAX_BYTES = 256_000;
export const READINESS_DEPLOYMENT_HANDOFF_MAX_BYTES = 8_192;
export const READINESS_DEPLOYMENT_HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const READINESS_DEPLOYMENT_HANDOFF_DATABASE_OWNER_MAX_LENGTH = 128;
export const READINESS_EVIDENCE_DEFAULT_INTERVAL_MS = 5_000;
export const READINESS_EVIDENCE_DEFAULT_TIMEOUT_MS = 5_000;

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const DEFAULT_OUTPUT_PATH = path.resolve(
  ROOT,
  "release-evidence/readiness-recovery/readiness-recovery.json",
);
const BACKGROUND_OPERATION_NAMES = [
  "daily-rollover",
  "server-job-run",
  "server-job-prune",
  "web-push-schedule",
] as const;

type HealthStatus = "ok" | "error" | "pending" | "unknown";
export type ReadinessCaptureMode = "normal" | "recovery" | "observe";
export type ReadinessSampleOutcome =
  | "healthy"
  | "worker_incident"
  | "not_ready"
  | "unexpected"
  | "probe_error";

export type ReadinessWorkerObservation = {
  operation: (typeof BACKGROUND_OPERATION_NAMES)[number];
  status: "ok" | "warning" | "unknown";
  recentFailureCount: number;
  threshold: number;
  lastFailureAt?: string;
};

export type ReadinessSample = {
  capturedAt: string;
  httpStatus: number;
  outcome: ReadinessSampleOutcome;
  checks: {
    process: HealthStatus;
    startup: HealthStatus;
    database: HealthStatus;
    dependencies: HealthStatus;
    backgroundWorkers: HealthStatus;
  };
  workers: ReadinessWorkerObservation[];
};

export type ReadinessDeploymentHandoff = {
  schemaVersion: typeof READINESS_DEPLOYMENT_HANDOFF_SCHEMA_VERSION;
  kind: "published-deployment-handoff";
  deploymentId: string;
  deployedRevision: string;
  databaseOwner?: string;
  issuedAt: string;
  expiresAt: string;
};

export type ReadinessEvidence = {
  schemaVersion: typeof READINESS_EVIDENCE_SCHEMA_VERSION;
  kind: "readiness-recovery";
  environment: "development" | "release";
  deploymentId: string;
  revision: string;
  generatedAt: string;
  expiresAt: string;
  retention: {
    maxSamples: number;
    maxAgeMs: number;
  };
  target: {
    probe: "readyz";
  };
  samples: ReadinessSample[];
  summary: {
    normal200Samples: number;
    workerIncident503Samples: number;
    recovery200Samples: number;
    observedStates: string[];
    finalState: "normal" | "degraded" | "worker_incident" | "incident_recovered";
  };
  verification: {
    mode: ReadinessCaptureMode;
    passed: boolean;
    reason: string;
  };
};

export type ReadinessEvidenceValidationOptions = {
  expectedDeploymentId: string;
  expectedRevision: string;
  now?: Date;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReadinessCaptureMode(value: unknown): value is ReadinessCaptureMode {
  return value === "normal" || value === "recovery" || value === "observe";
}

function isReadinessSampleOutcome(value: unknown): value is ReadinessSampleOutcome {
  return value === "healthy" ||
    value === "worker_incident" ||
    value === "not_ready" ||
    value === "unexpected" ||
    value === "probe_error";
}

function isFinalState(
  value: unknown,
): value is ReadinessEvidence["summary"]["finalState"] {
  return value === "normal" ||
    value === "degraded" ||
    value === "worker_incident" ||
    value === "incident_recovered";
}

function isValidDeploymentId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

function isValidRevision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function isValidDatabaseOwner(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= READINESS_DEPLOYMENT_HANDOFF_DATABASE_OWNER_MAX_LENGTH &&
    /^[A-Za-z_][A-Za-z0-9_$-]*$/u.test(value)
  );
}

function isHealthStatus(value: unknown): value is HealthStatus {
  return value === "ok" ||
    value === "error" ||
    value === "pending" ||
    value === "unknown";
}

function isFiniteNonNegativeInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum;
}

function parseEvidenceInput(input: Uint8Array | unknown): unknown {
  if (!(input instanceof Uint8Array)) return input;
  if (input.byteLength > READINESS_EVIDENCE_MAX_BYTES) {
    throw new Error(
      `Readiness evidence exceeds the ${READINESS_EVIDENCE_MAX_BYTES}-byte bound`,
    );
  }
  try {
    return JSON.parse(Buffer.from(input).toString("utf8")) as unknown;
  } catch {
    throw new Error("Readiness evidence must be valid JSON");
  }
}

function parseDeploymentHandoffInput(input: Uint8Array | unknown): unknown {
  if (!(input instanceof Uint8Array)) return input;
  if (input.byteLength > READINESS_DEPLOYMENT_HANDOFF_MAX_BYTES) {
    throw new Error(
      `Readiness deployment handoff exceeds the ${READINESS_DEPLOYMENT_HANDOFF_MAX_BYTES}-byte bound`,
    );
  }
  try {
    return JSON.parse(Buffer.from(input).toString("utf8")) as unknown;
  } catch {
    throw new Error("Readiness deployment handoff must be valid JSON");
  }
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function requireTimestamp(value: unknown, field: string): number {
  if (typeof value !== "string") {
    throw new Error(`Readiness evidence ${field} must be an ISO timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Readiness evidence ${field} must be an ISO timestamp`);
  }
  return timestamp;
}

export type ReadinessDeploymentHandoffValidationOptions = {
  now?: Date;
};

/**
 * Validate the provider-neutral deployment handoff before probing the
 * published app. Only the bounded identity fields returned by this function
 * are allowed to influence retained readiness evidence.
 */
export function validateReadinessDeploymentHandoff(
  input: Uint8Array | unknown,
  options: ReadinessDeploymentHandoffValidationOptions = {},
): ReadinessDeploymentHandoff {
  const handoff = requireRecord(
    parseDeploymentHandoffInput(input),
    "Readiness deployment handoff must be a JSON object",
  );
  if (
    handoff.schemaVersion !== READINESS_DEPLOYMENT_HANDOFF_SCHEMA_VERSION ||
    handoff.kind !== "published-deployment-handoff"
  ) {
    throw new Error("Readiness deployment handoff has an unsupported schema or kind");
  }
  if (!isValidDeploymentId(handoff.deploymentId)) {
    throw new Error("Readiness deployment handoff deployment ID is malformed");
  }
  if (!isValidRevision(handoff.deployedRevision)) {
    throw new Error("Readiness deployment handoff deployed revision is malformed");
  }
  if (
    handoff.databaseOwner !== undefined &&
    !isValidDatabaseOwner(handoff.databaseOwner)
  ) {
    throw new Error("Readiness deployment handoff database owner is malformed");
  }
  const issuedAtMs = requireTimestamp(
    handoff.issuedAt,
    "deployment handoff issuedAt",
  );
  const expiresAtMs = requireTimestamp(
    handoff.expiresAt,
    "deployment handoff expiresAt",
  );
  const nowMs = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error("Readiness deployment handoff validation time is invalid");
  }
  if (issuedAtMs > nowMs) {
    throw new Error("Readiness deployment handoff is from the future");
  }
  if (expiresAtMs <= nowMs) {
    throw new Error("Readiness deployment handoff is stale");
  }
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > READINESS_DEPLOYMENT_HANDOFF_MAX_AGE_MS
  ) {
    throw new Error("Readiness deployment handoff validity window is invalid");
  }
  return {
    schemaVersion: READINESS_DEPLOYMENT_HANDOFF_SCHEMA_VERSION,
    kind: "published-deployment-handoff",
    deploymentId: handoff.deploymentId,
    deployedRevision: handoff.deployedRevision,
    ...(handoff.databaseOwner === undefined
      ? {}
      : { databaseOwner: handoff.databaseOwner }),
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

function validateReadinessSample(value: unknown, index: number): void {
  const sample = requireRecord(
    value,
    `Readiness evidence sample ${index + 1} is malformed`,
  );
  requireTimestamp(sample.capturedAt, `sample ${index + 1} capturedAt`);
  if (
    !isFiniteNonNegativeInteger(sample.httpStatus, 599) ||
    !isReadinessSampleOutcome(sample.outcome)
  ) {
    throw new Error(`Readiness evidence sample ${index + 1} is malformed`);
  }
  const checks = requireRecord(
    sample.checks,
    `Readiness evidence sample ${index + 1} checks are malformed`,
  );
  for (const name of [
    "process",
    "startup",
    "database",
    "dependencies",
    "backgroundWorkers",
  ]) {
    if (!isHealthStatus(checks[name])) {
      throw new Error(`Readiness evidence sample ${index + 1} checks are malformed`);
    }
  }
  if (!Array.isArray(sample.workers) || sample.workers.length !== BACKGROUND_OPERATION_NAMES.length) {
    throw new Error(`Readiness evidence sample ${index + 1} workers are malformed`);
  }
  const operations = new Set<string>();
  for (const workerValue of sample.workers) {
    const worker = requireRecord(
      workerValue,
      `Readiness evidence sample ${index + 1} workers are malformed`,
    );
    if (
      typeof worker.operation !== "string" ||
      !BACKGROUND_OPERATION_NAMES.includes(
        worker.operation as (typeof BACKGROUND_OPERATION_NAMES)[number],
      ) ||
      operations.has(worker.operation) ||
      (worker.status !== "ok" &&
        worker.status !== "warning" &&
        worker.status !== "unknown") ||
      !isFiniteNonNegativeInteger(worker.recentFailureCount, 100) ||
      !isFiniteNonNegativeInteger(worker.threshold, 100)
    ) {
      throw new Error(`Readiness evidence sample ${index + 1} workers are malformed`);
    }
    operations.add(worker.operation);
    if (worker.lastFailureAt !== undefined) {
      requireTimestamp(
        worker.lastFailureAt,
        `sample ${index + 1} worker timestamp`,
      );
    }
  }
  if (operations.size !== BACKGROUND_OPERATION_NAMES.length) {
    throw new Error(`Readiness evidence sample ${index + 1} workers are malformed`);
  }
}

/**
 * Validate retained readiness evidence before using it as current proof.
 *
 * The expected deployment identity is deliberately supplied by the caller.
 * In particular, this function never treats the verifier's checkout revision
 * or an evidence record's own identity as authoritative.
 */
export function validateReadinessEvidence(
  input: Uint8Array | unknown,
  options: ReadinessEvidenceValidationOptions,
): ReadinessEvidence {
  const evidence = requireRecord(
    parseEvidenceInput(input),
    "Readiness evidence must be a JSON object",
  );
  if (evidence.schemaVersion !== READINESS_EVIDENCE_SCHEMA_VERSION ||
      evidence.kind !== "readiness-recovery") {
    throw new Error("Readiness evidence has an unsupported schema or kind");
  }
  if (!isValidDeploymentId(options.expectedDeploymentId)) {
    throw new Error("Readiness evidence requires an expected published deployment ID");
  }
  if (!isValidRevision(options.expectedRevision)) {
    throw new Error("Readiness evidence requires the expected deployed revision");
  }
  if (!isValidDeploymentId(evidence.deploymentId)) {
    throw new Error("Readiness evidence deployment ID is malformed");
  }
  if (!isValidRevision(evidence.revision)) {
    throw new Error("Readiness evidence revision is malformed");
  }
  if (evidence.deploymentId !== options.expectedDeploymentId) {
    throw new Error(
      "Readiness evidence deployment ID does not match the expected published deployment",
    );
  }
  if (evidence.revision !== options.expectedRevision) {
    throw new Error(
      "Readiness evidence revision does not match the expected deployed revision",
    );
  }
  if (evidence.environment !== "development" && evidence.environment !== "release") {
    throw new Error("Readiness evidence environment is malformed");
  }
  const generatedAtMs = requireTimestamp(evidence.generatedAt, "generatedAt");
  const expiresAtMs = requireTimestamp(evidence.expiresAt, "expiresAt");
  const nowMs = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error("Readiness evidence validation time is invalid");
  }
  if (generatedAtMs > nowMs) {
    throw new Error("Readiness evidence generatedAt is in the future");
  }
  if (expiresAtMs <= nowMs) {
    throw new Error("Readiness evidence is expired");
  }
  const retention = requireRecord(
    evidence.retention,
    "Readiness evidence retention metadata is malformed",
  );
  if (
    retention.maxSamples !== READINESS_EVIDENCE_MAX_SAMPLES ||
    retention.maxAgeMs !== READINESS_EVIDENCE_RETENTION_MS ||
    expiresAtMs !== generatedAtMs + READINESS_EVIDENCE_RETENTION_MS
  ) {
    throw new Error("Readiness evidence retention metadata is malformed");
  }
  if (evidence.target === undefined ||
      !isRecord(evidence.target) ||
      evidence.target.probe !== "readyz") {
    throw new Error("Readiness evidence target is malformed");
  }
  if (!Array.isArray(evidence.samples) ||
      evidence.samples.length === 0 ||
      evidence.samples.length > READINESS_EVIDENCE_MAX_SAMPLES) {
    throw new Error(
      `Readiness evidence requires 1-${READINESS_EVIDENCE_MAX_SAMPLES} samples`,
    );
  }
  evidence.samples.forEach((sample, index) => validateReadinessSample(sample, index));
  const summary = requireRecord(
    evidence.summary,
    "Readiness evidence summary is malformed",
  );
  for (const field of [
    "normal200Samples",
    "workerIncident503Samples",
    "recovery200Samples",
  ]) {
    if (!isFiniteNonNegativeInteger(summary[field], evidence.samples.length)) {
      throw new Error("Readiness evidence summary is malformed");
    }
  }
  if (
    !Array.isArray(summary.observedStates) ||
    summary.observedStates.some(
      (state) => typeof state !== "string" || state.length > 64,
    ) ||
    !isFinalState(summary.finalState)
  ) {
    throw new Error("Readiness evidence summary is malformed");
  }
  const incidentIndex = evidence.samples.findIndex(
    ({ outcome }) => outcome === "worker_incident",
  );
  const workerIncident503Samples = evidence.samples.filter(
    ({ outcome }) => outcome === "worker_incident",
  ).length;
  const recovery200Samples = incidentIndex < 0
    ? 0
    : evidence.samples
      .slice(incidentIndex + 1)
      .filter(({ outcome }) => outcome === "healthy").length;
  const normal200Samples = evidence.samples.filter(
    ({ outcome }) => outcome === "healthy",
  ).length;
  const observedStates = [...new Set(evidence.samples.map(({ outcome }, index) =>
    stateForSample(
      outcome,
      incidentIndex >= 0 && index > incidentIndex && outcome === "healthy",
    ),
  ))];
  const finalState =
    workerIncident503Samples > 0
      ? recovery200Samples > 0
        ? "incident_recovered"
        : "worker_incident"
      : normal200Samples === evidence.samples.length
        ? "normal"
        : "degraded";
  if (
    summary.normal200Samples !== normal200Samples ||
    summary.workerIncident503Samples !== workerIncident503Samples ||
    summary.recovery200Samples !== recovery200Samples ||
    JSON.stringify(summary.observedStates) !== JSON.stringify(observedStates) ||
    summary.finalState !== finalState
  ) {
    throw new Error("Readiness evidence summary does not match its samples");
  }
  const verification = requireRecord(
    evidence.verification,
    "Readiness evidence verification is malformed",
  );
  if (
    !isReadinessCaptureMode(verification.mode) ||
    typeof verification.passed !== "boolean" ||
    typeof verification.reason !== "string" ||
    verification.reason.length > 256 ||
    !verification.passed
  ) {
    throw new Error("Readiness evidence verification is not a passing proof");
  }
  return evidence as ReadinessEvidence;
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(0, Math.round(value)))
    : fallback;
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function healthStatus(value: unknown): HealthStatus {
  return value === "ok" || value === "error" || value === "pending"
    ? value
    : "unknown";
}

function sanitizeWorkers(value: unknown): ReadinessWorkerObservation[] {
  const diagnostics = isRecord(value) ? value : {};
  return BACKGROUND_OPERATION_NAMES.map((operation) => {
    const diagnostic = isRecord(diagnostics[operation])
      ? diagnostics[operation]
      : undefined;
    const status =
      diagnostic?.status === "ok" || diagnostic?.status === "warning"
        ? diagnostic.status
        : "unknown";
    const observation: ReadinessWorkerObservation = {
      operation,
      status,
      recentFailureCount: boundedInteger(diagnostic?.recentFailureCount, 0, 100),
      threshold: boundedInteger(diagnostic?.threshold, 3, 100),
    };
    const lastFailureAt = safeTimestamp(diagnostic?.lastFailureAt);
    if (lastFailureAt) observation.lastFailureAt = lastFailureAt;
    return observation;
  });
}

function checksFromPayload(payload: unknown): ReadinessSample["checks"] {
  const checks = isRecord(payload) && isRecord(payload.checks)
    ? payload.checks
    : {};
  return {
    process: healthStatus(checks.process),
    startup: healthStatus(checks.startup),
    database: healthStatus(checks.database),
    dependencies: healthStatus(checks.dependencies),
    backgroundWorkers: healthStatus(checks.backgroundWorkers),
  };
}

function workerIncident(
  httpStatus: number,
  checks: ReadinessSample["checks"],
  workers: ReadinessWorkerObservation[],
): boolean {
  return httpStatus === 503 &&
    checks.backgroundWorkers === "error" &&
    workers.some(({ status }) => status === "warning");
}

export function sanitizeReadinessResponse(input: {
  capturedAt: string;
  httpStatus: number;
  payload?: unknown;
}): ReadinessSample {
  const checks = checksFromPayload(input.payload);
  const workers = sanitizeWorkers(
    isRecord(input.payload) &&
      isRecord(input.payload.diagnostics)
      ? input.payload.diagnostics.backgroundOperations
      : undefined,
  );
  const parsedStatus = isRecord(input.payload) ? input.payload.status : undefined;
  const outcome: ReadinessSampleOutcome =
    workerIncident(input.httpStatus, checks, workers)
      ? "worker_incident"
      : input.httpStatus === 200 && parsedStatus === "ok"
        ? "healthy"
        : input.httpStatus === 503 &&
            (parsedStatus === "degraded" || parsedStatus === "starting")
          ? "not_ready"
          : "unexpected";
  return {
    capturedAt: safeTimestamp(input.capturedAt) ?? new Date(0).toISOString(),
    httpStatus: Number.isInteger(input.httpStatus) &&
        input.httpStatus >= 0 &&
        input.httpStatus <= 599
      ? input.httpStatus
      : 0,
    outcome,
    checks,
    workers,
  };
}

export function probeErrorSample(capturedAt: string): ReadinessSample {
  return {
    capturedAt: safeTimestamp(capturedAt) ?? new Date(0).toISOString(),
    httpStatus: 0,
    outcome: "probe_error",
    checks: {
      process: "unknown",
      startup: "unknown",
      database: "unknown",
      dependencies: "unknown",
      backgroundWorkers: "unknown",
    },
    workers: BACKGROUND_OPERATION_NAMES.map((operation) => ({
      operation,
      status: "unknown",
      recentFailureCount: 0,
      threshold: 3,
    })),
  };
}

function stateForSample(
  outcome: ReadinessSampleOutcome,
  isRecovery: boolean,
): string {
  switch (outcome) {
    case "healthy":
      return isRecovery ? "recovery_200" : "normal_200";
    case "worker_incident":
      return "worker_incident_503";
    case "not_ready":
      return "not_ready_503";
    case "probe_error":
      return "probe_error";
    case "unexpected":
      return "unexpected_response";
  }
}

function verificationFor(
  mode: ReadinessCaptureMode,
  samples: ReadinessSample[],
  workerIncident503Samples: number,
  recovery200Samples: number,
): ReadinessEvidence["verification"] {
  const allHealthy = samples.length >= READINESS_EVIDENCE_MIN_NORMAL_SAMPLES &&
    samples.every(({ outcome }) => outcome === "healthy");
  if (mode === "normal") {
    return allHealthy
      ? { mode, passed: true, reason: "sustained HTTP 200 readiness" }
      : {
        mode,
        passed: false,
        reason: "normal mode requires sustained HTTP 200 readiness",
      };
  }
  if (mode === "recovery") {
    return workerIncident503Samples > 0 && recovery200Samples > 0
      ? {
        mode,
        passed: true,
        reason: "HTTP 503 worker incident was followed by HTTP 200 recovery",
      }
      : {
        mode,
        passed: false,
        reason: "recovery mode requires a worker incident HTTP 503 followed by HTTP 200",
      };
  }
  return samples.length > 0
    ? { mode, passed: true, reason: "readiness observations retained without a required sequence" }
    : { mode, passed: false, reason: "at least one readiness observation is required" };
}

export function buildReadinessEvidence(input: {
  environment: "development" | "release";
  deploymentId: string;
  revision: string;
  generatedAt: string;
  mode: ReadinessCaptureMode;
  samples: ReadinessSample[];
}): ReadinessEvidence {
  if (input.samples.length === 0 || input.samples.length > READINESS_EVIDENCE_MAX_SAMPLES) {
    throw new Error(
      `readiness evidence requires 1-${READINESS_EVIDENCE_MAX_SAMPLES} samples`,
    );
  }
  if (!/^[a-f0-9]{40}$/u.test(input.revision)) {
    throw new Error("readiness evidence revision must be the full 40-character Git commit SHA");
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(input.deploymentId)) {
    throw new Error("readiness evidence deployment ID is invalid");
  }
  const generatedAt = safeTimestamp(input.generatedAt);
  if (!generatedAt) throw new Error("readiness evidence generatedAt must be an ISO timestamp");
  const incidentIndex = input.samples.findIndex(
    ({ outcome }) => outcome === "worker_incident",
  );
  const workerIncident503Samples = input.samples.filter(
    ({ outcome }) => outcome === "worker_incident",
  ).length;
  const recovery200Samples = incidentIndex < 0
    ? 0
    : input.samples
      .slice(incidentIndex + 1)
      .filter(({ outcome }) => outcome === "healthy").length;
  const normal200Samples = input.samples.filter(({ outcome }) => outcome === "healthy").length;
  const observedStates = [...new Set(input.samples.map(({ outcome }, index) =>
    stateForSample(
      outcome,
      incidentIndex >= 0 && index > incidentIndex && outcome === "healthy",
    ),
  ))];
  const finalState =
    workerIncident503Samples > 0
      ? recovery200Samples > 0
        ? "incident_recovered"
        : "worker_incident"
      : normal200Samples === input.samples.length
        ? "normal"
        : "degraded";
  const expiresAt = new Date(
    Date.parse(generatedAt) + READINESS_EVIDENCE_RETENTION_MS,
  ).toISOString();
  return {
    schemaVersion: READINESS_EVIDENCE_SCHEMA_VERSION,
    kind: "readiness-recovery",
    environment: input.environment,
    deploymentId: input.deploymentId,
    revision: input.revision,
    generatedAt,
    expiresAt,
    retention: {
      maxSamples: READINESS_EVIDENCE_MAX_SAMPLES,
      maxAgeMs: READINESS_EVIDENCE_RETENTION_MS,
    },
    target: { probe: "readyz" },
    samples: input.samples,
    summary: {
      normal200Samples,
      workerIncident503Samples,
      recovery200Samples,
      observedStates,
      finalState,
    },
    verification: verificationFor(
      input.mode,
      input.samples,
      workerIncident503Samples,
      recovery200Samples,
    ),
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function captureMode(value: string | undefined): ReadinessCaptureMode {
  if (value === undefined || value === "normal" || value === "recovery" || value === "observe") {
    return value ?? "normal";
  }
  throw new Error("--mode must be normal, recovery, or observe");
}

function targetUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--url must be an absolute HTTP(S) URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password) {
    throw new Error("--url must be an HTTP(S) URL without embedded credentials");
  }
  return parsed.toString();
}

async function captureSample(
  url: string,
  timeoutMs: number,
): Promise<ReadinessSample> {
  const capturedAt = new Date().toISOString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > READINESS_EVIDENCE_MAX_RESPONSE_BYTES) {
      return sanitizeReadinessResponse({ capturedAt, httpStatus: response.status });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = undefined;
    }
    return sanitizeReadinessResponse({
      capturedAt,
      httpStatus: response.status,
      payload,
    });
  } catch {
    return probeErrorSample(capturedAt);
  }
}

async function main(): Promise<void> {
  const mode = captureMode(argument("--mode"));
  const url = targetUrl(requiredArgument("--url"));
  const environment = requiredArgument("--environment");
  if (environment !== "development" && environment !== "release") {
    throw new Error("--environment must be development or release");
  }
  const handoffPath = path.resolve(
    process.cwd(),
    requiredArgument("--deployment-handoff"),
  );
  const handoff = validateReadinessDeploymentHandoff(await readFile(handoffPath));
  const suppliedDeploymentId = argument("--deployment-id")?.trim();
  if (
    suppliedDeploymentId !== undefined &&
    suppliedDeploymentId !== handoff.deploymentId
  ) {
    throw new Error(
      "Readiness deployment handoff conflicts with --deployment-id",
    );
  }
  const suppliedRevision = argument("--revision")?.trim();
  if (
    suppliedRevision !== undefined &&
    suppliedRevision !== handoff.deployedRevision
  ) {
    throw new Error(
      "Readiness deployment handoff conflicts with --revision",
    );
  }
  const sampleCount = positiveInteger(
    argument("--samples"),
    "--samples",
    mode === "recovery" ? 12 : 3,
    READINESS_EVIDENCE_MAX_SAMPLES,
  );
  const intervalMs = positiveInteger(
    argument("--interval-ms"),
    "--interval-ms",
    READINESS_EVIDENCE_DEFAULT_INTERVAL_MS,
    60 * 60 * 1000,
  );
  const timeoutMs = positiveInteger(
    argument("--timeout-ms"),
    "--timeout-ms",
    READINESS_EVIDENCE_DEFAULT_TIMEOUT_MS,
    60_000,
  );
  const outputPath = path.resolve(
    process.cwd(),
    argument("--output") ?? DEFAULT_OUTPUT_PATH,
  );
  const samples: ReadinessSample[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(await captureSample(url, timeoutMs));
    if (index + 1 < sampleCount) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  const evidence = buildReadinessEvidence({
    environment,
    deploymentId: handoff.deploymentId,
    revision: handoff.deployedRevision,
    generatedAt: new Date().toISOString(),
    mode,
    samples,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Readiness evidence retained: ${outputPath} (${evidence.summary.finalState})\n`,
  );
  if (!evidence.verification.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(
      `FAIL readiness evidence: ${error instanceof Error ? error.message : "capture failed"}\n`,
    );
    process.exitCode = 1;
  });
}