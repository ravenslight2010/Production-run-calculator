import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CALCULATOR_TEST_BUDGET_MS = 150_000;
export const MIN_CALCULATOR_TEST_WORKERS = 4;
export const CALCULATOR_TEST_WORKER_CEILING = 4;
export const DEFAULT_CALCULATOR_TEST_WORKERS = CALCULATOR_TEST_WORKER_CEILING;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function calculatorTestBudgetMs(
  environment = process.env,
) {
  return positiveInteger(
    environment.CALCULATOR_TEST_BUDGET_MS,
    DEFAULT_CALCULATOR_TEST_BUDGET_MS,
  );
}

export function calculatorTestWorkers(
  environment = process.env,
) {
  return positiveInteger(
    environment.CALCULATOR_TEST_WORKERS,
    DEFAULT_CALCULATOR_TEST_WORKERS,
  );
}

export function formatCalculatorTestCapacity(
  availableWorkers,
  workerCeiling = CALCULATOR_TEST_WORKER_CEILING,
) {
  return (
    `Detected runner capacity: ${availableWorkers} available CPU workers; ` +
    `configured worker ceiling: ${workerCeiling}.`
  );
}

export function calculatorTestResourceError(
  availableWorkers,
  minimumWorkers = MIN_CALCULATOR_TEST_WORKERS,
) {
  if (
    Number.isInteger(availableWorkers) &&
    availableWorkers >= minimumWorkers
  ) {
    return null;
  }

  return [
    `Calculator test suite requires at least ${minimumWorkers} available CPU workers.`,
    formatCalculatorTestCapacity(availableWorkers),
    "The standard validation lane is not supported on smaller runners because",
    "the measured two-worker suite exceeded its 150.0s budget (179.3s).",
    `Use a runner with at least ${minimumWorkers} available CPU workers or run targeted checks instead.`,
  ].join(" ");
}

export function summarizeVitestJson(report) {
  const testResults = Array.isArray(report?.testResults)
    ? report.testResults
    : [];

  return {
    files: testResults.length,
    passedFiles: testResults.filter((result) => result?.status === "passed")
      .length,
    failedFiles: testResults.filter((result) => result?.status === "failed")
      .length,
    tests: positiveInteger(report?.numTotalTests, 0),
    passedTests: positiveInteger(report?.numPassedTests, 0),
    failedTests: positiveInteger(report?.numFailedTests, 0),
  };
}

export function formatCalculatorTestSummary(
  summary,
  elapsedMs,
  budgetMs,
  availableWorkers,
  workerCeiling = CALCULATOR_TEST_WORKER_CEILING,
) {
  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
  const budgetSeconds = (budgetMs / 1000).toFixed(1);
  return [
    `Calculator test suite: ${summary.files} files (${summary.passedFiles} passed, ${summary.failedFiles} failed),`,
    `${summary.tests} tests (${summary.passedTests} passed, ${summary.failedTests} failed),`,
    `elapsed ${elapsedSeconds}s (budget ${budgetSeconds}s).`,
    formatCalculatorTestCapacity(availableWorkers, workerCeiling),
  ].join(" ");
}

async function runCalculatorTests() {
  const budgetMs = calculatorTestBudgetMs();
  const configuredWorkers = calculatorTestWorkers();
  const availableWorkers = availableParallelism();
  const resourceError = calculatorTestResourceError(availableWorkers);
  if (resourceError) {
    console.error(resourceError);
    return 1;
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "calculator-vitest-"),
  );
  const reportPath = join(temporaryDirectory, "vitest-report.json");
  const startedAt = performance.now();

  let exitCode = 1;
  let spawnError;
  try {
    exitCode = await new Promise((resolveExitCode) => {
      const child = spawn(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "--reporter=default",
          "--reporter=json",
          `--maxWorkers=${configuredWorkers}`,
          `--outputFile=${reportPath}`,
        ],
        { stdio: "inherit" },
      );

      child.once("error", (error) => {
        spawnError = error;
        resolveExitCode(1);
      });
      child.once("close", (code) => resolveExitCode(code ?? 1));
    });
  } finally {
    const elapsedMs = Math.round(performance.now() - startedAt);

    let summary;
    try {
      summary = summarizeVitestJson(
        JSON.parse(await readFile(reportPath, "utf8")),
      );
    } catch {
      console.error(
        "Calculator test duration guard could not read Vitest's JSON summary; " +
          "the test command may have failed before reporting file/test counts.",
      );
    }

    if (summary) {
      console.log(
        formatCalculatorTestSummary(
          summary,
          elapsedMs,
          budgetMs,
          availableWorkers,
          configuredWorkers,
        ),
      );
    } else {
      console.error(
        `Calculator test suite elapsed ${(
          elapsedMs / 1000
        ).toFixed(1)}s (budget ${(budgetMs / 1000).toFixed(1)}s). ` +
          formatCalculatorTestCapacity(availableWorkers, configuredWorkers),
      );
    }

    if (spawnError) {
      console.error(
        `Calculator test duration guard could not start Vitest: ${spawnError.message}`,
      );
    }

    if (elapsedMs > budgetMs) {
      console.error(
        `Calculator test suite exceeded its ${(
          budgetMs / 1000
        ).toFixed(1)}s validation budget by ${(
          (elapsedMs - budgetMs) /
          1000
        ).toFixed(1)}s.`,
      );
      if (exitCode === 0) {
        exitCode = 1;
      }
    }

    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return exitCode;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runCalculatorTests();
}