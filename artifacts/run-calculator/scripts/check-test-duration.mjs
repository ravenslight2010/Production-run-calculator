import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CALCULATOR_TEST_BUDGET_MS = 150_000;

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
) {
  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
  const budgetSeconds = (budgetMs / 1000).toFixed(1);
  return [
    `Calculator test suite: ${summary.files} files (${summary.passedFiles} passed, ${summary.failedFiles} failed),`,
    `${summary.tests} tests (${summary.passedTests} passed, ${summary.failedTests} failed),`,
    `elapsed ${elapsedSeconds}s (budget ${budgetSeconds}s).`,
  ].join(" ");
}

async function runCalculatorTests() {
  const budgetMs = calculatorTestBudgetMs();
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
      console.log(formatCalculatorTestSummary(summary, elapsedMs, budgetMs));
    } else {
      console.error(
        `Calculator test suite elapsed ${(
          elapsedMs / 1000
        ).toFixed(1)}s (budget ${(budgetMs / 1000).toFixed(1)}s).`,
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
      exitCode = 1;
    }

    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return exitCode;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runCalculatorTests();
}