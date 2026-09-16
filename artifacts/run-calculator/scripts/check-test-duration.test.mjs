import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { availableParallelism, tmpdir } from "node:os";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CALCULATOR_TEST_BUDGET_MS,
  CALCULATOR_TEST_WORKER_CEILING,
  DEFAULT_CALCULATOR_TEST_WORKERS,
  MIN_CALCULATOR_TEST_WORKERS,
  calculatorTestBudgetMs,
  calculatorTestResourceError,
  calculatorTestWorkers,
  formatCalculatorTestCapacity,
  formatCalculatorTestSummary,
  summarizeVitestJson,
} from "./check-test-duration.mjs";

const durationCheckScript = fileURLToPath(
  new URL("./check-test-duration.mjs", import.meta.url),
);

function runProcess(command, args, options) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectProcess);
    child.once("close", (code, signal) => {
      resolveProcess({ code, signal, stdout, stderr });
    });
  });
}

test("summarizes Vitest files and tests without counting the root suite", () => {
  const summary = summarizeVitestJson({
    numTotalTests: 2_635,
    numPassedTests: 2_635,
    numFailedTests: 0,
    numTotalTestSuites: 283,
    testResults: [
      { name: "first.test.ts", status: "passed" },
      { name: "second.test.ts", status: "passed" },
    ],
  });

  assert.deepEqual(summary, {
    files: 2,
    passedFiles: 2,
    failedFiles: 0,
    tests: 2_635,
    passedTests: 2_635,
    failedTests: 0,
  });
});

test("formats the bounded validation summary", () => {
  assert.equal(
    formatCalculatorTestSummary(
      {
        files: 282,
        passedFiles: 282,
        failedFiles: 0,
        tests: 2_635,
        passedTests: 2_635,
        failedTests: 0,
      },
      89_290,
      150_000,
      8,
    ),
    "Calculator test suite: 282 files (282 passed, 0 failed), 2635 tests " +
      "(2635 passed, 0 failed), elapsed 89.3s (budget 150.0s). " +
      "Detected runner capacity: 8 available CPU workers; configured worker ceiling: 4.",
  );
});

