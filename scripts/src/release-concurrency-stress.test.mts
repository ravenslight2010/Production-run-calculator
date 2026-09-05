import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  compareConcurrencyStressReports,
  formatConcurrencyStressMarkdown,
  formatConcurrencyComparisonMarkdown,
  formatConcurrencyTrendMarkdown,
  runConcurrencyStress,
  summarizeConcurrencyStressTrend,
  validateStressEnvironment,
  type StressRunStep,
} from "./release-concurrency-stress.mts";
import {
  apiIntegrationTestShardInventoryErrors,
  API_RELEASE_INTEGRATION_SCRIPT_NAMES,
  API_SHARD_TIMEOUT_MS,
  assertApiIntegrationTestShardInventory,
  RELEASE_CHECK_API_SHARD_STEPS,
  releaseGateLabelsForMode,
} from "./release-check.mts";

const execFile = promisify(execFileCallback);
const rootDir = fileURLToPath(new URL("../../", import.meta.url));
const historyScript = join(
  rootDir,
  "scripts/src/fetch-release-concurrency-history.sh",
);
const historyFixtures = join(
  rootDir,
  "scripts/src/fixtures/release-concurrency-history",
);

const steps = [
  { label: "shard one", args: [] },
  { label: "shard two", args: [] },
  { label: "shard three", args: [] },
  { label: "shard four", args: [] },
];

async function createArchive(
  archivePath: string,
  sourcePath: string,
  entryName: string,
): Promise<void> {
  await execFile("python3", [
    "-c",
    [
      "import sys, zipfile",
      "archive, source, entry = sys.argv[1:]",
      "with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:",
      "    output.writestr(entry, open(source, 'rb').read())",
    ].join("\n"),
    archivePath,
    sourcePath,
    entryName,
  ]);
}

