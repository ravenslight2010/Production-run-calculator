import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  DURATION_REGRESSION_MIN_INCREASE_MS,
  DURATION_REGRESSION_MIN_INCREASE_PERCENT,
  EXPECTED_CASES,
  canRetainFullBrowserReport,
  findDurationRegressions,
  formatFullBrowserCountSummary,
  formatFullBrowserReport,
  parseCompleteFullBrowserBaseline,
  parsePerFileDurations,
} from "./release-duration-reporter.ts";
import ReleaseDurationReporter from "./release-duration-reporter.ts";
import {
  FULL_BROWSER_EXCLUDED_CASE_PATTERN,
  FULL_BROWSER_EXPECTED_CASE_IDENTITIES,
  FULL_BROWSER_EXPECTED_CASES,
  assertFullBrowserCaseContract,
  assertFullBrowserCaseIdentityContract,
} from "../../../scripts/src/full-browser-case-contract.mts";

type PlaywrightListSuite = {
  title: string;
  file?: string;
  specs?: Array<{
    file: string;
    title: string;
    tests: Array<{ projectName: string }>;
  }>;
  suites?: PlaywrightListSuite[];
};

function collectPlaywrightCaseIdentities(
  suites: PlaywrightListSuite[],
): string[] {
  const identities: string[] = [];

  function visit(
    currentSuites: PlaywrightListSuite[],
    parentTitlePath: string[],
  ): void {
    for (const suite of currentSuites) {
      const titlePath =
        suite.file && suite.title === suite.file
          ? parentTitlePath
          : [...parentTitlePath, suite.title];

      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
          assert.equal(
            test.projectName,
            "chromium",
            "the full-browser identity inventory only covers Chromium",
          );
          identities.push(
            `artifacts/run-calculator/e2e/${spec.file.replaceAll("\\", "/")} :: ${[
              ...titlePath,
              spec.title,
            ].join(" › ")}`,
          );
        }
      }

      visit(suite.suites ?? [], titlePath);
    }
  }

  visit(suites, []);
  return identities.sort();
}

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const slowFile = fileURLToPath(new URL("./slow.spec.ts", import.meta.url));
const quietFile = fileURLToPath(new URL("./quiet.spec.ts", import.meta.url));

assert.equal(EXPECTED_CASES, FULL_BROWSER_EXPECTED_CASES);
assert.equal(FULL_BROWSER_EXPECTED_CASE_IDENTITIES.length, 216);
assert.equal(
  new Set(FULL_BROWSER_EXPECTED_CASE_IDENTITIES).size,
  FULL_BROWSER_EXPECTED_CASE_IDENTITIES.length,
  "the reviewed Chromium identity inventory must not contain duplicates",
);
assert.doesNotThrow(() =>
  assertFullBrowserCaseContract(FULL_BROWSER_EXPECTED_CASES),
);
assert.throws(
  () => assertFullBrowserCaseContract(FULL_BROWSER_EXPECTED_CASES - 1),
  new RegExp(
    `discovered ${FULL_BROWSER_EXPECTED_CASES - 1} cases; expected exactly ${FULL_BROWSER_EXPECTED_CASES}`,
  ),
  "a stale lower case count must fail with the discovered and configured counts",
);
assert.throws(
  () => assertFullBrowserCaseContract(FULL_BROWSER_EXPECTED_CASES + 1),
  new RegExp(
    `discovered ${FULL_BROWSER_EXPECTED_CASES + 1} cases; expected exactly ${FULL_BROWSER_EXPECTED_CASES}`,
  ),
  "coverage drift must fail with the discovered and configured case counts",
);