test("executable validation reports detected capacity and worker ceiling", async (t) => {
  const availableWorkers = availableParallelism();
  if (availableWorkers < MIN_CALCULATOR_TEST_WORKERS) {
    t.skip(
      `runner exposes ${availableWorkers} CPU workers; executable prerequisite requires ${MIN_CALCULATOR_TEST_WORKERS}`,
    );
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "calculator-duration-test-"),
  );
  const fakePnpmPath = join(temporaryDirectory, "pnpm");

  try {
    await writeFile(
      fakePnpmPath,
      `#!/bin/sh
for argument
do
  case "$argument" in
    --outputFile=*) output_file="\${argument#*=}" ;;
  esac
done
printf '%s\\n' '{"numTotalTests":1,"numPassedTests":1,"numFailedTests":0,"testResults":[{"name":"stub.test.ts","status":"passed"}]}' > "$output_file"
`,
    );
    await chmod(fakePnpmPath, 0o755);

    const result = await runProcess(process.execPath, [durationCheckScript], {
      env: {
        ...process.env,
        PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(
        `Detected runner capacity: ${availableWorkers} available CPU workers; configured worker ceiling: ${CALCULATOR_TEST_WORKER_CEILING}\\.`,
      ),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("executable validation preserves a failing runner result and report details", async (t) => {
  const availableWorkers = availableParallelism();
  if (availableWorkers < MIN_CALCULATOR_TEST_WORKERS) {
    t.skip(
      `runner exposes ${availableWorkers} CPU workers; executable prerequisite requires ${MIN_CALCULATOR_TEST_WORKERS}`,
    );
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "calculator-duration-test-"),
  );
  const fakePnpmPath = join(temporaryDirectory, "pnpm");
  const runnerExitCode = 23;

  try {
    await writeFile(
      fakePnpmPath,
      `#!/bin/sh
for argument
do
  case "$argument" in
    --outputFile=*) output_file="\${argument#*=}" ;;
  esac
done
printf '%s\n' '{"numTotalTests":2,"numPassedTests":1,"numFailedTests":1,"testResults":[{"name":"stub.test.ts","status":"failed"}]}' > "$output_file"
exit ${runnerExitCode}
`,
    );
    await chmod(fakePnpmPath, 0o755);

    const result = await runProcess(process.execPath, [durationCheckScript], {
      env: {
        ...process.env,
        PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(result.code, runnerExitCode, result.stderr);
    assert.match(
      result.stdout,
      /Calculator test suite: 1 files \(0 passed, 1 failed\), 2 tests \(1 passed, 1 failed\), elapsed \d+\.\d+s \(budget 150\.0s\)\./,
    );
    assert.match(
      result.stdout,
      new RegExp(
        `Detected runner capacity: ${availableWorkers} available CPU workers; configured worker ceiling: ${CALCULATOR_TEST_WORKER_CEILING}\\.`,
      ),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("reports missing Vitest output, cleans up, and preserves runner capacity", async (t) => {
  const availableWorkers = availableParallelism();
  if (availableWorkers < MIN_CALCULATOR_TEST_WORKERS) {
    t.skip(
      `runner exposes ${availableWorkers} CPU workers; executable prerequisite requires ${MIN_CALCULATOR_TEST_WORKERS}`,
    );
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "calculator-duration-missing-report-test-"),
  );
  const fakePnpmPath = join(temporaryDirectory, "pnpm");
  const cleanupMarkerPath = join(temporaryDirectory, "report-path");
  const configuredWorkers = 6;

  try {
    await writeFile(
      fakePnpmPath,
      `#!/bin/sh
for argument
do
  case "$argument" in
    --outputFile=*) output_file="\${argument#*=}" ;;
  esac
done
printf '%s\\n' "$output_file" > "$CLEANUP_MARKER"
exit 23
`,
    );
    await chmod(fakePnpmPath, 0o755);

    const result = await runProcess(process.execPath, [durationCheckScript], {
      env: {
        ...process.env,
        CALCULATOR_TEST_WORKERS: String(configuredWorkers),
        CLEANUP_MARKER: cleanupMarkerPath,
        PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.notEqual(result.code, 0, result.stdout);
    assert.match(
      result.stderr,
      /Calculator test duration guard could not read Vitest's JSON summary/,
    );
    assert.match(
      result.stderr,
      /Calculator test suite elapsed \d+\.\d+s \(budget 150\.0s\)\./,
    );
    assert.match(
      result.stderr,
      new RegExp(
        `Detected runner capacity: ${availableWorkers} available CPU workers; configured worker ceiling: ${configuredWorkers}\\.`,
      ),
    );

    const reportPath = (await readFile(cleanupMarkerPath, "utf8")).trim();
    assert.ok(reportPath, "stub runner should record the requested report path");
    await assert.rejects(stat(dirname(reportPath)), /ENOENT/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("uses the configured worker ceiling in the shared capacity line", () => {
  assert.equal(
    formatCalculatorTestCapacity(4),
    "Detected runner capacity: 4 available CPU workers; configured worker ceiling: 4.",
  );
  assert.equal(CALCULATOR_TEST_WORKER_CEILING, 4);
});

test("uses the default budget and accepts a positive override", () => {
  assert.equal(
    calculatorTestBudgetMs({}),
    DEFAULT_CALCULATOR_TEST_BUDGET_MS,
  );
  assert.equal(calculatorTestBudgetMs({ CALCULATOR_TEST_BUDGET_MS: "90000" }), 90_000);
  assert.equal(
    calculatorTestBudgetMs({ CALCULATOR_TEST_BUDGET_MS: "not-a-duration" }),
    DEFAULT_CALCULATOR_TEST_BUDGET_MS,
  );
});

test("uses four workers by default and accepts a positive override", () => {
  assert.equal(calculatorTestWorkers({}), DEFAULT_CALCULATOR_TEST_WORKERS);
  assert.equal(calculatorTestWorkers({ CALCULATOR_TEST_WORKERS: "6" }), 6);
  assert.equal(
    calculatorTestWorkers({ CALCULATOR_TEST_WORKERS: "not-a-worker-count" }),
    DEFAULT_CALCULATOR_TEST_WORKERS,
  );
});

test("accepts the supported lower-worker boundary", () => {
  assert.equal(
    calculatorTestResourceError(MIN_CALCULATOR_TEST_WORKERS),
    null,
  );
  assert.equal(calculatorTestResourceError(8), null);
});

test("reports the resource prerequisite below the supported boundary", () => {
  assert.match(
    calculatorTestResourceError(MIN_CALCULATOR_TEST_WORKERS - 1),
    /requires at least 4 available CPU workers/i,
  );
  assert.match(
    calculatorTestResourceError(MIN_CALCULATOR_TEST_WORKERS - 1),
    /Detected runner capacity: 3 available CPU workers; configured worker ceiling: 4\./i,
  );
  assert.match(
    calculatorTestResourceError(MIN_CALCULATOR_TEST_WORKERS - 1),
    /two-worker suite exceeded its 150\.0s budget \(179\.3s\)/i,
  );
});