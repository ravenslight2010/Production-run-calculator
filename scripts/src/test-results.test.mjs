import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile as writeTextFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  boundedFailure,
  classifyProcessOutcome,
  createTestResultsReport,
  getRunIdentity,
  getSourceRevision,
  mapReleaseStepOutcomes,
  mergeTestResultsReports,
  parseStructuredBrowserTestCounts,
  readLaneCatalog,
  recordLaneResult,
  resolveReportPath,
  TEST_RESULT_STATUSES,
  validateReport,
  writeReport,
} from "./test-results.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const MERGE_REVISION = "a".repeat(40);

function mergeEnvironment(job = "aggregate-test-results", revision = MERGE_REVISION) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_SHA: revision,
    GITHUB_RUN_ID: "123456",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_WORKFLOW: "CI",
    GITHUB_JOB: job,
    GITHUB_EVENT_NAME: "pull_request",
    TEST_RESULTS_ARTIFACT_NAME: "automated-test-results-merged-ci-123456-2",
  };
}

function createMergeSourceReport(catalog, job, revision = MERGE_REVISION) {
  const env = mergeEnvironment(job, revision);
  const artifactName = `automated-test-results-${job}-123456-2`;
  return createTestResultsReport({
    catalog,
    revision,
    runIdentity: getRunIdentity(env),
    environment: {
      kind: "ci",
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.0.0",
    },
    artifactName,
    now: "2026-10-06T12:00:00.000Z",
    env,
  });
}

function markLanePassed(report, laneId) {
  const result = report.lanes.find((lane) => lane.laneId === laneId);
  assert.ok(result, `${laneId} must be present in the source report`);
  result.status = "PASS";
  result.reason = undefined;
  result.attempted = true;
  result.durationMs = 12;
  result.failure = null;
  result.startedAt = "2026-10-06T12:00:00.000Z";
  result.finishedAt = "2026-10-06T12:00:00.012Z";
}

function markLaneBlocked(report, laneId) {
  const result = report.lanes.find((lane) => lane.laneId === laneId);
  assert.ok(result, `${laneId} must be present in the source report`);
  result.status = "BLOCKED";
  result.reason = "Required prerequisites did not complete.";
  result.attempted = false;
  result.durationMs = null;
  result.failure = null;
  delete result.startedAt;
  delete result.finishedAt;
}

async function saveMergeSource(inputDirectory, report, artifactName) {
  const artifactDirectory = join(inputDirectory, artifactName);
  await mkdir(artifactDirectory, { recursive: true });
  await writeReport(join(artifactDirectory, "test-results.json"), report, await readLaneCatalog());
}

function browserSummaryFixture() {
  return {
    schemaVersion: 1,
    browser: "webkit",
    revision: `test-sha256:${"a".repeat(64)}`,
    environment: "ci",
    result: "failed",
    generatedAt: "2026-10-06T12:30:00.000Z",
    caseCount: 4,
    completedCount: 3,
    failureCount: 2,
    failureClassifications: {
      product: 1,
      "test-setup": 0,
      infrastructure: 0,
      "optional-environment-gap": 0,
    },
    cases: [
      {
        file: "e2e/smoke.spec.ts",
        title: "a passing case",
        projectName: "webkit",
        status: "passed",
        durationMs: 120,
      },
      {
        file: "e2e/smoke.spec.ts",
        title: "a case with sensitive error output",
        projectName: "webkit",
        status: "failed",
        durationMs: 180,
        failureClassification: "product",
        error: "private failure output",
      },
      {
        file: "e2e/smoke.spec.ts",
        title: "a skipped case",
        projectName: "webkit",
        status: "skipped",
        durationMs: 0,
      },
      {
        file: "e2e/smoke.spec.ts",
        title: "a case that did not run",
        projectName: "webkit",
        status: "not-run",
        durationMs: 0,
      },
    ],
  };
}

