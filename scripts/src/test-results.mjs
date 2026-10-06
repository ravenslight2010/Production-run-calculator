#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_RESULTS_SCHEMA_VERSION = 1;
export const BROWSER_MAIN_COUNT_SUMMARY_SUFFIX = ".browser-main-counts.json";
export const TEST_RESULT_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "INFRASTRUCTURE_ERROR",
  "TIMEOUT",
  "CANCELLED",
  "NOT_RUN",
  "BLOCKED",
]);

const STRUCTURED_BROWSER_CASE_STATUSES = new Set([
  "passed",
  "failed",
  "timedout",
  "interrupted",
  "skipped",
  "not-run",
]);
const STRUCTURED_BROWSER_FAILURE_CLASSIFICATIONS = Object.freeze([
  "product",
  "test-setup",
  "infrastructure",
  "optional-environment-gap",
]);
const MAX_STRUCTURED_TEST_CASES = 100_000;

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(scriptDir, "../..");
const DEFAULT_REPORT_PATH = ".local/test-evidence/latest.json";
const CATALOG_PATH = resolve(REPOSITORY_ROOT, "docs/test-lane-catalog.json");
const MAX_TEST_RESULTS_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_AGGREGATION_REPORTS = 256;
const MAX_AGGREGATION_ENTRIES = 8192;
const MAX_AGGREGATION_DEPTH = 12;
const MAX_VITEST_COUNT_SUMMARIES = 128;
const MAX_VITEST_COUNT_SUMMARY_BYTES = 4096;
const API_RELEASE_VITEST_PACKAGE = "@workspace/api-server";
const API_RELEASE_VITEST_STEP_LABEL = "API unit tests (release shard 1/7)";
const VITEST_COUNT_REPORTER_PATH = resolve(
  scriptDir,
  "vitest-count-reporter.mjs",
);
const VITEST_REPORTER_LANES = new Set([
  "ci-api-postgres",
  "ci-client-unit",
  "ci-library-sweep",
]);
const TEST_RESULTS_COUNTS_POLICY =
  "Counts are null unless captured from a current-run, revision-matched structured test summary with consistent bounded totals.";
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

function isValidTestCounts(counts) {
  if (
    !hasOnlyKeys(counts, [
      "total",
      "completed",
      "passed",
      "failed",
      "skipped",
      "notRun",
    ]) ||
    Object.values(counts).some(
      (value) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > MAX_STRUCTURED_TEST_CASES,
    )
  ) {
    return false;
  }
  return (
    counts.completed === counts.passed + counts.failed + counts.skipped &&
    counts.total === counts.completed + counts.notRun
  );
}

function combineTestCounts(countsList) {
  if (
    countsList.length === 0 ||
    countsList.some((counts) => !isValidTestCounts(counts))
  ) {
    return null;
  }
  const combined = countsList.reduce(
    (total, counts) => ({
      total: total.total + counts.total,
      completed: total.completed + counts.completed,
      passed: total.passed + counts.passed,
      failed: total.failed + counts.failed,
      skipped: total.skipped + counts.skipped,
      notRun: total.notRun + counts.notRun,
    }),
    { total: 0, completed: 0, passed: 0, failed: 0, skipped: 0, notRun: 0 },
  );
  return isValidTestCounts(combined) ? combined : null;
}

export function parseStructuredVitestTestCounts(
  summary,
  { expectedRunId, expectedRevision, expectedPackageName } = {},
) {
  if (
    !hasOnlyKeys(summary, [
      "schemaVersion",
      "runner",
      "runId",
      "sourceRevision",
      "packageName",
      "totals",
    ]) ||
    summary.schemaVersion !== 1 ||
    summary.runner !== "vitest" ||
    typeof expectedRunId !== "string" ||
    !/^[a-zA-Z0-9:._-]{1,200}$/.test(expectedRunId) ||
    summary.runId !== expectedRunId ||
    typeof expectedRevision !== "string" ||
    !/^[a-f0-9]{40,64}$/i.test(expectedRevision) ||
    summary.sourceRevision !== expectedRevision ||
    typeof expectedPackageName !== "string" ||
    !/^@workspace\/[a-z0-9-]{2,80}$/.test(expectedPackageName) ||
    summary.packageName !== expectedPackageName ||
    !hasOnlyKeys(summary.totals, [
      "total",
      "passed",
      "failed",
      "skipped",
      "notRun",
    ]) ||
    Object.values(summary.totals).some(
      (value) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > MAX_STRUCTURED_TEST_CASES,
    )
  ) {
    return null;
  }
  const { total, passed, failed, skipped, notRun } = summary.totals;
  const completed = passed + failed + skipped;
  const counts = { total, completed, passed, failed, skipped, notRun };
  if (
    total < 1 ||
    total !== completed + notRun ||
    !isValidTestCounts(counts)
  ) {
    return null;
  }
  return counts;
}

