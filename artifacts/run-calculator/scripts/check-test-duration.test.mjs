import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CALCULATOR_TEST_BUDGET_MS,
  MIN_CALCULATOR_TEST_WORKERS,
  calculatorTestBudgetMs,
  calculatorTestResourceError,
  formatCalculatorTestSummary,
  summarizeVitestJson,
} from "./check-test-duration.mjs";

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
    ),
    "Calculator test suite: 282 files (282 passed, 0 failed), 2635 tests " +
      "(2635 passed, 0 failed), elapsed 89.3s (budget 150.0s).",
  );
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
    /two-worker suite exceeded its 150\.0s budget \(179\.3s\)/i,
  );
});