function discoverBrowserConfig(config: string): string {
  return execFileSync(
    "pnpm",
    [
      "--filter",
      "@workspace/run-calculator",
      "exec",
      "playwright",
      "test",
      "--config",
      config,
      "--list",
      "--reporter=json",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        // Discovery must not inherit a caller's request to build/start servers.
        RELEASE_BROWSER_LOCAL_SERVERS: "0",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:18082",
        PLAYWRIGHT_API_BASE_URL: "http://127.0.0.1:18081",
      },
      timeout: 60_000,
      maxBuffer: 30 * 1024 * 1024,
    },
  );
}
const discoveryJson = discoverBrowserConfig("playwright.config.ts");
const discoveryReport = JSON.parse(discoveryJson) as {
  config: { projects: Array<{ name: string }>; webServer?: unknown };
  errors: Array<{ message: string }>;
  suites: PlaywrightListSuite[];
};
assert.deepEqual(
  discoveryReport.errors,
  [],
  "the authoritative full-browser Playwright config must discover without errors",
);
assert.deepEqual(
  discoveryReport.config.projects.map((project) => project.name),
  ["chromium"],
  "the full-browser identity set must remain limited to the Chromium project",
);
const discoveredIdentities = collectPlaywrightCaseIdentities(
  discoveryReport.suites,
);
assert.equal(discoveredIdentities.length, FULL_BROWSER_EXPECTED_CASES);
assert.ok(
  discoveredIdentities.every(
    // Playwright grep joins title-path segments with spaces, not our display
    // separator. Keep the exclusion assertion faithful to real discovery.
    (identity) =>
      !FULL_BROWSER_EXCLUDED_CASE_PATTERN.test(identity.replaceAll(" › ", " ")),
  ),
  "dedicated-only, focused-only and physical-device cases must stay outside the Chromium identity set",
);
assert.doesNotThrow(() =>
  assertFullBrowserCaseIdentityContract(discoveredIdentities),
);

// The standalone debug harness deliberately has broader lane ownership than
// default Chromium. Freeze its own complete project/file/title identity set,
// captured before narrowing the file matcher (not the default release count).
// JSON.parse must consume all stdout: slicing off helper diagnostics would hide
// the Node test execution that this regression is meant to catch.
const debugReport = JSON.parse(
  discoverBrowserConfig("playwright.release-debug.config.ts"),
) as typeof discoveryReport;
assert.deepEqual(debugReport.errors, []);
assert.equal(
  debugReport.config.webServer ?? null,
  null,
  "standalone discovery must not configure build/server commands",
);
assert.deepEqual(
  debugReport.config.projects.map((project) => project.name),
  ["chromium"],
);
const debugIdentities = collectPlaywrightCaseIdentities(debugReport.suites);
assert.equal(debugIdentities.length, new Set(debugIdentities).size);
assert.ok(
  debugIdentities.every((identity) => identity.includes(".spec.ts :: ")),
  "standalone discovery must not collect Node/Vitest helper files",
);
assert.equal(
  createHash("sha256").update(JSON.stringify(debugIdentities)).digest("hex"),
  "4de725cd89e5874ca2be37d171ce284f3f260ada8847637dcb6e2c3b5fa2a3cf",
  "standalone Chromium project/file/title identities changed; review its own lane selections, not the default suite count",
);

const addedIdentity =
  "artifacts/run-calculator/e2e/new.spec.ts :: new release case";
assert.throws(
  () =>
    assertFullBrowserCaseIdentityContract([
      ...FULL_BROWSER_EXPECTED_CASE_IDENTITIES,
      addedIdentity,
    ]),
  /Added identities[\s\S]*\+ artifacts\/run-calculator\/e2e\/new\.spec\.ts :: new release case/,
  "an added case must be listed for review",
);
assert.throws(
  () =>
    assertFullBrowserCaseIdentityContract(
      FULL_BROWSER_EXPECTED_CASE_IDENTITIES.slice(1),
    ),
  /Removed identities/,
  "a removed case must be listed for review",
);
assert.throws(
  () =>
    assertFullBrowserCaseIdentityContract([
      ...FULL_BROWSER_EXPECTED_CASE_IDENTITIES.slice(1),
      addedIdentity,
    ]),
  /Added identities[\s\S]*Removed identities/,
  "a same-count substitution must report both the added and removed identities",
);
assert.throws(
  () =>
    assertFullBrowserCaseIdentityContract([
      ...FULL_BROWSER_EXPECTED_CASE_IDENTITIES.slice(1),
      FULL_BROWSER_EXPECTED_CASE_IDENTITIES[1]!,
    ]),
  /Duplicate discovered identities: 1/,
);