test("catalog is complete against the maintained test/release matrix", async () => {
  const catalog = await readLaneCatalog();
  const matrix = await readFile(join(ROOT, "docs/test-release-matrix.md"), "utf8");
  const lines = matrix.split(/\r?\n/u);
  const header = lines.findIndex((line) => line.includes("| Report lane IDs |"));
  assert.notEqual(header, -1, "matrix must map its surfaces to catalog lane IDs");
  const ids = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    const laneCell = cells.at(-2) ?? "";
    ids.push(
      ...laneCell
        .split(",")
        .map((id) => id.trim().replaceAll("`", ""))
        .filter(Boolean),
    );
  }
  assert.deepEqual([...ids].sort(), catalog.lanes.map((lane) => lane.id).sort());
  assert.equal(new Set(ids).size, ids.length, "each catalog lane must appear once in the matrix");
  for (const lane of catalog.lanes) {
    assert.ok(lane.command || lane.owner, `${lane.id} needs a command or manual owner`);
    assert.equal(typeof lane.runsByDefault, "boolean");
    assert.ok(lane.environment.length > 0);
    assert.ok(lane.prerequisites.length > 0);
    assert.ok(lane.safety.length > 0);
  }
});

test("all public outcome classifications are handled without promoting missing work", async () => {
  assert.deepEqual(TEST_RESULT_STATUSES, [
    "PASS",
    "FAIL",
    "INFRASTRUCTURE_ERROR",
    "TIMEOUT",
    "CANCELLED",
    "NOT_RUN",
    "BLOCKED",
  ]);
  assert.equal(classifyProcessOutcome({ exitCode: 0 }), "PASS");
  assert.equal(classifyProcessOutcome({ exitCode: 1 }), "FAIL");
  assert.equal(classifyProcessOutcome({ exitCode: 124 }), "TIMEOUT");
  assert.equal(classifyProcessOutcome({ exitCode: 130 }), "CANCELLED");
  assert.equal(classifyProcessOutcome({ signal: "SIGTERM" }), "CANCELLED");
  assert.equal(classifyProcessOutcome({ signal: "SIGKILL" }), "INFRASTRUCTURE_ERROR");
  assert.equal(classifyProcessOutcome({ spawnError: "ENOENT" }), "INFRASTRUCTURE_ERROR");
  assert.deepEqual(boundedFailure("INFRASTRUCTURE_ERROR", { spawnError: "ENOENT" }), {
    kind: "infrastructure",
    processErrorCode: "ENOENT",
  });
  assert.equal(boundedFailure("PASS"), undefined);
});

test("release step summaries map structured outcomes into the shared lane contract", async () => {
  const catalog = await readLaneCatalog();
  const outcomes = [
    { label: "API unit tests (release shard 1/7)", status: "PASS", durationMs: 20 },
    { label: "API integration tests (release shard 2/7)", status: "PASS", durationMs: 30 },
    { label: "API integration tests (release shard 3/7)", status: "PASS", durationMs: 35 },
    { label: "API integration tests (release shard 4/7)", status: "PASS", durationMs: 25 },
    { label: "API role/capability tests (release shard 5/7)", status: "NOT REACHED", durationMs: 0 },
    { label: "browser WebKit smoke", status: "INFRASTRUCTURE TIMEOUT", durationMs: 500 },
    { label: "browser phone/tablet WebKit compatibility", status: "PASS", durationMs: 650 },
  ];
  const mapped = mapReleaseStepOutcomes(catalog, outcomes, "release-full", "CANCELLED");
  const resultFor = (id) => mapped.find((result) => result.laneId === id);
  assert.equal(resultFor("api-unit-isolated").status, "PASS");
  assert.equal(resultFor("api-integration-shards").status, "PASS");
  assert.equal(resultFor("api-roles").status, "CANCELLED");
  assert.equal(resultFor("browser-webkit").status, "TIMEOUT");
  assert.equal(resultFor("browser-main").status, "INFRASTRUCTURE_ERROR");
  assert.equal(resultFor("api-integration-shards").durationMs, 90);
  assert.equal(resultFor("browser-webkit").failure.kind, "timeout");
  assert.equal(resultFor("browser-compatibility").status, "PASS");
  assert.equal(resultFor("browser-webkit").counts, null);
  assert.throws(
    () =>
      mapReleaseStepOutcomes(
        catalog,
        [{ label: "private request payload", status: "PASS", durationMs: 1 }],
        "release-standard",
        "FAIL",
      ),
    /unknown test lane label/u,
  );
});