export async function readStructuredVitestTestCounts({
  directory,
  expectedRunId,
  expectedRevision,
  expectedPackages,
}) {
  if (
    typeof directory !== "string" ||
    !Array.isArray(expectedPackages) ||
    expectedPackages.length === 0 ||
    expectedPackages.length > MAX_VITEST_COUNT_SUMMARIES ||
    expectedPackages.some(
      (name) => typeof name !== "string" || !/^@workspace\/[a-z0-9-]{2,80}$/.test(name),
    ) ||
    new Set(expectedPackages).size !== expectedPackages.length
  ) {
    return null;
  }
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    if (
      entries.length !== expectedPackages.length ||
      entries.some(
        (entry) =>
          !entry.isFile() ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.json$/.test(entry.name),
      )
    ) {
      return null;
    }
    const expected = new Set(expectedPackages);
    const received = new Set();
    const countsList = [];
    for (const entry of entries) {
      const summaryPath = join(directory, entry.name);
      const summaryStat = await stat(summaryPath);
      if (
        !summaryStat.isFile() ||
        summaryStat.size < 1 ||
        summaryStat.size > MAX_VITEST_COUNT_SUMMARY_BYTES
      ) {
        return null;
      }
      const summary = JSON.parse(await readFile(summaryPath, "utf8"));
      if (
        !expected.has(summary?.packageName) ||
        received.has(summary.packageName)
      ) {
        return null;
      }
      const counts = parseStructuredVitestTestCounts(summary, {
        expectedRunId,
        expectedRevision,
        expectedPackageName: summary.packageName,
      });
      if (!counts) return null;
      received.add(summary.packageName);
      countsList.push(counts);
    }
    if (received.size !== expected.size) return null;
    return combineTestCounts(countsList);
  } catch {
    return null;
  }
}

export function parseFullBrowserTestCounts(
  summary,
  {
    expectedRunId,
    expectedRevision,
    notBeforeMs,
    notAfterMs,
    expectedCaseCount,
    expectedReleaseStatus,
  } = {},
) {
  if (
    !hasOnlyKeys(summary, [
      "schemaVersion",
      "browser",
      "runId",
      "revision",
      "result",
      "generatedAt",
      "counts",
    ]) ||
    summary.schemaVersion !== 1 ||
    summary.browser !== "chromium" ||
    typeof expectedRunId !== "string" ||
    !isValidRunIdentity({ id: expectedRunId }) ||
    summary.runId !== expectedRunId ||
    typeof expectedRevision !== "string" ||
    !expectedRevision ||
    summary.revision !== expectedRevision ||
    !["passed", "failed", "timedout", "interrupted"].includes(summary.result) ||
    !isIsoDate(summary.generatedAt) ||
    !Number.isFinite(notBeforeMs) ||
    !Number.isFinite(notAfterMs) ||
    Date.parse(summary.generatedAt) < notBeforeMs ||
    Date.parse(summary.generatedAt) > notAfterMs ||
    !Number.isInteger(expectedCaseCount) ||
    expectedCaseCount < 1 ||
    expectedCaseCount > MAX_STRUCTURED_TEST_CASES ||
    !["PASS", "FAIL", "INFRASTRUCTURE TIMEOUT", "INFRASTRUCTURE ERROR"].includes(
      expectedReleaseStatus,
    ) ||
    (expectedReleaseStatus === "PASS" && summary.result !== "passed") ||
    (expectedReleaseStatus !== "PASS" && summary.result === "passed") ||
    !isValidTestCounts(summary.counts) ||
    summary.counts.total !== expectedCaseCount ||
    (expectedReleaseStatus === "PASS" &&
      (summary.counts.failed !== 0 || summary.counts.notRun !== 0))
  ) {
    return null;
  }
  return summary.counts;
}

