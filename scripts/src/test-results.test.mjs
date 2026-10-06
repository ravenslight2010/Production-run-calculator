import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  readLaneCatalog,
  recordLaneResult,
  resolveReportPath,
  TEST_RESULT_STATUSES,
  validateReport,
  writeReport,
} from "./test-results.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);

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
});