test("browser JSON summaries provide only validated bounded counts", async () => {
  const expectedRevision = `test-sha256:${"a".repeat(64)}`;
  const options = {
    expectedRevision,
    notBeforeMs: Date.parse("2026-10-06T12:00:00.000Z"),
    notAfterMs: Date.parse("2026-10-06T13:00:00.000Z"),
    expectedProjects: ["webkit"],
    expectedReleaseStatus: "FAIL",
  };
  const summary = browserSummaryFixture();
  const counts = parseStructuredBrowserTestCounts(summary, options);
  assert.deepEqual(counts, {
    total: 4,
    completed: 3,
    passed: 1,
    failed: 1,
    skipped: 1,
    notRun: 1,
  });

  const catalog = await readLaneCatalog();
  const mapped = mapReleaseStepOutcomes(
    catalog,
    [
      {
        label: "browser WebKit smoke",
        status: "FAIL",
        durationMs: 300,
        counts,
      },
    ],
    "release-standard",
    "FAIL",
  );
  assert.deepEqual(
    mapped.find((result) => result.laneId === "browser-webkit").counts,
    counts,
  );

  const malformed = [
    { ...summary, caseCount: 5 },
    { ...summary, completedCount: 4 },
    {
      ...summary,
      cases: [{ ...summary.cases[0], status: "ambiguous" }, ...summary.cases.slice(1)],
    },
    { ...summary, revision: `test-sha256:${"b".repeat(64)}` },
    { ...summary, generatedAt: "2026-10-06T11:59:59.999Z" },
    { ...summary, result: "passed" },
    { ...summary, rawOutput: "must not be retained" },
  ];
  for (const candidate of malformed) {
    assert.equal(parseStructuredBrowserTestCounts(candidate, options), null);
  }
  assert.equal(parseStructuredBrowserTestCounts(undefined, options), null);
  assert.equal(parseStructuredBrowserTestCounts(null, options), null);
});

test("report provenance is run-scoped and a result cannot be joined to another revision", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(tmpdir(), "test-results-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "latest.json");
  const revision = "a".repeat(40);
  const env = { GITHUB_SHA: revision, GITHUB_RUN_ID: "1234", GITHUB_RUN_ATTEMPT: "2" };
  const report = createTestResultsReport({
    catalog,
    revision,
    runIdentity: getRunIdentity(env),
    environment: { kind: "ci", platform: "linux", architecture: "x64", nodeVersion: "v24.0.0" },
    artifactName: "automated-test-results-ci-1234",
    now: "2026-10-06T12:00:00.000Z",
    env,
  });
  validateReport(report, catalog);
  await writeReport(path, report, catalog);
  const laneId = catalog.lanes[0].id;
  await assert.rejects(
    recordLaneResult({
      reportPath: path,
      catalog,
      laneId,
      status: "PASS",
      durationMs: 120,
      env: { ...env, GITHUB_SHA: "b".repeat(40) },
    }),
    /different source revisions/u,
  );
  assert.equal(getSourceRevision({ GITHUB_SHA: "not-a-revision" }, temp), "unknown");
});

test("run-level aggregation preserves explicit results and leaves missing lanes unrun", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(ROOT, ".test-results-merge-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const inputDirectory = join(temp, "reports");
  const outputPath = join(temp, "merged.json");
  const source = createMergeSourceReport(catalog, "typecheck");
  const artifactName = source.artifactReferences[0].name;
  markLanePassed(source, "ci-typecheck");
  await saveMergeSource(inputDirectory, source, artifactName);
  const blockedSource = createMergeSourceReport(catalog, "api-postgres");
  const blockedArtifactName = blockedSource.artifactReferences[0].name;
  markLaneBlocked(blockedSource, "ci-api-postgres");
  await saveMergeSource(inputDirectory, blockedSource, blockedArtifactName);

  const result = await mergeTestResultsReports({
    inputDirectory,
    outputPath,
    catalog,
    env: mergeEnvironment(),
    now: "2026-10-06T12:01:00.000Z",
  });
  assert.equal(result.sourceReportCount, 2);
  assert.equal(result.report.run.id, "github:123456:2");
  assert.equal(result.report.run.workflow, "CI");
  assert.equal(result.report.run.job, "test-results-aggregation");
  assert.equal(result.report.lanes.find((lane) => lane.laneId === "ci-typecheck").status, "PASS");
  assert.equal(result.report.lanes.find((lane) => lane.laneId === "ci-api-postgres").status, "BLOCKED");
  assert.equal(result.report.lanes.find((lane) => lane.laneId === "ci-client-unit").status, "NOT_RUN");
  assert.equal(result.report.lanes.find((lane) => lane.laneId === "browser-main").status, "NOT_RUN");
  assert.equal(
    result.report.lanes.find((lane) => lane.laneId === "ci-client-unit").reason,
    "This lane was not executed in this report's run scope.",
  );
  assert.equal(
    result.report.lanes.find((lane) => lane.laneId === "ci-api-postgres").reason,
    "Required prerequisites did not complete.",
  );
  assert.equal(
    result.report.lanes.find((lane) => lane.laneId === "browser-main").reason,
    "This lane is optional or manual and was not requested.",
  );
  assert.ok(result.report.artifactReferences.some((reference) => reference.name === artifactName));
  assert.ok(result.report.artifactReferences.some((reference) => reference.name === blockedArtifactName));
  assert.ok(result.report.artifactReferences.some((reference) => reference.name === mergeEnvironment().TEST_RESULTS_ARTIFACT_NAME));
  validateReport(JSON.parse(await readFile(outputPath, "utf8")), catalog);
});

