#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_RESULTS_SCHEMA_VERSION = 1;
export const TEST_RESULT_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "INFRASTRUCTURE_ERROR",
  "TIMEOUT",
  "CANCELLED",
  "NOT_RUN",
  "BLOCKED",
]);

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(scriptDir, "../..");
const DEFAULT_REPORT_PATH = ".local/test-evidence/latest.json";
const CATALOG_PATH = resolve(REPOSITORY_ROOT, "docs/test-lane-catalog.json");
const SAFE_REASONS = new Set([
  "This lane was not executed in this report's run scope.",
  "This lane is optional or manual and was not requested.",
  "The test command reached its timeout.",
  "The test command was interrupted.",
  "The test process could not start or was terminated unexpectedly.",
  "The test command exited unsuccessfully.",
  "Required prerequisites did not complete.",
  "Structured test-step outcomes were unavailable.",
]);
const RELEASE_STEP_LANE_GROUPS = Object.freeze([
  { laneId: "api-unit-isolated", labels: ["API unit tests (release shard 1/7)"] },
  {
    laneId: "api-integration-shards",
    labels: [
      "API integration tests (release shard 2/7)",
      "API integration tests (release shard 3/7)",
      "API integration tests (release shard 4/7)",
    ],
  },
  { laneId: "api-roles", labels: ["API role/capability tests (release shard 5/7)"] },
  { laneId: "api-sync", labels: ["API sync tests (release shard 6/7)"] },
  { laneId: "api-sync-sse", labels: ["API sync SSE tests (release shard 7/7)"] },
  {
    laneId: "api-sync-convergence",
    labels: ["API sync convergence tests (isolated PostgreSQL)"],
  },
  {
    laneId: "shared-library-focused",
    labels: [
      "production rules tests",
      "inventory math tests",
      "spec reconcile tests",
      "scheduled recipe check tests",
      "spec export tests",
    ],
  },
  {
    laneId: "import-export-focused",
    labels: [
      "spec import tests",
      "spec reconcile tests",
      "spec export tests",
      "corpus tests",
    ],
  },
  { laneId: "startup-clean-start", labels: ["clean-start smoke"] },
  { laneId: "browser-smoke", labels: ["browser smoke tests"] },
  { laneId: "browser-calendar", labels: ["browser calendar tests"] },
  { laneId: "browser-a11y", labels: ["browser accessibility tests"] },
  { laneId: "browser-webkit", labels: ["browser WebKit smoke"] },
  {
    laneId: "browser-compatibility",
    labels: ["browser phone/tablet WebKit compatibility"],
    fullOnly: true,
  },
  { laneId: "browser-main", labels: ["full browser E2E suite"], fullOnly: true },
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

export function classifyProcessOutcome({ exitCode, signal, spawnError }) {
  if (spawnError) return "INFRASTRUCTURE_ERROR";
  if (signal === "SIGINT" || signal === "SIGTERM") return "CANCELLED";
  if (signal) return "INFRASTRUCTURE_ERROR";
  if (exitCode === 0) return "PASS";
  if (exitCode === 124) return "TIMEOUT";
  if (exitCode === 130 || exitCode === 143) return "CANCELLED";
  return "FAIL";
}

function normalizedReleaseStepStatus(status, releaseOutcome) {
  switch (status) {
    case "PASS":
      return "PASS";
    case "FAIL":
      return "FAIL";
    case "INFRASTRUCTURE TIMEOUT":
      return "TIMEOUT";
    case "INFRASTRUCTURE ERROR":
      return "INFRASTRUCTURE_ERROR";
    case "BLOCKED":
      return "BLOCKED";
    case "NOT REACHED":
      return releaseOutcome === "CANCELLED" ? "CANCELLED" : "BLOCKED";
    default:
      return "INFRASTRUCTURE_ERROR";
  }
}

export function mapReleaseStepOutcomes(
  catalog,
  outcomes,
  releaseLaneId,
  releaseOutcome,
) {
  const releaseStatuses = [
    "PASS",
    "FAIL",
    "INFRASTRUCTURE TIMEOUT",
    "INFRASTRUCTURE ERROR",
    "BLOCKED",
    "NOT REACHED",
  ];
  if (
    !Array.isArray(outcomes) ||
    outcomes.length > 256 ||
    outcomes.some(
      (outcome) =>
        !hasOnlyKeys(outcome, ["label", "status", "durationMs"]) ||
        typeof outcome.label !== "string" ||
        outcome.label.length < 1 ||
        outcome.label.length > 160 ||
        !releaseStatuses.includes(outcome.status) ||
        !Number.isFinite(outcome.durationMs) ||
        outcome.durationMs < 0 ||
        outcome.durationMs > 8 * 60 * 60 * 1000,
    )
  ) {
    throw new Error("Release step outcome evidence has an invalid shape.");
  }
  const byLabel = new Map(
    outcomes.map((outcome) => [outcome.label, outcome]),
  );
  const knownLabels = new Set(
    RELEASE_STEP_LANE_GROUPS.flatMap((group) => group.labels),
  );
  if (outcomes.some((outcome) => !knownLabels.has(outcome.label))) {
    throw new Error("Release step outcome included an unknown test lane label.");
  }
  const catalogIds = new Set(catalog.lanes.map((lane) => lane.id));
  const mapped = [];
  for (const group of RELEASE_STEP_LANE_GROUPS) {
    if (group.fullOnly && releaseLaneId !== "release-full") continue;
    if (!catalogIds.has(group.laneId)) {
      throw new Error("Release step mapping references a missing catalog lane.");
    }
    const steps = group.labels
      .map((label) => byLabel.get(label))
      .filter(Boolean);
    const incomplete = steps.length !== group.labels.length;
    if (steps.length === 0) {
      mapped.push({
        laneId: group.laneId,
        status: "INFRASTRUCTURE_ERROR",
        reason: "Structured test-step outcomes were unavailable.",
        durationMs: 0,
        failure: { kind: "infrastructure" },
      });
      continue;
    }
    const statuses = steps.map((step) =>
      normalizedReleaseStepStatus(step.status, releaseOutcome),
    );
    const priority = [
      "CANCELLED",
      "TIMEOUT",
      "INFRASTRUCTURE_ERROR",
      "FAIL",
      "BLOCKED",
      "PASS",
    ];
    let status = priority.find((candidate) => statuses.includes(candidate));
    if (incomplete && ["PASS", "BLOCKED"].includes(status)) {
      status = "INFRASTRUCTURE_ERROR";
    }
    const durationMs = steps
      .filter((step) => !["BLOCKED", "NOT REACHED"].includes(step.status))
      .reduce((total, step) => total + step.durationMs, 0);
    mapped.push({
      laneId: group.laneId,
      status,
      reason:
        status === "PASS"
          ? undefined
          : status === "TIMEOUT"
            ? "The test command reached its timeout."
            : status === "CANCELLED"
              ? "The test command was interrupted."
              : status === "INFRASTRUCTURE_ERROR"
                ? "The test process could not start or was terminated unexpectedly."
          : status === "FAIL"
                  ? "The test command exited unsuccessfully."
            : status === "BLOCKED"
              ? "Required prerequisites did not complete."
              : "Structured test-step outcomes were unavailable.",
      durationMs: status === "BLOCKED" ? null : durationMs,
      failure:
        status === "PASS" || status === "BLOCKED"
          ? null
          : boundedFailure(status),
    });
  }
  return mapped;
}

export function boundedFailure(status, { exitCode, signal, spawnError } = {}) {
  if (status === "PASS") return undefined;
  if (status === "TIMEOUT") {
    return { kind: "timeout", ...(exitCode === 124 ? { exitCode } : {}) };
  }
  if (status === "CANCELLED") {
    return {
      kind: "cancelled",
      ...(signal && ["SIGINT", "SIGTERM"].includes(signal) ? { signal } : {}),
      ...(exitCode === 130 || exitCode === 143 ? { exitCode } : {}),
    };
  }
  if (status === "INFRASTRUCTURE_ERROR") {
    const code = typeof spawnError === "string" && /^[A-Z0-9_]{1,32}$/.test(spawnError)
      ? spawnError
      : undefined;
    return { kind: "infrastructure", ...(code ? { processErrorCode: code } : {}) };
  }
  return {
    kind: "test_process_failure",
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

export function resolveReportPath(value = process.env.TEST_RESULTS_REPORT_PATH) {
  const selected = value || DEFAULT_REPORT_PATH;
  const fullPath = isAbsolute(selected)
    ? resolve(selected)
    : resolve(REPOSITORY_ROOT, selected);
  const rel = relative(REPOSITORY_ROOT, fullPath);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("The test-results report path must stay inside the workspace.");
  }
  return fullPath;
}

export function getRunIdentity(env = process.env, runId = randomUUID()) {
  const ciRunId =
    env.GITHUB_RUN_ID && /^[0-9]{1,32}$/.test(env.GITHUB_RUN_ID)
      ? env.GITHUB_RUN_ID
      : undefined;
  const attempt =
    env.GITHUB_RUN_ATTEMPT && /^[0-9]{1,8}$/.test(env.GITHUB_RUN_ATTEMPT)
      ? env.GITHUB_RUN_ATTEMPT
      : undefined;
  return {
    id: ciRunId ? `github:${ciRunId}:${attempt ?? "unknown"}` : `local:${runId}`,
    workflow: safeIdentity(env.GITHUB_WORKFLOW, 120),
    job: safeIdentity(env.GITHUB_JOB, 120),
    event: safeIdentity(env.GITHUB_EVENT_NAME, 80),
    runId: ciRunId,
    attempt: attempt ? Number(attempt) : undefined,
  };
}

function safeIdentity(value, maxLength) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength && /^[\w .:/-]+$/.test(trimmed)
    ? trimmed
    : undefined;
}

export function getSourceRevision(env = process.env, cwd = REPOSITORY_ROOT) {
  const fromWorkflow = env.GITHUB_SHA?.trim();
  if (fromWorkflow && /^[a-f0-9]{40,64}$/i.test(fromWorkflow)) {
    return fromWorkflow.toLowerCase();
  }
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[a-f0-9]{40,64}$/i.test(revision) ? revision.toLowerCase() : "unknown";
  } catch {
    return "unknown";
  }
}

export function getEnvironment(env = process.env) {
  return {
    kind: env.GITHUB_ACTIONS === "true" || env.CI === "true" ? "ci" : "local",
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
  };
}

export async function readLaneCatalog(path = CATALOG_PATH) {
  const catalog = JSON.parse(await readFile(path, "utf8"));
  if (
    !isRecord(catalog) ||
    catalog.schemaVersion !== TEST_RESULTS_SCHEMA_VERSION ||
    !Array.isArray(catalog.lanes)
  ) {
    throw new Error("The test-lane catalog has an unsupported shape or version.");
  }
  const ids = new Set();
  for (const lane of catalog.lanes) {
    if (
      !isRecord(lane) ||
      typeof lane.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,79}$/.test(lane.id) ||
      ids.has(lane.id) ||
      typeof lane.surface !== "string" ||
      !lane.surface.trim() ||
      typeof lane.trigger !== "string" ||
      !lane.trigger.trim() ||
      typeof lane.runsByDefault !== "boolean" ||
      typeof lane.safety !== "string" ||
      !lane.safety.trim() ||
      !Array.isArray(lane.environment) ||
      lane.environment.some((value) => typeof value !== "string" || !value.trim()) ||
      !Array.isArray(lane.prerequisites) ||
      lane.prerequisites.some((value) => typeof value !== "string" || !value.trim()) ||
      (lane.requiredEnv !== undefined &&
        (!Array.isArray(lane.requiredEnv) ||
          lane.requiredEnv.some(
            (name) => typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name),
          ))) ||
      (lane.localRoutine !== undefined && typeof lane.localRoutine !== "boolean") ||
      (typeof lane.command !== "string" && typeof lane.owner !== "string")
    ) {
      throw new Error("The test-lane catalog contains an invalid or duplicate lane.");
    }
    ids.add(lane.id);
  }
  return catalog;
}

