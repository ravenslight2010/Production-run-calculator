import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  DURATION_REGRESSION_MIN_INCREASE_MS,
  DURATION_REGRESSION_MIN_INCREASE_PERCENT,
  EXPECTED_CASES,
  canRetainFullBrowserReport,
  findDurationRegressions,
  formatFullBrowserReport,
  parseCompleteFullBrowserBaseline,
  parsePerFileDurations,
} from "./release-duration-reporter.ts";
import {
  FULL_BROWSER_EXPECTED_CASES,
  assertFullBrowserCaseContract,
} from "../../../scripts/src/full-browser-case-contract.mts";

const slowFile = fileURLToPath(new URL("./slow.spec.ts", import.meta.url));
const quietFile = fileURLToPath(new URL("./quiet.spec.ts", import.meta.url));

assert.equal(EXPECTED_CASES, FULL_BROWSER_EXPECTED_CASES);
assert.doesNotThrow(() =>
  assertFullBrowserCaseContract(FULL_BROWSER_EXPECTED_CASES),
);
assert.throws(
  () => assertFullBrowserCaseContract(FULL_BROWSER_EXPECTED_CASES + 1),
  new RegExp(
    `discovered ${FULL_BROWSER_EXPECTED_CASES + 1} cases; expected exactly ${FULL_BROWSER_EXPECTED_CASES}`,
  ),
  "coverage drift must fail with the discovered and configured case counts",
);

const report = formatFullBrowserReport(
  [
    {
      file: slowFile,
      title: "Slow case",
      durationMs: 100_000,
      completed: true,
      status: "passed",
    },
    {
      file: quietFile,
      title: "Quiet case",
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

const completeCases = Array.from({ length: EXPECTED_CASES }, () => ({
  file: slowFile,
  title: "Passing case",
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
assert.deepEqual(
  validBaseline,
  new Map([
    [
      "artifacts/run-calculator/e2e/slow.spec.ts",
      FULL_BROWSER_EXPECTED_CASES * 1_000,
    ],
  ]),
);
assert.equal(canRetainFullBrowserReport(completeCases, "passed"), true);
assert.equal(
  canRetainFullBrowserReport(completeCases.slice(0, -1), "passed"),
  false,
);

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
         durationMs: FULL_BROWSER_EXPECTED_CASES * 1_000 + 41_000,
      },
    ],
    baselineAfterIncompleteRun!,
  ),
  [
    {
      file: "artifacts/run-calculator/e2e/slow.spec.ts",
         durationMs: FULL_BROWSER_EXPECTED_CASES * 1_000 + 41_000,
        baselineDurationMs: FULL_BROWSER_EXPECTED_CASES * 1_000,
       increaseMs: 41_000,
        increasePercent: (41_000 / (FULL_BROWSER_EXPECTED_CASES * 1_000)) * 100,
    },
  ],
);

const comparisonReport = formatFullBrowserReport(
  [
    {
      file: slowFile,
      title: "Slow case",
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
        title: "Slow case",
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

const caseStatusReport = formatFullBrowserReport(
  [
    {
      file: quietFile,
      title: "Skipped case",
      durationMs: 10,
      completed: true,
      status: "skipped",
    },
    {
      file: slowFile,
      title: "Failed case",
      durationMs: 20,
      completed: true,
      status: "failed",
    },
    {
      file: slowFile,
      title: "Timed out case",
      durationMs: 30,
      completed: true,
      status: "timedout",
    },
  ],
  "failed",
  60,
  "current-revision",
);
assert.match(
  caseStatusReport,
  /## Failed and timed-out cases[\s\S]*### `artifacts\/run-calculator\/e2e\/slow\.spec\.ts`[\s\S]*- \*\*FAILED\*\* `Failed case`[\s\S]*- \*\*TIMEDOUT\*\* `Timed out case`/,
);
assert.match(
  caseStatusReport,
  /## Skipped cases[\s\S]*### `artifacts\/run-calculator\/e2e\/quiet\.spec\.ts`[\s\S]*- \*\*SKIPPED\*\* `Skipped case`/,
);
assert.ok(
  caseStatusReport.indexOf("## Skipped cases") >
    caseStatusReport.indexOf("## Failed and timed-out cases"),
);

console.log(
  "Release duration reporter tests passed (baseline parse, thresholds, comparison).",
);