export function parseStructuredBrowserTestCounts(
  summary,
  {
    expectedRevision,
    notBeforeMs,
    notAfterMs,
    expectedProjects,
    expectedReleaseStatus,
  } = {},
) {
  if (
    !hasOnlyKeys(summary, [
      "schemaVersion",
      "browser",
      "revision",
      "environment",
      "result",
      "generatedAt",
      "caseCount",
      "completedCount",
      "failureCount",
      "failureClassifications",
      "cases",
    ]) ||
    summary.schemaVersion !== 1 ||
    summary.browser !== "webkit" ||
    typeof expectedRevision !== "string" ||
    summary.revision !== expectedRevision ||
    !["ci", "development"].includes(summary.environment) ||
    !["passed", "failed", "timedout", "interrupted"].includes(summary.result) ||
    !isIsoDate(summary.generatedAt) ||
    !Number.isFinite(notBeforeMs) ||
    !Number.isFinite(notAfterMs) ||
    !Array.isArray(expectedProjects) ||
    expectedProjects.length === 0 ||
    !["PASS", "FAIL", "INFRASTRUCTURE TIMEOUT", "INFRASTRUCTURE ERROR"].includes(
      expectedReleaseStatus,
    ) ||
    (expectedReleaseStatus === "PASS" && summary.result !== "passed") ||
    (expectedReleaseStatus === "FAIL" && summary.result === "passed") ||
    Date.parse(summary.generatedAt) < notBeforeMs ||
    Date.parse(summary.generatedAt) > notAfterMs ||
    !Number.isInteger(summary.caseCount) ||
    summary.caseCount < 0 ||
    summary.caseCount > MAX_STRUCTURED_TEST_CASES ||
    summary.caseCount !== summary.cases?.length ||
    !Array.isArray(summary.cases) ||
    !isRecord(summary.failureClassifications) ||
    !hasOnlyKeys(
      summary.failureClassifications,
      STRUCTURED_BROWSER_FAILURE_CLASSIFICATIONS,
    )
  ) {
    return null;
  }

  const counts = {
    total: summary.cases.length,
    completed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    notRun: 0,
  };
  const failureClassifications = Object.fromEntries(
    STRUCTURED_BROWSER_FAILURE_CLASSIFICATIONS.map((classification) => [
      classification,
      0,
    ]),
  );
  for (const testCase of summary.cases) {
    if (
      !hasOnlyKeys(testCase, [
        "file",
        "title",
        "projectName",
        "status",
        "durationMs",
        "failureClassification",
        "error",
      ]) ||
      typeof testCase.file !== "string" ||
      testCase.file.length < 1 ||
      testCase.file.length > 500 ||
      typeof testCase.title !== "string" ||
      testCase.title.length > 2_000 ||
      typeof testCase.projectName !== "string" ||
      testCase.projectName.length > 120 ||
      !expectedProjects.includes(testCase.projectName) ||
      !STRUCTURED_BROWSER_CASE_STATUSES.has(testCase.status) ||
      !Number.isFinite(testCase.durationMs) ||
      testCase.durationMs < 0 ||
      testCase.durationMs > 8 * 60 * 60 * 1000 ||
      (testCase.failureClassification !== undefined &&
        !STRUCTURED_BROWSER_FAILURE_CLASSIFICATIONS.includes(
          testCase.failureClassification,
        )) ||
      (["failed", "timedout", "interrupted"].includes(testCase.status) !==
        (testCase.failureClassification !== undefined)) ||
      (testCase.error !== undefined &&
        (typeof testCase.error !== "string" || testCase.error.length > 2_000))
    ) {
      return null;
    }
    if (testCase.status === "not-run") {
      counts.notRun += 1;
      if (testCase.failureClassification !== undefined) return null;
    } else {
      counts.completed += 1;
      if (testCase.status === "passed") counts.passed += 1;
      else if (testCase.status === "skipped") counts.skipped += 1;
      else counts.failed += 1;
    }
    if (testCase.failureClassification !== undefined) {
      failureClassifications[testCase.failureClassification] += 1;
    }
  }

  if (
    summary.completedCount !== counts.completed ||
    summary.failureCount !== counts.failed + counts.notRun ||
    !STRUCTURED_BROWSER_FAILURE_CLASSIFICATIONS.every(
      (classification) =>
        Number.isInteger(summary.failureClassifications[classification]) &&
        summary.failureClassifications[classification] ===
          failureClassifications[classification],
    ) ||
    !isValidTestCounts(counts)
  ) {
    return null;
  }
  return counts;
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
        !hasOnlyKeys(outcome, ["label", "status", "durationMs", "counts"]) ||
        typeof outcome.label !== "string" ||
        outcome.label.length < 1 ||
        outcome.label.length > 160 ||
        !releaseStatuses.includes(outcome.status) ||
        !Number.isFinite(outcome.durationMs) ||
        outcome.durationMs < 0 ||
        outcome.durationMs > 8 * 60 * 60 * 1000 ||
        (outcome.counts !== undefined && !isValidTestCounts(outcome.counts)),
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
      counts:
        !incomplete && steps.every((step) => step.counts !== undefined)
          ? combineTestCounts(steps.map((step) => step.counts))
          : null,
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
    countsPolicy: TEST_RESULTS_COUNTS_POLICY,
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
    report.countsPolicy !== TEST_RESULTS_COUNTS_POLICY ||
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
      (result.counts !== null && !isValidTestCounts(result.counts)) ||
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
          result.counts !== null ||
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

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new Error("Test-results aggregation was interrupted.");
  }
}