test("run-level aggregation records every lane when no job reports were uploaded", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(ROOT, ".test-results-merge-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const result = await mergeTestResultsReports({
    inputDirectory: join(temp, "reports"),
    outputPath: join(temp, "merged.json"),
    catalog,
    env: mergeEnvironment(),
  });
  assert.equal(result.sourceReportCount, 0);
  assert.equal(result.report.lanes.length, catalog.lanes.length);
  assert.ok(result.report.lanes.every((lane) => ["BLOCKED", "NOT_RUN"].includes(lane.status)));
  assert.ok(result.report.artifactReferences.some((reference) => reference.name === mergeEnvironment().TEST_RESULTS_ARTIFACT_NAME));
});

test("run-level aggregation rejects duplicate executed lanes", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(ROOT, ".test-results-merge-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const inputDirectory = join(temp, "reports");
  const outputPath = join(temp, "merged.json");
  for (const job of ["typecheck", "unit"]) {
    const report = createMergeSourceReport(catalog, job);
    markLanePassed(report, "ci-typecheck");
    await saveMergeSource(inputDirectory, report, report.artifactReferences[0].name);
  }
  await assert.rejects(
    mergeTestResultsReports({
      inputDirectory,
      outputPath,
      catalog,
      env: mergeEnvironment(),
    }),
    /duplicate results for test lane ci-typecheck/u,
  );
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
});

test("run-level aggregation rejects source revision mismatches", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(ROOT, ".test-results-merge-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const inputDirectory = join(temp, "reports");
  const outputPath = join(temp, "merged.json");
  const source = createMergeSourceReport(catalog, "typecheck", "b".repeat(40));
  await saveMergeSource(inputDirectory, source, source.artifactReferences[0].name);
  await assert.rejects(
    mergeTestResultsReports({
      inputDirectory,
      outputPath,
      catalog,
      env: mergeEnvironment(),
    }),
    /different source revisions/u,
  );
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
});

test("run-level aggregation rejects mismatched schema and workflow identities", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(ROOT, ".test-results-merge-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const inputDirectory = join(temp, "reports");
  const outputPath = join(temp, "merged.json");
  const source = createMergeSourceReport(catalog, "typecheck");
  source.run.attempt = 3;
  await saveMergeSource(inputDirectory, source, source.artifactReferences[0].name);
  await assert.rejects(
    mergeTestResultsReports({
      inputDirectory,
      outputPath,
      catalog,
      env: mergeEnvironment(),
    }),
    /different workflow runs/u,
  );
  await rm(inputDirectory, { recursive: true, force: true });

  const schemaMismatch = createMergeSourceReport(catalog, "typecheck");
  schemaMismatch.schemaVersion += 1;
  const schemaArtifactName = schemaMismatch.artifactReferences[0].name;
  const schemaArtifactDirectory = join(inputDirectory, schemaArtifactName);
  await mkdir(schemaArtifactDirectory, { recursive: true });
  await writeTextFile(
    join(schemaArtifactDirectory, "test-results.json"),
    JSON.stringify(schemaMismatch),
  );
  await assert.rejects(
    mergeTestResultsReports({
      inputDirectory,
      outputPath,
      catalog,
      env: mergeEnvironment(),
    }),
    /schema or provenance/u,
  );
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
});