function initialLaneResult(lane, env) {
  const missingEnv = (lane.requiredEnv ?? []).filter(
    (name) => typeof env[name] !== "string" || env[name].trim() === "",
  );
  if (missingEnv.length > 0) {
    return {
      laneId: lane.id,
      status: "BLOCKED",
      reason: `Required environment is unavailable: ${missingEnv.join(", ")}.`,
      attempted: false,
      durationMs: null,
      counts: null,
      failure: null,
      artifactReferences: [],
    };
  }
  return {
    laneId: lane.id,
    status: "NOT_RUN",
    reason: lane.runsByDefault
      ? "This lane was not executed in this report's run scope."
      : "This lane is optional or manual and was not requested.",
    attempted: false,
    durationMs: null,
    counts: null,
    failure: null,
    artifactReferences: [],
  };
}

export function createTestResultsReport({
  catalog,
  revision,
  runIdentity,
  environment,
  artifactName,
  now = new Date().toISOString(),
  env = process.env,
}) {
  const artifactReferences =
    typeof artifactName === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(artifactName)
      ? [{ kind: "github-actions-artifact", name: artifactName }]
      : [];
  return {
    schemaVersion: TEST_RESULTS_SCHEMA_VERSION,
    reportKind: "automated-test-results",
    createdAt: now,
    updatedAt: now,
    sourceRevision: /^[a-f0-9]{40,64}$/i.test(revision) ? revision.toLowerCase() : "unknown",
    run: runIdentity,
    environment,
    countsPolicy: "Counts are null unless captured from a trusted structured test summary.",
    artifactReferences,
    lanes: catalog.lanes.map((lane) => ({
      ...initialLaneResult(lane, env),
      commandIdentity: lane.command ?? lane.owner,
    })),
  };
}