export async function writeReport(path, report, catalog, { signal } = {}) {
  validateReport(report, catalog);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    throwIfAborted(signal);
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      ...(signal ? { signal } : {}),
    });
    throwIfAborted(signal);
    await rename(temporaryPath, path);
  } catch (error) {
    if (signal?.aborted) throw new Error("Test-results aggregation was interrupted.");
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readReport(path, catalog, {
  signal,
  maxBytes = MAX_TEST_RESULTS_REPORT_BYTES,
} = {}) {
  let report;
  try {
    throwIfAborted(signal);
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new Error("The test-results report is not a regular file.");
    }
    if (metadata.size > maxBytes) {
      throw new Error("The test-results report exceeds the size limit.");
    }
    const contents = await readFile(path, {
      encoding: "utf8",
      ...(signal ? { signal } : {}),
    });
    report = JSON.parse(contents);
  } catch (error) {
    if (signal?.aborted) throw new Error("Test-results aggregation was interrupted.");
    if (error instanceof SyntaxError || error?.code === "ENOENT" || error?.code === "EACCES") {
      throw new Error("Test-results report is missing or unreadable; initialize a new run.");
    }
    if (error instanceof Error && error.message === "The test-results report exceeds the size limit.") {
      throw error;
    }
    throw new Error("Test-results report is missing or unreadable; initialize a new run.");
  }
  validateReport(report, catalog);
  return report;
}

async function findDownloadedReports(directory, signal) {
  const root = resolveReportPath(directory);
  const reports = [];
  let entriesScanned = 0;
  const visit = async (currentDirectory, depth = 0) => {
    throwIfAborted(signal);
    if (depth > MAX_AGGREGATION_DEPTH) {
      throw new Error("The downloaded test-results directory is nested too deeply.");
    }
    let entries;
    try {
      entries = await readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      if (currentDirectory === root && error?.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      throwIfAborted(signal);
      entriesScanned += 1;
      if (entriesScanned > MAX_AGGREGATION_ENTRIES) {
        throw new Error("Too many files were supplied for test-results aggregation.");
      }
      if (entry.isSymbolicLink()) continue;
      const path = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, depth + 1);
      } else if (entry.isFile() && entry.name === "test-results.json") {
        reports.push(path);
        if (reports.length > MAX_AGGREGATION_REPORTS) {
          throw new Error("Too many test-results reports were supplied for aggregation.");
        }
      }
    }
  };
  await visit(root);
  return reports;
}

function assertMergeIdentity(report, expected, expectedRevision) {
  if (report.sourceRevision !== expectedRevision) {
    throw new Error("Refusing to merge test results from different source revisions.");
  }
  for (const key of ["id", "workflow", "event", "runId", "attempt"]) {
    if (
      expected[key] === undefined ||
      report.run[key] !== expected[key]
    ) {
      throw new Error("Refusing to merge test results from different workflow runs.");
    }
  }
  if (typeof report.run.job !== "string") {
    throw new Error("Refusing to merge a report without a workflow job identity.");
  }
}