test("interrupted run-level aggregation does not publish a partial report", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(ROOT, ".test-results-merge-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const inputDirectory = join(temp, "reports");
  const outputPath = join(temp, "merged.json");
  const source = createMergeSourceReport(catalog, "typecheck");
  await saveMergeSource(inputDirectory, source, source.artifactReferences[0].name);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    mergeTestResultsReports({
      inputDirectory,
      outputPath,
      catalog,
      env: mergeEnvironment(),
      signal: controller.signal,
    }),
    /aggregation was interrupted/u,
  );
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
});

test("the report persists normalized counts without runner case details", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(tmpdir(), "test-results-counts-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "report.json");
  const env = {};
  const report = createTestResultsReport({
    catalog,
    revision: getSourceRevision(env),
    runIdentity: { id: "local:count-summary" },
    environment: {
      kind: "local",
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.0.0",
    },
    env,
  });
  const counts = parseStructuredBrowserTestCounts(browserSummaryFixture(), {
    expectedRevision: `test-sha256:${"a".repeat(64)}`,
    notBeforeMs: Date.parse("2026-10-06T12:00:00.000Z"),
    notAfterMs: Date.parse("2026-10-06T13:00:00.000Z"),
    expectedProjects: ["webkit"],
    expectedReleaseStatus: "FAIL",
  });
  assert.ok(counts);
  await writeReport(path, report, catalog);
  await recordLaneResult({
    reportPath: path,
    catalog,
    laneId: "browser-webkit",
    status: "FAIL",
    reason: "The test command exited unsuccessfully.",
    durationMs: 300,
    counts,
    failure: boundedFailure("FAIL", { exitCode: 1 }),
    env,
  });
  const saved = await readFile(path, "utf8");
  const parsed = JSON.parse(saved);
  assert.deepEqual(
    parsed.lanes.find((lane) => lane.laneId === "browser-webkit").counts,
    counts,
  );
  assert.ok(!saved.includes("a case with sensitive error output"));
  assert.ok(!saved.includes("private failure output"));
});