export function validateReport(report, catalog) {
  if (
    !isRecord(report) ||
    !hasOnlyKeys(report, [
      "schemaVersion",
      "reportKind",
      "createdAt",
      "updatedAt",
      "sourceRevision",
      "run",
      "environment",
      "countsPolicy",
      "artifactReferences",
      "lanes",
    ]) ||
    report.schemaVersion !== TEST_RESULTS_SCHEMA_VERSION ||
    report.reportKind !== "automated-test-results" ||
    !/^(unknown|[a-f0-9]{40,64})$/i.test(report.sourceRevision) ||
    !isIsoDate(report.createdAt) ||
    !isIsoDate(report.updatedAt) ||
    !Array.isArray(report.lanes) ||
    report.lanes.length !== catalog.lanes.length ||
    !isRecord(report.run) ||
    !hasOnlyKeys(report.run, [
      "id",
      "workflow",
      "job",
      "event",
      "runId",
      "attempt",
    ]) ||
    !isValidRunIdentity(report.run) ||
    !hasOnlyKeys(report.environment, [
      "kind",
      "platform",
      "architecture",
      "nodeVersion",
    ]) ||
    !isValidEnvironment(report.environment) ||
    report.countsPolicy !==
      "Counts are null unless captured from a trusted structured test summary." ||
    !isValidArtifactReferences(report.artifactReferences)
  ) {
    throw new Error("The test-results report failed its schema or provenance checks.");
  }
  const expected = new Map(catalog.lanes.map((lane) => [lane.id, lane]));
  const seen = new Set();
  for (const result of report.lanes) {
    const lane = expected.get(result?.laneId);
    if (
      !lane ||
      !hasOnlyKeys(result, [
        "laneId",
        "commandIdentity",
        "status",
        "reason",
        "attempted",
        "durationMs",
        "counts",
        "failure",
        "artifactReferences",
        "startedAt",
        "finishedAt",
      ]) ||
      seen.has(result.laneId) ||
      !TEST_RESULT_STATUSES.includes(result.status) ||
      typeof result.attempted !== "boolean" ||
      (result.durationMs !== null &&
        (!Number.isFinite(result.durationMs) || result.durationMs < 0)) ||
      (result.counts !== null) ||
      (result.status !== "PASS" &&
        (typeof result.reason !== "string" ||
          result.reason.length === 0 ||
          !isSafeReason(result.reason))) ||
      result.commandIdentity !== (lane.command ?? lane.owner) ||
      !isValidArtifactReferences(result.artifactReferences) ||
      (result.status === "PASS" && result.reason !== undefined) ||
      (result.status !== "NOT_RUN" &&
        result.status !== "BLOCKED" &&
        (!result.attempted || result.durationMs === null)) ||
      (result.status === "PASS" && result.failure !== null) ||
      (result.status === "FAIL" && result.failure?.kind !== "test_process_failure") ||
      (result.status === "TIMEOUT" && result.failure?.kind !== "timeout") ||
      (result.status === "CANCELLED" && result.failure?.kind !== "cancelled") ||
      (result.status === "INFRASTRUCTURE_ERROR" &&
        result.failure?.kind !== "infrastructure") ||
      (["NOT_RUN", "BLOCKED"].includes(result.status) &&
        (result.attempted ||
          result.durationMs !== null ||
          result.failure !== null ||
          result.startedAt !== undefined ||
          result.finishedAt !== undefined)) ||
      (result.attempted &&
        (!isIsoDate(result.startedAt) ||
          !isIsoDate(result.finishedAt) ||
          Date.parse(result.finishedAt) < Date.parse(result.startedAt))) ||
      (!result.attempted &&
        (result.startedAt !== undefined || result.finishedAt !== undefined))
    ) {
      throw new Error("The test-results report has a missing, invalid, or mismatched lane.");
    }
    if (result.failure !== null) {
      validateFailureMetadata(result.failure);
    }
    seen.add(result.laneId);
  }
  if (seen.size !== expected.size) {
    throw new Error("The test-results report does not account for every catalog lane.");
  }
  return true;
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isValidRunIdentity(run) {
  return (
    typeof run.id === "string" &&
    /^(?:github:[0-9]{1,32}:(?:[0-9]{1,8}|unknown)|local:[\w-]{1,64})$/.test(
      run.id,
    ) &&
    (run.workflow === undefined || safeIdentity(run.workflow, 120) === run.workflow) &&
    (run.job === undefined || safeIdentity(run.job, 120) === run.job) &&
    (run.event === undefined || safeIdentity(run.event, 80) === run.event) &&
    (run.runId === undefined || /^[0-9]{1,32}$/.test(run.runId)) &&
    (run.attempt === undefined ||
      (Number.isInteger(run.attempt) && run.attempt > 0 && run.attempt <= 99_999_999))
  );
}

function isValidEnvironment(environment) {
  return (
    ["local", "ci"].includes(environment.kind) &&
    typeof environment.platform === "string" &&
    /^[a-zA-Z0-9._-]{1,40}$/.test(environment.platform) &&
    typeof environment.architecture === "string" &&
    /^[a-zA-Z0-9._-]{1,40}$/.test(environment.architecture) &&
    typeof environment.nodeVersion === "string" &&
    /^v\d+\.\d+\.\d+$/.test(environment.nodeVersion)
  );
}

function isValidArtifactReferences(references) {
  return (
    Array.isArray(references) &&
    references.every(
      (reference) =>
        isRecord(reference) &&
        hasOnlyKeys(reference, ["kind", "name"]) &&
        reference.kind === "github-actions-artifact" &&
        typeof reference.name === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(reference.name),
    )
  );
}

function isSafeReason(reason) {
  return (
    SAFE_REASONS.has(reason) ||
    /^Required environment is unavailable: [A-Z][A-Z0-9_]*(?:, [A-Z][A-Z0-9_]*)*\.$/.test(
      reason,
    )
  );
}

function validateFailureMetadata(failure) {
  if (
    !isRecord(failure) ||
    !["timeout", "cancelled", "infrastructure", "test_process_failure"].includes(failure.kind) ||
    Object.keys(failure).some(
      (key) => !["kind", "exitCode", "signal", "processErrorCode"].includes(key),
    ) ||
    (failure.exitCode !== undefined && !Number.isInteger(failure.exitCode)) ||
    (failure.signal !== undefined && !["SIGINT", "SIGTERM"].includes(failure.signal)) ||
    (failure.processErrorCode !== undefined &&
      !/^[A-Z0-9_]{1,32}$/.test(failure.processErrorCode))
  ) {
    throw new Error("The report contains unbounded failure metadata.");
  }
}

export async function writeReport(path, report, catalog) {
  validateReport(report, catalog);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

async function readReport(path, catalog) {
  let report;
  try {
    report = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Test-results report is missing or unreadable; initialize a new run.");
  }
  validateReport(report, catalog);
  return report;
}

function assertSameRun(report, env) {
  const expectedRevision = getSourceRevision(env);
  if (report.sourceRevision !== expectedRevision) {
    throw new Error("Refusing to combine test results from different source revisions.");
  }
  const current = getRunIdentity(env, report.run.id.replace(/^local:/, ""));
  for (const key of ["id", "workflow", "job", "event", "runId", "attempt"]) {
    if (
      current[key] !== undefined &&
      report.run[key] !== current[key]
    ) {
      throw new Error("Refusing to combine test results from different workflow runs.");
    }
  }
}

export async function recordLaneResult({
  reportPath,
  catalog,
  laneId,
  status,
  reason,
  durationMs,
  failure,
  artifactName,
  now = new Date().toISOString(),
  env = process.env,
}) {
  if (!TEST_RESULT_STATUSES.includes(status)) {
    throw new Error("Unsupported test lane status.");
  }
  const lane = catalog.lanes.find((item) => item.id === laneId);
  if (!lane) throw new Error("Unknown test lane.");
  if (status !== "PASS" && (typeof reason !== "string" || !reason.trim())) {
    throw new Error("A non-passing lane must include a reason.");
  }
  if (status !== "PASS" && !isSafeReason(reason)) {
    throw new Error("Test-results reasons must use bounded, non-sensitive wording.");
  }
  const report = await readReport(reportPath, catalog);
  assertSameRun(report, env);
  const result = report.lanes.find((item) => item.laneId === laneId);
  result.status = status;
  result.reason = status === "PASS" ? undefined : reason.slice(0, 240);
  result.attempted = !["NOT_RUN", "BLOCKED"].includes(status);
  result.durationMs =
    Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null;
  result.counts = null;
  result.failure = failure ?? null;
  if (artifactName && !report.artifactReferences.some((ref) => ref.name === artifactName)) {
    report.artifactReferences.push({
      kind: "github-actions-artifact",
      name: artifactName,
    });
  }
  if (artifactName) result.artifactReferences = [{ kind: "github-actions-artifact", name: artifactName }];
  if (result.attempted) {
    result.startedAt = now;
    result.finishedAt = now;
  } else {
    delete result.startedAt;
    delete result.finishedAt;
  }
  report.updatedAt = now;
  validateReport(report, catalog);
  await writeReport(reportPath, report, catalog);
}

async function markLaneBlocked(laneId) {
  const catalog = await readLaneCatalog();
  const path = resolveReportPath();
  await recordLaneResult({
    reportPath: path,
    catalog,
    laneId,
    status: "BLOCKED",
    reason: "Required prerequisites did not complete.",
    durationMs: null,
    env: process.env,
  });
}

async function initialize({ env = process.env } = {}) {
  const catalog = await readLaneCatalog();
  const path = resolveReportPath(env.TEST_RESULTS_REPORT_PATH);
  await rm(`${path}.release-steps.json`, { force: true });
  const report = createTestResultsReport({
    catalog,
    revision: getSourceRevision(env),
    runIdentity: getRunIdentity(env),
    environment: getEnvironment(env),
    artifactName: env.TEST_RESULTS_ARTIFACT_NAME,
    env,
  });
  await writeReport(path, report, catalog);
  return { catalog, path, report };
}

function parseFailure(status, result) {
  return boundedFailure(status, result);
}

function runChild(command, args, extraEnv = {}) {
  return new Promise((resolveResult) => {
    const started = Date.now();
    let finished = false;
    let child;
    const done = (exitCode, signal, spawnError) => {
      if (finished) return;
      finished = true;
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
      const status = classifyProcessOutcome({ exitCode, signal, spawnError });
      resolveResult({
        status,
        exitCode,
        signal,
        spawnError,
        durationMs: Math.max(0, Date.now() - started),
        reason:
          status === "PASS"
            ? undefined
            : status === "TIMEOUT"
              ? "The test command reached its timeout."
              : status === "CANCELLED"
                ? "The test command was interrupted."
                : status === "INFRASTRUCTURE_ERROR"
                  ? "The test process could not start or was terminated unexpectedly."
                  : "The test command exited unsuccessfully.",
      });
    };
    const interrupt = () => child?.kill("SIGINT");
    const terminate = () => child?.kill("SIGTERM");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    try {
      child = spawn(command, args, {
        cwd: REPOSITORY_ROOT,
        env: { ...process.env, ...extraEnv },
        stdio: "inherit",
      });
      child.once("error", (error) => done(null, null, error.code ?? "UNKNOWN"));
      child.once("close", (exitCode, signal) => done(exitCode, signal, null));
    } catch (error) {
      done(null, null, error?.code ?? "UNKNOWN");
    }
  });
}

async function runLane(laneId, command, args) {
  const catalog = await readLaneCatalog();
  const path = resolveReportPath();
  const lane = catalog.lanes.find((item) => item.id === laneId);
  if (!lane) throw new Error("Unknown test lane.");
  if (
    !lane.command ||
    normalizeCommand([command, ...args].join(" ")) !== normalizeCommand(lane.command)
  ) {
    throw new Error("The invoked command does not match the maintained lane catalog.");
  }
  const existing = await readReport(path, catalog);
  assertSameRun(existing, process.env);
  const start = new Date().toISOString();
  const isReleaseLane = ["release-standard", "release-full"].includes(laneId);
  const releaseSidecarPath = `${path}.release-steps.json`;
  if (isReleaseLane) await rm(releaseSidecarPath, { force: true });
  const outcome = await runChild(
    command,
    args,
    isReleaseLane
      ? {
          TEST_RESULTS_REPORT_ID: existing.run.id,
          TEST_RESULTS_RELEASE_STEPS_PATH: releaseSidecarPath,
        }
      : {},
  );
  const end = new Date().toISOString();
  if (isReleaseLane) {
    try {
      const sidecar = JSON.parse(await readFile(releaseSidecarPath, "utf8"));
      if (sidecar.runId !== existing.run.id || !Array.isArray(sidecar.outcomes)) {
        throw new Error("Release step outcomes came from another run.");
      }
      const mapped = mapReleaseStepOutcomes(
        catalog,
        sidecar.outcomes,
        laneId,
        outcome.status,
      );
      for (const result of mapped) {
        await recordLaneResult({
          reportPath: path,
          catalog,
          ...result,
          env: process.env,
        });
      }
    } catch {
      const mappedGroups = RELEASE_STEP_LANE_GROUPS.filter(
        (group) => !group.fullOnly || laneId === "release-full",
      );
      for (const group of mappedGroups) {
        await recordLaneResult({
          reportPath: path,
          catalog,
          laneId: group.laneId,
          status: "INFRASTRUCTURE_ERROR",
          reason: "Structured test-step outcomes were unavailable.",
          durationMs: 0,
          failure: { kind: "infrastructure" },
          env: process.env,
        });
      }
    } finally {
      await rm(releaseSidecarPath, { force: true });
    }
  }
  await recordLaneResult({
    reportPath: path,
    catalog,
    laneId,
    status: outcome.status,
    reason: outcome.reason,
    durationMs: outcome.durationMs,
    failure: parseFailure(outcome.status, outcome),
    artifactName: process.env.TEST_RESULTS_ARTIFACT_NAME,
    now: end,
  });
  const updated = await readReport(path, catalog);
  const item = updated.lanes.find((result) => result.laneId === laneId);
  item.startedAt = start;
  item.finishedAt = end;
  await writeReport(path, updated, catalog);
  return outcome.status;
}

function normalizeCommand(command) {
  return command.replaceAll(/["']/g, "").replaceAll(/\s+/g, " ").trim();
}

async function runLocalRoutine() {
  const { catalog, path } = await initialize();
  const lanes = catalog.lanes.filter((lane) => lane.localRoutine === true);
  if (lanes.length === 0) throw new Error("No lanes are configured for the local routine suite.");
  let failed = false;
  for (const lane of lanes) {
    const [command, ...args] = localCommandFor(lane);
    const status = await runLane(lane.id, command, args);
    if (status !== "PASS") failed = true;
  }
  console.log(`Test results: ${relative(REPOSITORY_ROOT, path)}`);
  if (failed) process.exitCode = 1;
}

function localCommandFor(lane) {
  switch (lane.id) {
    case "ci-scripts-routine":
      return ["pnpm", "--filter", "@workspace/scripts", "run", "test"];
    case "ci-client-unit":
      return ["pnpm", "--filter", "@workspace/run-calculator", "test"];
    case "ci-library-sweep":
      return ["pnpm", "-r", "--filter", "./lib/**", "--if-present", "test"];
    default:
      throw new Error(`No safe local routine command is defined for ${lane.id}.`);
  }
}

async function main(argv) {
  const [mode, ...args] = argv;
  if (mode === "init") {
    const { path } = await initialize();
    console.log(`Initialized test-results report: ${relative(REPOSITORY_ROOT, path)}`);
    return;
  }
  if (mode === "run") {
    const laneIndex = args.indexOf("--lane");
    const separator = args.indexOf("--");
    const laneId = laneIndex >= 0 ? args[laneIndex + 1] : undefined;
    if (!laneId || separator < 0 || separator + 1 >= args.length) {
      throw new Error("Usage: test-results.mjs run --lane <id> -- <command> [args...]");
    }
    const [command, ...commandArgs] = args.slice(separator + 1);
    const status = await runLane(laneId, command, commandArgs);
    if (status !== "PASS") process.exitCode = 1;
    return;
  }
  if (mode === "local") {
    await runLocalRoutine();
    return;
  }
  if (mode === "block") {
    const laneIndex = args.indexOf("--lane");
    const laneId = laneIndex >= 0 ? args[laneIndex + 1] : undefined;
    if (!laneId) throw new Error("Usage: test-results.mjs block --lane <id>");
    await markLaneBlocked(laneId);
    return;
  }
  throw new Error("Usage: test-results.mjs <init|run|local|block>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "Test-results command failed.");
    process.exitCode = 1;
  });
}