function reportArtifactName(report, reportPath, inputDirectory) {
  const relativePath = relative(inputDirectory, reportPath);
  const [artifactName] = relativePath.split(sep);
  if (
    !artifactName ||
    artifactName === "." ||
    report.artifactReferences.length !== 1 ||
    report.artifactReferences[0].name !== artifactName ||
    report.lanes.some((lane) =>
      lane.artifactReferences.some((reference) => reference.name !== artifactName),
    ) ||
    !artifactName.endsWith(`-${report.run.runId}-${report.run.attempt}`)
  ) {
    throw new Error("Refusing to merge a report with mismatched artifact provenance.");
  }
  return artifactName;
}

export async function mergeTestResultsReports({
  inputDirectory,
  outputPath = resolveReportPath(),
  catalog,
  env = process.env,
  now = new Date().toISOString(),
  signal,
}) {
  if (typeof inputDirectory !== "string" || inputDirectory.trim() === "") {
    throw new Error("A test-results input directory is required for aggregation.");
  }
  const inputRoot = resolveReportPath(inputDirectory);
  const output = resolveReportPath(outputPath);
  const outputRelativeToInput = relative(inputRoot, output);
  if (
    outputRelativeToInput === "" ||
    (!outputRelativeToInput.startsWith(`..${sep}`) &&
      outputRelativeToInput !== ".." &&
      !isAbsolute(outputRelativeToInput))
  ) {
    throw new Error("The merged test-results report must be outside its input directory.");
  }
  throwIfAborted(signal);

  const expectedRun = getRunIdentity(env);
  const expectedRevision = getSourceRevision(env);
  if (
    expectedRevision === "unknown" ||
    !expectedRun.runId ||
    !expectedRun.attempt ||
    !expectedRun.workflow ||
    !expectedRun.event
  ) {
    throw new Error("A complete workflow run identity and source revision are required to aggregate reports.");
  }
  const reportPaths = await findDownloadedReports(inputRoot, signal);
  const reports = [];
  const artifactNames = new Set();
  const jobs = new Set();
  for (const path of reportPaths) {
    throwIfAborted(signal);
    const report = await readReport(path, catalog, { signal });
    assertMergeIdentity(report, expectedRun, expectedRevision);
    const artifactName = reportArtifactName(report, path, inputRoot);
    if (artifactNames.has(artifactName) || jobs.has(report.run.job)) {
      throw new Error("Refusing to merge duplicate test-results artifacts or workflow jobs.");
    }
    artifactNames.add(artifactName);
    jobs.add(report.run.job);
    reports.push({ report, artifactName });
  }

  const standardReleaseReport = reports.find(
    ({ report }) => report.run.job === "release-check-standard",
  );
  const fullReleaseReport = reports.find(
    ({ report }) => report.run.job === "release-check-full",
  );
  const expectsFullRelease = env.TEST_RESULTS_EXPECT_FULL_RELEASE === "true";
  const hasFullReleasePair = Boolean(standardReleaseReport && fullReleaseReport);
  if (
    (env.TEST_RESULTS_EXPECT_FULL_RELEASE !== undefined &&
      !["true", "false"].includes(env.TEST_RESULTS_EXPECT_FULL_RELEASE)) ||
    (expectsFullRelease && !hasFullReleasePair) ||
    (fullReleaseReport && !standardReleaseReport) ||
    (hasFullReleasePair &&
      (expectedRun.event !== "workflow_dispatch" ||
        env.TEST_RESULTS_EXPECT_FULL_RELEASE === "false"))
  ) {
    throw new Error("Refusing to merge an incomplete or unexpected full release report pair.");
  }

  const merged = createTestResultsReport({
    catalog,
    revision: expectedRevision,
    runIdentity: { ...expectedRun, job: "test-results-aggregation" },
    environment: getEnvironment(env),
    artifactName: env.TEST_RESULTS_ARTIFACT_NAME,
    now,
    env,
  });
  const mergedLaneById = new Map(merged.lanes.map((lane) => [lane.laneId, lane]));
  for (const lane of catalog.lanes) {
    throwIfAborted(signal);
    const candidates = reports
      .map(({ report, artifactName }) => ({
        result: report.lanes.find((item) => item.laneId === lane.id),
        artifactName,
      }))
      .filter(({ result }) => result);
    const attempted = candidates.filter(({ result }) => result.attempted);
    const explicitlyBlocked = candidates.filter(
      ({ result }) =>
        result.status === "BLOCKED" &&
        result.reason === "Required prerequisites did not complete.",
    );
    const isExpectedReleasePairDuplicate =
      hasFullReleasePair &&
      attempted.length + explicitlyBlocked.length === 2 &&
      new Set(
        [...attempted, ...explicitlyBlocked].map(({ artifactName }) => artifactName),
      ).size === 2 &&
      [...attempted, ...explicitlyBlocked].every(({ artifactName }) =>
        [
          standardReleaseReport.artifactName,
          fullReleaseReport.artifactName,
        ].includes(artifactName),
      );
    if (
      !isExpectedReleasePairDuplicate &&
      (attempted.length > 1 ||
        explicitlyBlocked.length > 1 ||
        (attempted.length > 0 && explicitlyBlocked.length > 0))
    ) {
      throw new Error(`Refusing to merge duplicate results for test lane ${lane.id}.`);
    }
    const blocked = candidates.filter(({ result }) => result.status === "BLOCKED");
    const releaseGateReport =
      lane.id === "release-standard"
        ? standardReleaseReport
        : lane.id === "release-full"
          ? fullReleaseReport
          : undefined;
    const selected =
      (releaseGateReport &&
        candidates.find(({ artifactName }) => artifactName === releaseGateReport.artifactName)) ||
      (hasFullReleasePair &&
        candidates.find(({ artifactName }) => artifactName === fullReleaseReport.artifactName)) ||
      attempted[0] ||
      blocked.find(
        ({ result }) => result.reason === "Required prerequisites did not complete.",
      ) ||
      blocked[0];
    if (selected) {
      mergedLaneById.set(lane.id, {
        ...selected.result,
        artifactReferences: selected.result.artifactReferences.some(
          (reference) => reference.name === selected.artifactName,
        )
          ? [...selected.result.artifactReferences]
          : [
              ...selected.result.artifactReferences,
              { kind: "github-actions-artifact", name: selected.artifactName },
            ],
      });
    }
  }
  merged.lanes = catalog.lanes.map((lane) => mergedLaneById.get(lane.id));
  merged.artifactReferences = [
    ...new Map(
      [
        ...merged.artifactReferences,
        ...reports.flatMap(({ report }) => report.artifactReferences),
      ].map((reference) => [reference.name, reference]),
    ).values(),
  ];
  merged.updatedAt = now;
  throwIfAborted(signal);
  await writeReport(output, merged, catalog, { signal });
  return { path: output, report: merged, sourceReportCount: reports.length };
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
  counts,
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
  if (counts !== undefined && counts !== null && !isValidTestCounts(counts)) {
    throw new Error("Structured test counts have an invalid shape.");
  }
  const report = await readReport(reportPath, catalog);
  assertSameRun(report, env);
  const result = report.lanes.find((item) => item.laneId === laneId);
  result.status = status;
  result.reason = status === "PASS" ? undefined : reason.slice(0, 240);
  result.attempted = !["NOT_RUN", "BLOCKED"].includes(status);
  result.durationMs =
    Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null;
  result.counts = counts ?? null;
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
  const releaseSidecarPath = `${path}.release-steps.json`;
  await Promise.all([
    rm(releaseSidecarPath, { force: true }),
    rm(
      `${releaseSidecarPath}${BROWSER_MAIN_COUNT_SUMMARY_SUFFIX}`,
      { force: true },
    ),
  ]);
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

async function expectedVitestPackagesForLane(laneId) {
  const fixedPackages = {
    "ci-api-postgres": ["@workspace/api-server"],
    "ci-client-unit": ["@workspace/run-calculator"],
    "ci-scripts-routine": ["@workspace/scripts"],
  };
  if (fixedPackages[laneId]) return fixedPackages[laneId];
  if (laneId !== "ci-library-sweep") return null;

  try {
    const packageRoots = [
      resolve(REPOSITORY_ROOT, "lib"),
      resolve(REPOSITORY_ROOT, "lib/integrations"),
    ];
    const packages = new Map();
    for (const packageRoot of packageRoots) {
      let entries;
      try {
        entries = await readdir(packageRoot, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT" && packageRoot.endsWith(`${sep}integrations`)) {
          continue;
        }
        return null;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === "node_modules") continue;
        const manifestPath = join(packageRoot, entry.name, "package.json");
        let manifest;
        try {
          manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          return null;
        }
        if (manifest.scripts?.test === undefined) continue;
        if (
          typeof manifest.scripts.test !== "string" ||
          !/^\s*vitest\s+run(?:\s|$)/.test(manifest.scripts.test) ||
          typeof manifest.name !== "string" ||
          !/^@workspace\/[a-z0-9-]{2,80}$/.test(manifest.name) ||
          packages.has(manifest.name)
        ) {
          return null;
        }
        packages.set(manifest.name, manifestPath);
      }
    }
    const names = [...packages.keys()].sort();
    return names.length > 0 && names.length <= MAX_VITEST_COUNT_SUMMARIES
      ? names
      : null;
  } catch {
    return null;
  }
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
  const expectedVitestPackages = isReleaseLane
    ? [API_RELEASE_VITEST_PACKAGE]
    : await expectedVitestPackagesForLane(laneId);
  let vitestCountsDirectory;
  if (expectedVitestPackages) {
    const candidateDirectory = `${path}.vitest-counts-${randomUUID()}`;
    try {
      await mkdir(candidateDirectory, { recursive: false });
      vitestCountsDirectory = candidateDirectory;
    } catch {
      // Count evidence is optional; never block or change a test lane because
      // its temporary summary directory could not be created.
    }
  }
  const childEnv = {
    ...(isReleaseLane
      ? {
          TEST_RESULTS_REPORT_ID: existing.run.id,
          TEST_RESULTS_RELEASE_STEPS_PATH: releaseSidecarPath,
          ...(vitestCountsDirectory
            ? {
                TEST_RESULTS_RELEASE_VITEST_COUNTS_DIR:
                  vitestCountsDirectory,
                TEST_RESULTS_RELEASE_VITEST_RUN_ID: existing.run.id,
                TEST_RESULTS_RELEASE_VITEST_SOURCE_REVISION:
                  existing.sourceRevision,
              }
            : {}),
        }
      : {}),
    ...(vitestCountsDirectory && !isReleaseLane
      ? {
          TEST_RESULTS_VITEST_COUNTS_DIR: vitestCountsDirectory,
          TEST_RESULTS_VITEST_RUN_ID: existing.run.id,
          TEST_RESULTS_VITEST_SOURCE_REVISION: existing.sourceRevision,
        }
      : {}),
  };
  const childArgs =
    vitestCountsDirectory && VITEST_REPORTER_LANES.has(laneId)
      ? [
          ...args,
          "--reporter=default",
          `--reporter=${VITEST_COUNT_REPORTER_PATH}`,
        ]
      : args;
  const outcome = await runChild(command, childArgs, childEnv);
  const end = new Date().toISOString();
  let counts = null;
  if (vitestCountsDirectory) {
    try {
      counts = await readStructuredVitestTestCounts({
        directory: vitestCountsDirectory,
        expectedRunId: existing.run.id,
        expectedRevision: existing.sourceRevision,
        expectedPackages: expectedVitestPackages,
      });
    } finally {
      try {
        await rm(vitestCountsDirectory, { recursive: true, force: true });
      } catch {
        // Temporary count cleanup must not change the recorded test outcome.
      }
    }
  }
  if (isReleaseLane) {
    try {
      const sidecar = JSON.parse(await readFile(releaseSidecarPath, "utf8"));
      if (sidecar.runId !== existing.run.id || !Array.isArray(sidecar.outcomes)) {
        throw new Error("Release step outcomes came from another run.");
      }
      const outcomes =
        counts === null
          ? sidecar.outcomes
          : sidecar.outcomes.map((result) =>
              result.label === API_RELEASE_VITEST_STEP_LABEL
                ? { ...result, counts }
                : result,
            );
      const mapped = mapReleaseStepOutcomes(
        catalog,
        outcomes,
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
    counts,
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
  if (mode === "merge") {
    const inputIndex = args.indexOf("--input-dir");
    const inputDirectory = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
    if (!inputDirectory) {
      throw new Error("Usage: test-results.mjs merge --input-dir <directory>");
    }
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    try {
      const catalog = await readLaneCatalog();
      const result = await mergeTestResultsReports({
        inputDirectory,
        outputPath: resolveReportPath(),
        catalog,
        signal: controller.signal,
      });
      console.log(
        `Merged ${result.sourceReportCount} test-results report(s): ${relative(REPOSITORY_ROOT, result.path)}`,
      );
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    }
    return;
  }
  throw new Error("Usage: test-results.mjs <init|run|local|block|merge>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "Test-results command failed.");
    process.exitCode = 1;
  });
}