test("missing, blocked, and interrupted lanes remain explicit; reports never retain raw output", async (t) => {
  const catalog = await readLaneCatalog();
  const temp = await mkdtemp(join(tmpdir(), "test-results-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "report.json");
  const env = {};
  const report = createTestResultsReport({
    catalog,
    revision: getSourceRevision(),
    runIdentity: { id: "local:test-run" },
    environment: { kind: "local", platform: "linux", architecture: "x64", nodeVersion: "v24.0.0" },
    env,
  });
  await assert.rejects(
    recordLaneResult({
      reportPath: join(temp, "missing.json"),
      catalog,
      laneId: catalog.lanes[0].id,
      status: "PASS",
      durationMs: 10,
      env,
    }),
    /missing or unreadable/u,
  );
  await writeReport(path, report, catalog);
  const deviceLane = catalog.lanes.find((lane) => lane.id === "physical-ios-pwa");
  assert.ok(deviceLane);
  assert.equal(report.lanes.find((lane) => lane.laneId === deviceLane.id).status, "BLOCKED");
  await recordLaneResult({
    reportPath: path,
    catalog,
    laneId: catalog.lanes[0].id,
    status: "CANCELLED",
    reason: "The test command was interrupted.",
    durationMs: 300,
    failure: boundedFailure("CANCELLED", { signal: "SIGTERM" }),
    env,
  });
  const saved = await readFile(path, "utf8");
  const parsed = JSON.parse(saved);
  assert.equal(parsed.lanes[0].status, "CANCELLED");
  assert.equal(parsed.lanes[0].failure.signal, "SIGTERM");
  assert.ok(parsed.lanes.some((lane) => lane.status === "NOT_RUN"));
  assert.ok(!saved.includes("DATABASE_URL"));
  assert.ok(!saved.includes("secret"));
  assert.ok(!saved.includes("request payload"));
  assert.ok(!saved.includes("raw log"));
  assert.ok(parsed.lanes.every((lane) => lane.counts === null));
  assert.match(parsed.sourceRevision, /^[a-f0-9]{40,64}$/u);
});

test("failure metadata rejects unbounded messages and unsafe report paths", async () => {
  const catalog = await readLaneCatalog();
  const report = createTestResultsReport({
    catalog,
    revision: "unknown",
    runIdentity: { id: "local:test" },
    environment: {
      kind: "local",
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.0.0",
    },
  });
  report.lanes[0] = {
    ...report.lanes[0],
    status: "FAIL",
    reason: "The test command exited unsuccessfully.",
    attempted: true,
    durationMs: 1,
    startedAt: "2026-10-06T12:00:00.000Z",
    finishedAt: "2026-10-06T12:00:00.001Z",
    failure: { kind: "test_process_failure", message: "private request payload" },
  };
  assert.throws(() => validateReport(report, catalog), /unbounded failure metadata/u);
  const unsafeReasonReport = createTestResultsReport({
    catalog,
    revision: "unknown",
    runIdentity: { id: "local:test" },
    environment: {
      kind: "local",
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.0.0",
    },
  });
  unsafeReasonReport.lanes[0].reason = "private request payload";
  assert.throws(() => validateReport(unsafeReasonReport, catalog), /invalid.*lane/u);
  unsafeReasonReport.lanes[0].reason = undefined;
  unsafeReasonReport.rawLog = "not allowed in reports";
  assert.throws(() => validateReport(unsafeReasonReport, catalog), /schema or provenance/u);
  assert.throws(() => resolveReportPath("/tmp/outside-report.json"), /inside the workspace/u);
});

test("workflow contracts publish reports on failure without changing triggers or concurrency", async () => {
  const [ci, release, department, calibration] = await Promise.all(
    [
      ".github/workflows/ci.yml",
      ".github/workflows/release-check.yml",
      ".github/workflows/department-navigation.yml",
      ".github/workflows/release-concurrency-calibration.yml",
    ].map((path) => readFile(join(ROOT, path), "utf8")),
  );
  const catalog = await readLaneCatalog();
  const normalize = (command) => command.replaceAll(/["']/g, "").replaceAll(/\s+/g, " ").trim();
  for (const workflow of [ci, release, department, calibration]) {
    const wrapped = [
      ...workflow.matchAll(
        /run: node scripts\/src\/test-results\.mjs run --lane ([a-z0-9-]+) -- (.+)$/gmu,
      ),
    ];
    assert.ok(wrapped.length > 0, "workflow should instrument its test commands");
    for (const [, laneId, command] of wrapped) {
      const lane = catalog.lanes.find((item) => item.id === laneId);
      assert.ok(lane, `${laneId} must exist in the catalog`);
      assert.equal(normalize(command), normalize(lane.command));
    }
    assert.match(workflow, /name: Upload machine-readable test report\n\s+if: always\(\)\n\s+uses: actions\/upload-artifact/u);
    assert.match(workflow, /automated-test-results-[a-z0-9-]+\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
  }
  assert.match(ci, /push:\n\s+branches: \[main\]\n\s+pull_request:/u);
  assert.match(ci, /cancel-in-progress: true/u);
  assert.match(release, /workflow_dispatch:\n\s+inputs:\n\s+run_full:/u);
  assert.match(release, /cancel-in-progress: false/u);
  assert.match(department, /pull_request:\n\s+workflow_dispatch:/u);
  assert.match(calibration, /on:\n\s+workflow_dispatch:/u);
  const downloadAction = "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";
  assert.match(ci, /aggregate-test-results:\n\s+name: Aggregate CI test results\n\s+if: always\(\)\n\s+needs:/u);
  assert.match(ci, /continue-on-error: true\n\s+runs-on: ubuntu-latest\n\s+timeout-minutes: 5/u);
  assert.match(ci, new RegExp(`uses: ${downloadAction.replaceAll("/", "\\/")}`, "u"));
  assert.match(ci, /pattern: automated-test-results-\*-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
  assert.match(release, /aggregate-test-results:\n\s+name: Aggregate release test results\n\s+if: always\(\)\n\s+needs:/u);
  assert.match(release, new RegExp(`uses: ${downloadAction.replaceAll("/", "\\/")}`, "u"));
  assert.match(release, /inputs\.run_full && 'full' \|\| 'standard'/u);
});