// Exercise the reporter entry point, not just the contract helper: a same-count
// replacement or wrong project must fail before any runtime evidence is accepted.
type BeginArgs = Parameters<ReleaseDurationReporter["onBegin"]>;
const reporterConfig = { projects: [{ name: "chromium" }] } as BeginArgs[0];
function reporterSuite(identities: readonly string[], projectName = "chromium") {
  return {
    allTests: () =>
      identities.map((identity, index) => {
        const [file, title] = identity.split(" :: ");
        return {
          id: String(index),
          location: { file: `${repositoryRoot}${file}` },
          parent: { project: () => ({ name: projectName }) },
          titlePath: () => ["", projectName, file, ...title!.split(" › ")],
        };
      }),
  } as unknown as BeginArgs[1];
}
assert.doesNotThrow(() =>
  new ReleaseDurationReporter().onBegin(
    reporterConfig,
    reporterSuite(discoveredIdentities),
  ),
);
assert.throws(
  () =>
    new ReleaseDurationReporter().onBegin(
      reporterConfig,
      reporterSuite([...discoveredIdentities.slice(1), addedIdentity]),
    ),
  /Added identities[\s\S]*Removed identities/,
);
assert.throws(
  () =>
    new ReleaseDurationReporter().onBegin(
      { projects: [{ name: "webkit" }] } as BeginArgs[0],
      reporterSuite(discoveredIdentities, "webkit"),
    ),
  /requires only the chromium project/,
);
assert.throws(
  () =>
    new ReleaseDurationReporter().onBegin(
      reporterConfig,
      reporterSuite(discoveredIdentities, "webkit"),
    ),
  /non-chromium project/,
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
const countSummary = JSON.parse(
  formatFullBrowserCountSummary(
    completeCases,
    "passed",
    "current-revision",
    "github:123456:2",
    "2026-10-06T12:30:00.000Z",
  ),
) as {
  schemaVersion: number;
  browser: string;
  runId: string;
  revision: string;
  result: string;
  generatedAt: string;
  counts: {
    total: number;
    completed: number;
    passed: number;
    failed: number;
    skipped: number;
    notRun: number;
  };
};
assert.deepEqual(countSummary, {
  schemaVersion: 1,
  browser: "chromium",
  runId: "github:123456:2",
  revision: "current-revision",
  result: "passed",
  generatedAt: "2026-10-06T12:30:00.000Z",
  counts: {
    total: EXPECTED_CASES,
    completed: EXPECTED_CASES,
    passed: EXPECTED_CASES,
    failed: 0,
    skipped: 0,
    notRun: 0,
  },
});
assert.ok(
  !JSON.stringify(countSummary).includes("Passing case"),
  "the full-browser summary must not retain case details",
);
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
// Stay above both thresholds as the reviewed case inventory grows.
const retainedBaselineIncreaseMs = Math.max(
  50_000,
  FULL_BROWSER_EXPECTED_CASES * 1_000 * 0.3,
);
assert.deepEqual(
  findDurationRegressions(
    [
      {
        file: "artifacts/run-calculator/e2e/slow.spec.ts",
        durationMs: FULL_BROWSER_EXPECTED_CASES * 1_000 + retainedBaselineIncreaseMs,
      },
    ],
    baselineAfterIncompleteRun!,
  ),
  [
    {
      file: "artifacts/run-calculator/e2e/slow.spec.ts",
      durationMs: FULL_BROWSER_EXPECTED_CASES * 1_000 + retainedBaselineIncreaseMs,
        baselineDurationMs: FULL_BROWSER_EXPECTED_CASES * 1_000,
      increaseMs: retainedBaselineIncreaseMs,
      increasePercent:
        (retainedBaselineIncreaseMs / (FULL_BROWSER_EXPECTED_CASES * 1_000)) * 100,
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
      status: "timedOut",
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