async function testCalibrationHistoryWorkflow(): Promise<void> {
  const fixtureWorkspace = await mkdtemp(
    join(tmpdir(), "release-concurrency-history-workflow-"),
  );
  const fakeBin = join(fixtureWorkspace, "bin");
  const archiveRoot = join(fixtureWorkspace, "archives");
  const githubEnv = join(fixtureWorkspace, "github.env");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(archiveRoot, { recursive: true });
  const fakeGh = join(fakeBin, "gh");
  await writeFile(
    fakeGh,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'url=""',
      'for arg in "$@"; do',
      '  if [[ "$arg" == repos/* ]]; then',
      '    url="$arg"',
      "  fi",
      "done",
      'case "$url" in',
      '  *"/actions/workflows/"*"runs?status=success"*)',
      '    jq -r \'.workflow_runs[] | [.id, .created_at] | @tsv\' "$FIXTURE_ROOT/artifact-list.json"',
      "    ;;",
      '  *"/actions/runs/"*"/artifacts?per_page=100")',
      '    run_id="${url#*/actions/runs/}"',
      '    run_id="${run_id%%/*}"',
      '    if [[ "$run_id" == "expired-artifact" ]]; then',
      '      cat "$FIXTURE_ROOT/expired-artifact.json"',
      "    else",
      '      jq -c --arg runId "$run_id" \'.artifacts[$runId]\' "$FIXTURE_ROOT/artifact-list.json"',
      "    fi",
      "    ;;",
      '  *"/actions/artifacts/"*"/zip")',
      '    artifact_id="${url#*/actions/artifacts/}"',
      '    artifact_id="${artifact_id%%/*}"',
      '    cat "$ARCHIVE_ROOT/archive-${artifact_id}.zip"',
      "    ;;",
      "  *)",
      '    echo "Unexpected fixture gh URL: $url" >&2',
      "    exit 1",
      "    ;;",
      "esac",
    ].join("\n") + "\n",
    "utf8",
  );
  await chmod(fakeGh, 0o755);

  try {
    const reportFixtures = [
      ["artifact-valid-newest", "healthy-report.json"],
      ["artifact-malformed-report", "malformed-report.json"],
      ["artifact-unsafe-report", "unsafe-report.json"],
      ["artifact-valid-older-1", "healthy-report.json"],
      ["artifact-valid-older-2", "healthy-report.json"],
      ["artifact-valid-older-3", "healthy-report.json"],
      ["artifact-valid-older-4", "healthy-report.json"],
      ["artifact-valid-older-5", "healthy-report.json"],
    ] as const;
    for (const [artifactId, fixtureName] of reportFixtures) {
      await createArchive(
        join(archiveRoot, `archive-${artifactId}.zip`),
        join(historyFixtures, fixtureName),
        "nested/release-concurrency-stress.json",
      );
    }
    const unsafeArchive = JSON.parse(
      await readFile(join(historyFixtures, "unsafe-archive.json"), "utf8"),
    ) as { entry: string };
    await createArchive(
      join(archiveRoot, "archive-artifact-unsafe-archive.zip"),
      join(historyFixtures, "healthy-report.json"),
      unsafeArchive.entry,
    );

    const { stdout, stderr } = await execFile("bash", [historyScript], {
      cwd: rootDir,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        FIXTURE_ROOT: historyFixtures,
        ARCHIVE_ROOT: archiveRoot,
        GITHUB_WORKSPACE: fixtureWorkspace,
        GITHUB_REPOSITORY: "fixture-owner/fixture-repo",
        GITHUB_RUN_ID: "current-run",
        GITHUB_ENV: githubEnv,
      },
    });
    assert.equal(stderr, "");
    assert.match(
      stdout,
      /Using healthy calibration from workflow run valid-newest as the single baseline/,
    );
    assert.match(
      stdout,
      /Ignoring calibration run malformed-report: report is missing, malformed, or unsafe/,
    );
    assert.match(
      stdout,
      /Ignoring calibration run unsafe-report: report is missing, malformed, or unsafe/,
    );
    assert.match(
      stdout,
      /Ignoring calibration run expired-artifact: no non-expired calibration artifact/,
    );
    assert.match(
      stdout,
      /Ignoring calibration run unsafe-archive: artifact archive has unsafe paths/,
    );
    assert.match(
      stdout,
      /Collected 5 prior healthy calibration artifact\(s\); history is bounded at 5/,
    );
    assert.doesNotMatch(
      stdout,
      /Accepted healthy calibration history from workflow run valid-older-5/,
    );

    const history = JSON.parse(
      await readFile(
        join(
          fixtureWorkspace,
          "calibration-history/release-concurrency-history.json",
        ),
        "utf8",
      ),
    ) as Array<{ runId: string; report: { setupElapsedMs: number } }>;
    assert.deepEqual(
      history.map(({ runId }) => runId),
      [
        "valid-newest",
        "valid-older-1",
        "valid-older-2",
        "valid-older-3",
        "valid-older-4",
      ],
      "valid archives should establish the newest baseline and retain only the bounded history",
    );
    assert.equal(history[0]?.report.setupElapsedMs, 125);
    const baseline = JSON.parse(
      await readFile(
        join(
          fixtureWorkspace,
          "calibration-history/release-concurrency-stress.json",
        ),
        "utf8",
      ),
    ) as { setupElapsedMs: number };
    assert.equal(
      baseline.setupElapsedMs,
      125,
      "the first accepted healthy report should remain the single baseline",
    );
    assert.deepEqual(
      (await readFile(githubEnv, "utf8")).trim().split("\n").sort(),
      [
        `RELEASE_CONCURRENCY_BASELINE_JSON=${join(
          fixtureWorkspace,
          "calibration-history/release-concurrency-stress.json",
        )}`,
        `RELEASE_CONCURRENCY_HISTORY_JSON=${join(
          fixtureWorkspace,
          "calibration-history/release-concurrency-history.json",
        )}`,
      ].sort(),
    );
  } finally {
    await rm(fixtureWorkspace, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await assertApiIntegrationTestShardInventory(rootDir);
  const apiPackageJson = JSON.parse(
    await readFile(
      resolve(rootDir, "artifacts/api-server/package.json"),
      "utf8",
    ),
  ) as { scripts?: Record<string, string> };
  const apiIntegrationTestPaths = (
    await execFile("find", [
      resolve(rootDir, "artifacts/api-server/src"),
      "-name",
      "*.integration.test.ts",
      "-print",
    ])
  ).stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((path) =>
      relative(resolve(rootDir, "artifacts/api-server"), path).replaceAll(
        sep,
        "/",
      ),
    )
    .sort();
  assert.deepEqual(
    apiIntegrationTestShardInventoryErrors(
      apiIntegrationTestPaths,
      apiPackageJson.scripts ?? {},
    ),
    [],
    "every API integration test file must belong to exactly one logical release shard",
  );

  const duplicateFixtureScripts = {
    ...apiPackageJson.scripts,
    [API_RELEASE_INTEGRATION_SCRIPT_NAMES.general[0]]: apiPackageJson.scripts?.[
      API_RELEASE_INTEGRATION_SCRIPT_NAMES.general[0]
    ]?.replace(
      " ! -path 'src/routes/roles.integration.test.ts'",
      "",
    ),
  };
  assert.match(
    apiIntegrationTestShardInventoryErrors(
      apiIntegrationTestPaths,
      duplicateFixtureScripts,
    ).join("\n"),
    /src\/routes\/roles\.integration\.test\.ts/,
    "duplicate assignments must report the affected integration test path",
  );

  const missingFixtureScripts = {
    ...apiPackageJson.scripts,
    [API_RELEASE_INTEGRATION_SCRIPT_NAMES.dedicated.roles[0]]:
      "vitest run src/routes/not-an-integration-test.ts",
  };
  assert.match(
    apiIntegrationTestShardInventoryErrors(
      apiIntegrationTestPaths,
      missingFixtureScripts,
    ).join("\n"),
    /src\/routes\/roles\.integration\.test\.ts/,
    "missing assignments must report the affected integration test path",
  );

  assert.equal(RELEASE_CHECK_API_SHARD_STEPS.length, 7);
  const standardReleaseGateInventory = releaseGateLabelsForMode("standard");
  const fullReleaseGateInventory = releaseGateLabelsForMode("full");
  assert.ok(
    RELEASE_CHECK_API_SHARD_STEPS.every(
      (step) =>
        step.group === "api-test-shards" &&
        step.timeoutMs === API_SHARD_TIMEOUT_MS,
    ),
    "the disposable lane must reuse the exact bounded API release shard definitions",
  );
  assert.ok(
    releaseGateLabelsForMode("standard").every(
      (label) => !label.includes("concurrency stress"),
    ),
    "the disposable lane must not alter the production release gate inventory",
  );
  assert.ok(
    releaseGateLabelsForMode("full").every(
      (label) => !label.includes("concurrency stress"),
    ),
    "the disposable lane must not alter the full release gate inventory",
  );
  await testCalibrationHistoryWorkflow();
  assert.deepEqual(
    releaseGateLabelsForMode("standard"),
    standardReleaseGateInventory,
    "ignored calibration artifacts must not change the standard release gate inventory",
  );
  assert.deepEqual(
    releaseGateLabelsForMode("full"),
    fullReleaseGateInventory,
    "ignored calibration artifacts must not change the full release gate inventory",
  );

  let active = 0;
  let peak = 0;
  const healthyRunner: StressRunStep = async (_step, options) => {
    active += 1;
    peak = Math.max(peak, active);
    options?.onOutput?.("vitest setup complete\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { exitCode: 0, elapsedMs: 20, status: "PASS", output: "" };
  };
  const healthyOutputDirectory = await mkdtemp(
    join(tmpdir(), "release-concurrency-test-"),
  );
  const healthy = await runConcurrencyStress(steps, {
    concurrencyCap: 2,
    runStepFn: healthyRunner,
    outputDirectory: healthyOutputDirectory,
  });
  await access(join(healthyOutputDirectory, "release-concurrency-trend.json"));
  await access(join(healthyOutputDirectory, "release-concurrency-trend.md"));
  assert.equal(healthy.safe, true);
  assert.equal(healthy.peakActiveShards, 2);
  assert.equal(peak, 2);
  assert.equal(healthy.allShardsStarted, true);
  assert.equal(healthy.timeoutFailures, 0);
  assert.equal(healthy.lockFailures, 0);
  assert.match(
    formatConcurrencyStressMarkdown(healthy, "tmp/stress"),
    /Setup time: \d+ms/,
  );
  assert.match(
    formatConcurrencyStressMarkdown(healthy, "tmp/stress"),
    /Peak active shards: 2/,
  );
  const noBaseline = compareConcurrencyStressReports(healthy);
  assert.equal(noBaseline.status, "NO BASELINE");
  assert.equal(noBaseline.setup, null);
  assert.match(
    formatConcurrencyComparisonMarkdown(noBaseline),
    /No comparison was possible/,
  );
  const baseline = {
    ...healthy,
    setupElapsedMs: 100_000,
    totalElapsedMs: 200_000,
  };
  const regressed = compareConcurrencyStressReports(
    {
      ...healthy,
      setupElapsedMs: 130_000,
      totalElapsedMs: 250_000,
    },
    baseline,
  );
  assert.equal(regressed.status, "REGRESSION");
  assert.equal(regressed.setup?.meaningfulRegression, true);
  assert.equal(regressed.totalWallClock?.meaningfulRegression, true);
  assert.match(
    formatConcurrencyComparisonMarkdown(regressed),
    /ALERT: setup time and total wall-clock time/,
  );
  const trend = summarizeConcurrencyStressTrend(
    { ...healthy, setupElapsedMs: 140_000, totalElapsedMs: 240_000 },
    [
      {
        runId: "newest-healthy",
        createdAt: "2026-09-02T10:00:00Z",
        report: {
          ...healthy,
          setupElapsedMs: 120_000,
          totalElapsedMs: 220_000,
        },
      },
      { runId: "malformed", report: { ...healthy, setupElapsedMs: "slow" } },
      {
        runId: "oldest-healthy",
        createdAt: "2026-09-01T10:00:00Z",
        report: {
          ...healthy,
          setupElapsedMs: 100_000,
          totalElapsedMs: 200_000,
        },
      },
      { runId: "unsafe", report: { ...healthy, safe: false } },
    ],
  );
  assert.equal(trend.historicalSampleCount, 2);
  assert.equal(trend.ignoredHistoricalArtifactCount, 2);
  assert.equal(trend.currentRunIncluded, true);
  assert.equal(trend.points.length, 3);
  assert.deepEqual(
    trend.points.map((point) => point.setupMs),
    [100_000, 120_000, 140_000],
  );
  assert.equal(trend.setup?.averageMs, 120_000);
  assert.equal(trend.totalWallClock?.changeMs, 40_000);
  assert.match(
    formatConcurrencyTrendMarkdown(trend),
    /Informational trend only/,
  );
  const boundedTrend = summarizeConcurrencyStressTrend(
    healthy,
    Array.from({ length: 7 }, (_, index) => ({
      runId: `healthy-${index}`,
      report: healthy,
    })),
  );
  assert.equal(boundedTrend.historicalSampleCount, 5);
  assert.equal(boundedTrend.ignoredHistoricalArtifactCount, 2);
  const withinNoise = compareConcurrencyStressReports(
    { ...healthy, setupElapsedMs: 129_999, totalElapsedMs: 249_999 },
    baseline,
  );
  assert.equal(withinNoise.status, "PASS");
  assert.doesNotThrow(() =>
    validateStressEnvironment({
      DATABASE_URL: "postgresql://disposable.example/test",
      NODE_ENV: "test",
      RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB: "1",
    }),
  );
  assert.throws(
    () =>
      validateStressEnvironment({
        DATABASE_URL: "postgresql://unconfirmed.example/test",
        NODE_ENV: "test",
      }),
    /APPROVED_DISPOSABLE_DB=1/,
  );

  const unsafeRunner: StressRunStep = async (step, options) => {
    options?.onOutput?.("vitest setup complete\n");
    return step.label === "shard two"
      ? {
          exitCode: 124,
          elapsedMs: 5,
          status: "INFRASTRUCTURE TIMEOUT",
          output: "deadlock detected while waiting for lock",
        }
      : { exitCode: 0, elapsedMs: 5, status: "PASS", output: "" };
  };
  const unsafe = await runConcurrencyStress(steps.slice(0, 2), {
    concurrencyCap: 2,
    runStepFn: unsafeRunner,
  });
  assert.equal(unsafe.safe, false);
  assert.equal(unsafe.timeoutFailures, 1);
  assert.equal(unsafe.lockFailures, 1);
  assert.match(unsafe.unsafeReasons.join("\n"), /timeout|lock/i);

  console.log(
    "Release concurrency stress tests passed (cap, peak tracking, metrics, unsafe diagnostics).",
  );
}

await run();
