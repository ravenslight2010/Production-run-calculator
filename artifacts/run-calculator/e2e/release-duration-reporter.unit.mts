import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  DURATION_REGRESSION_MIN_INCREASE_MS,
  DURATION_REGRESSION_MIN_INCREASE_PERCENT,
  canRetainFullBrowserReport,
  findDurationRegressions,
  formatFullBrowserReport,
  parseCompleteFullBrowserBaseline,
  parsePerFileDurations,
} from "./release-duration-reporter.ts";

const slowFile = fileURLToPath(new URL("./slow.spec.ts", import.meta.url));
const quietFile = fileURLToPath(new URL("./quiet.spec.ts", import.meta.url));

const report = formatFullBrowserReport(
  [
    {
      file: slowFile,
      durationMs: 100_000,
      completed: true,
      status: "passed",
    },
    {
      file: quietFile,
      durationMs: 125_000,
      completed: true,
      status: "passed",
    },
  ],
  "passed",
  225_000,
  "current-revision",
);
const baseline = new Map([
  ["artifacts/run-calculator/e2e/slow.spec.ts", 60_000],
  ["artifacts/run-calculator/e2e/quiet.spec.ts", 100_000],
]);
const current = parsePerFileDurations(report);

assert.deepEqual(
  current,
  new Map([
    ["artifacts/run-calculator/e2e/quiet.spec.ts", 125_000],
    ["artifacts/run-calculator/e2e/slow.spec.ts", 100_000],
  ]),
);
assert.deepEqual(
  findDurationRegressions(
    [...current!].map(([file, durationMs]) => ({ file, durationMs })),
    baseline,
  ),
  [
    {
      file: "artifacts/run-calculator/e2e/slow.spec.ts",
      durationMs: 100_000,
      baselineDurationMs: 60_000,
      increaseMs: 40_000,
      increasePercent: (40_000 / 60_000) * 100,
    },
  ],
);

assert.equal(
  findDurationRegressions(
    [
      {
        file: "large-enough",
        durationMs: 60_000 + DURATION_REGRESSION_MIN_INCREASE_MS + 1,
      },
      {
        file: "percent-only",
        durationMs: 100_000 + DURATION_REGRESSION_MIN_INCREASE_MS - 1,
      },
      { file: "faster", durationMs: 1 },
      { file: "new-file", durationMs: 500_000 },
    ],
    new Map([
      ["large-enough", 60_000],
      ["percent-only", 100_000],
      ["faster", 100_000],
    ]),
  ).length,
  1,
);
assert.equal(DURATION_REGRESSION_MIN_INCREASE_PERCENT, 25);

const completeCases = Array.from({ length: 100 }, () => ({
  file: slowFile,
  durationMs: 1_000,
  completed: true,
  status: "passed" as const,
}));
const validBaselineReport = formatFullBrowserReport(
  completeCases,
  "passed",
  100_000,
  "prior-revision",
);
const validBaseline = parseCompleteFullBrowserBaseline(validBaselineReport);
assert.deepEqual(validBaseline, new Map([["artifacts/run-calculator/e2e/slow.spec.ts", 100_000]]));
assert.equal(canRetainFullBrowserReport(completeCases, "passed"), true);

const incompleteCases = completeCases.map((testCase) => ({
  ...testCase,
  completed: false,
  status: "not-run" as const,
  durationMs: 0,
}));
const incompleteReport = formatFullBrowserReport(
  incompleteCases,
  "timedout",
  100_000,
  "interrupted-revision",
);
assert.equal(
  canRetainFullBrowserReport(incompleteCases, "timedout"),
  false,
);
assert.equal(parseCompleteFullBrowserBaseline(incompleteReport), undefined);
const baselineAfterIncompleteRun =
  parseCompleteFullBrowserBaseline(incompleteReport) ?? validBaseline;
assert.deepEqual(
  findDurationRegressions(
    [
      {
        file: "artifacts/run-calculator/e2e/slow.spec.ts",
        durationMs: 140_000,
      },
    ],
    baselineAfterIncompleteRun!,
  ),
  [
    {
      file: "artifacts/run-calculator/e2e/slow.spec.ts",
      durationMs: 140_000,
      baselineDurationMs: 100_000,
      increaseMs: 40_000,
      increasePercent: 40,
    },
  ],
);

const comparisonReport = formatFullBrowserReport(
  [
    {
      file: slowFile,
      durationMs: 100_000,
      completed: true,
      status: "passed",
    },
  ],
  "passed",
  100_000,
  "current-revision",
  new Map([["artifacts/run-calculator/e2e/slow.spec.ts", 60_000]]),
);
assert.match(comparisonReport, /## Historical duration comparison/);
assert.match(
  comparisonReport,
  /\| `artifacts\/run-calculator\/e2e\/slow\.spec\.ts` \| 60000ms \| 100000ms \| \+40000ms \(\+66\.7%\) \|/,
);
assert.match(
  formatFullBrowserReport(
    [
      {
        file: slowFile,
        durationMs: 100_000,
        completed: true,
        status: "passed",
      },
    ],
    "passed",
    100_000,
    "current-revision",
  ),
  /Baseline: unavailable/,
);

console.log(
  "Release duration reporter tests passed (baseline parse, thresholds, comparison).",
);