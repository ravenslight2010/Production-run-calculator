import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

const EXPECTED_CASES = 108;
const repositoryRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);
const defaultReportPath = fileURLToPath(
  new URL(
    "../../../release-evidence/browser-full/FINAL-REPORT.md",
    import.meta.url,
  ),
);

type CaseRecord = {
  file: string;
  durationMs: number;
  completed: boolean;
  status: TestResult["status"] | "not-run";
};

type FileSummary = {
  file: string;
  cases: number;
  completed: number;
  passed: number;
  skipped: number;
  failed: number;
  notRun: number;
  durationMs: number;
};

export type FileDuration = {
  file: string;
  durationMs: number;
};

export type DurationRegression = FileDuration & {
  baselineDurationMs: number;
  increaseMs: number;
  increasePercent: number;
};

// Small timing differences are expected between disposable release
// environments. Require both a substantial wall-clock increase and a
// material relative increase before alerting.
export const DURATION_REGRESSION_MIN_INCREASE_MS = 30_000;
export const DURATION_REGRESSION_MIN_INCREASE_PERCENT = 25;

const PER_FILE_DURATION_ROW =
  /^\| `([^`]+)` \| \d+ \| \d+ \| \d+ \| \d+ \| \d+ \| \d+ \| (\d+)ms \|$/gm;
const COMPLETE_FILE_DURATION_ROW =
  /^\| `([^`]+)` \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)ms \|$/gm;

function reportPath(): string {
  const configured = process.env.PLAYWRIGHT_RELEASE_REPORT_PATH?.trim();
  return configured ? resolve(repositoryRoot, configured) : defaultReportPath;
}

function currentRevision(): string {
  const configured = process.env.RELEASE_REVISION?.trim();
  if (configured) return configured;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function relativeFilePath(file: string): string {
  return relative(repositoryRoot, file).replaceAll("\\", "/");
}

function resultLabel(status: FullResult["status"]): string {
  switch (status) {
    case "passed":
      return "PASS";
    case "timedout":
      return "TIMEDOUT";
    case "interrupted":
      return "INTERRUPTED";
    default:
      return "FAIL";
  }
}

function summarizeCases(cases: Iterable<CaseRecord>): FileSummary[] {
  const byFile = new Map<string, FileSummary>();

  for (const testCase of cases) {
    const file = testCase.file;
    const existing = byFile.get(file) ?? {
      file,
      cases: 0,
      completed: 0,
      passed: 0,
      skipped: 0,
      failed: 0,
      notRun: 0,
      durationMs: 0,
    };
    existing.cases += 1;
    existing.completed += testCase.completed ? 1 : 0;
    existing.passed += testCase.status === "passed" ? 1 : 0;
    existing.skipped += testCase.status === "skipped" ? 1 : 0;
    existing.failed +=
      testCase.completed &&
      testCase.status !== "passed" &&
      testCase.status !== "skipped"
        ? 1
        : 0;
    existing.notRun += testCase.status === "not-run" ? 1 : 0;
    existing.durationMs += testCase.durationMs;
    byFile.set(file, existing);
  }

  return [...byFile.values()].sort((left, right) =>
    left.file.localeCompare(right.file),
  );
}

export function parsePerFileDurations(
  report: string,
): Map<string, number> | undefined {
  const durationSection = report
    .split("## Per-file duration\n\n")[1]
    ?.split("\n## ")[0];
  if (!durationSection) return undefined;

  const durations = new Map<string, number>();
  for (const match of durationSection.matchAll(PER_FILE_DURATION_ROW)) {
    durations.set(match[1], Number(match[2]));
  }
  return durations.size > 0 ? durations : undefined;
}

export function parseCompleteFullBrowserBaseline(
  report: string,
): Map<string, number> | undefined {
  const revision = report.match(/^Revision:\s*(\S+)\s*$/m)?.[1];
  const result = report.match(/^Result:\s*(\S+)\s*$/m)?.[1];
  const expectedCases = Number(
    report.match(/^Expected cases:\s*(\d+)\s*$/m)?.[1],
  );
  const enumeratedCases = Number(
    report.match(/^Enumerated cases:\s*(\d+)\s*$/m)?.[1],
  );
  const completedCases = Number(
    report.match(/^Completed cases:\s*(\d+)\s*$/m)?.[1],
  );
  const passedCases = Number(report.match(/^Passed cases:\s*(\d+)\s*$/m)?.[1]);
  const skippedCases = Number(
    report.match(/^Skipped cases:\s*(\d+)\s*$/m)?.[1],
  );
  const failedCases = Number(report.match(/^Failed cases:\s*(\d+)\s*$/m)?.[1]);
  const notRunCases = Number(
    report.match(/^Not-run cases:\s*(\d+)\s*$/m)?.[1],
  );
  const coverage = report.match(/^Coverage:\s*(\S+)\s*$/m)?.[1];
  const durationSection = report
    .split("## Per-file duration\n\n")[1]
    ?.split("\n## ")[0];
  if (
    !durationSection ||
    !revision ||
    revision === "unknown" ||
    result !== "PASS" ||
    coverage !== "COMPLETE" ||
    expectedCases !== EXPECTED_CASES ||
    enumeratedCases !== EXPECTED_CASES ||
    completedCases !== EXPECTED_CASES ||
    !Number.isInteger(passedCases) ||
    !Number.isInteger(skippedCases) ||
    !Number.isInteger(failedCases) ||
    !Number.isInteger(notRunCases) ||
    passedCases + skippedCases !== completedCases ||
    failedCases !== 0 ||
    notRunCases !== 0
  ) {
    return undefined;
  }

  const rows = [...durationSection.matchAll(COMPLETE_FILE_DURATION_ROW)].map(
    (match) => ({
      file: match[1],
      cases: Number(match[2]),
      completed: Number(match[3]),
      passed: Number(match[4]),
      skipped: Number(match[5]),
      failed: Number(match[6]),
      notRun: Number(match[7]),
      durationMs: Number(match[8]),
    }),
  );
  if (rows.length === 0) return undefined;

  const totals = rows.reduce(
    (total, row) => ({
      cases: total.cases + row.cases,
      completed: total.completed + row.completed,
      passed: total.passed + row.passed,
      skipped: total.skipped + row.skipped,
      failed: total.failed + row.failed,
      notRun: total.notRun + row.notRun,
    }),
    {
      cases: 0,
      completed: 0,
      passed: 0,
      skipped: 0,
      failed: 0,
      notRun: 0,
    },
  );
  if (
    totals.cases !== enumeratedCases ||
    totals.completed !== completedCases ||
    totals.passed !== passedCases ||
    totals.skipped !== skippedCases ||
    totals.failed !== failedCases ||
    totals.notRun !== notRunCases
  ) {
    return undefined;
  }

  return new Map(rows.map((row) => [row.file, row.durationMs]));
}

export function canRetainFullBrowserReport(
  cases: Iterable<Pick<CaseRecord, "completed">>,
  fullResult: FullResult["status"],
): boolean {
  const allCases = [...cases];
  return (
    fullResult !== "timedout" &&
    fullResult !== "interrupted" &&
    allCases.length === EXPECTED_CASES &&
    allCases.every((testCase) => testCase.completed)
  );
}

export function findDurationRegressions(
  current: readonly FileDuration[],
  baseline: ReadonlyMap<string, number>,
): DurationRegression[] {
  return current
    .flatMap((file) => {
      const baselineDurationMs = baseline.get(file.file);
      if (
        baselineDurationMs === undefined ||
        baselineDurationMs <= 0 ||
        file.durationMs <= baselineDurationMs
      ) {
        return [];
      }
      const increaseMs = file.durationMs - baselineDurationMs;
      const increasePercent = (increaseMs / baselineDurationMs) * 100;
      if (
        increaseMs < DURATION_REGRESSION_MIN_INCREASE_MS ||
        increasePercent < DURATION_REGRESSION_MIN_INCREASE_PERCENT
      ) {
        return [];
      }
      return [
        {
          ...file,
          baselineDurationMs,
          increaseMs,
          increasePercent,
        },
      ];
    })
    .sort((left, right) => right.increaseMs - left.increaseMs);
}

function formatHistoricalComparison(
  current: readonly FileDuration[],
  baseline: ReadonlyMap<string, number> | undefined,
): string[] {
  const lines = ["## Historical duration comparison", ""];
  if (!baseline) {
    return [
      ...lines,
      "Baseline: unavailable (no parseable prior full browser report).",
      "",
    ];
  }

  const regressions = findDurationRegressions(current, baseline);
  lines.push(
    "Baseline: prior retained full browser report.",
    `Alert thresholds: at least ${DURATION_REGRESSION_MIN_INCREASE_MS / 1000}s and ${DURATION_REGRESSION_MIN_INCREASE_PERCENT}% slower for the same file.`,
    "",
  );
  if (regressions.length === 0) {
    lines.push("No meaningful per-file duration regressions detected.", "");
    return lines;
  }

  lines.push(
    "| File | Prior | Current | Increase |",
    "| --- | ---: | ---: | ---: |",
    ...regressions.map(
      (regression) =>
        `| \`${regression.file}\` | ${Math.round(
          regression.baselineDurationMs,
        )}ms | ${Math.round(regression.durationMs)}ms | +${Math.round(
          regression.increaseMs,
        )}ms (+${regression.increasePercent.toFixed(1)}%) |`,
    ),
    "",
  );
  return lines;
}

export function formatFullBrowserReport(
  cases: Iterable<CaseRecord>,
  fullResult: FullResult["status"],
  durationMs: number,
  revision: string,
  baseline?: ReadonlyMap<string, number>,
): string {
  const summaries = summarizeCases(cases);
  const currentDurations = summaries.map((summary) => ({
    file: relativeFilePath(summary.file),
    durationMs: summary.durationMs,
  }));
  const enumeratedCases = summaries.reduce(
    (total, summary) => total + summary.cases,
    0,
  );
  const completedCases = summaries.reduce(
    (total, summary) => total + summary.completed,
    0,
  );
  const passedCases = summaries.reduce(
    (total, summary) => total + summary.passed,
    0,
  );
  const skippedCases = summaries.reduce(
    (total, summary) => total + summary.skipped,
    0,
  );
  const failedCases = summaries.reduce(
    (total, summary) => total + summary.failed,
    0,
  );
  const notRunCases = summaries.reduce(
    (total, summary) => total + summary.notRun,
    0,
  );
  const coverage =
    enumeratedCases === EXPECTED_CASES && completedCases === EXPECTED_CASES
      ? "COMPLETE"
      : "INCOMPLETE";

  return [
    "# Full Browser Release Run",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Revision: ${revision}`,
    `Result: ${resultLabel(fullResult)}`,
    `Expected cases: ${EXPECTED_CASES}`,
    `Enumerated cases: ${enumeratedCases}`,
    `Completed cases: ${completedCases}`,
    `Passed cases: ${passedCases}`,
    `Skipped cases: ${skippedCases}`,
    `Failed cases: ${failedCases}`,
    `Not-run cases: ${notRunCases}`,
    `Coverage: ${coverage}`,
    `Duration: ${Math.round(durationMs)}ms`,
    "",
    "## Per-file duration",
    "",
    "| File | Cases | Completed | Passed | Skipped | Failed | Not run | Duration |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summaries.map(
      (summary) =>
        `| \`${relativeFilePath(summary.file)}\` | ${summary.cases} | ${
          summary.completed
        } | ${summary.passed} | ${summary.skipped} | ${
          summary.failed
        } | ${summary.notRun} | ${Math.round(
          summary.durationMs,
        )}ms |`,
    ),
    "",
    ...formatHistoricalComparison(currentDurations, baseline),
    "Per-file durations are the sum of Playwright test-result durations. The",
    "suite remains serial (`workers: 1`) and retains all enumerated cases.",
    "",
  ].join("\n");
}

export default class ReleaseDurationReporter implements Reporter {
  private readonly cases = new Map<string, CaseRecord>();
  private startedAt = Date.now();

  onBegin(_config: FullConfig, suite: Suite): void {
    this.startedAt = Date.now();
    for (const testCase of suite.allTests()) {
      this.cases.set(testCase.id, {
        file: testCase.location.file,
        durationMs: 0,
        completed: false,
        status: "not-run",
      });
    }
  }

  onTestEnd(testCase: TestCase, result: TestResult): void {
    const existing = this.cases.get(testCase.id) ?? {
      file: testCase.location.file,
      durationMs: 0,
      completed: false,
      status: "not-run" as const,
    };
    existing.durationMs += result.duration;
    existing.completed = true;
    existing.status = result.status;
    this.cases.set(testCase.id, existing);
  }

  async onEnd(result: FullResult): Promise<void> {
    if (process.argv.includes("--list")) {
      return;
    }
    if (!canRetainFullBrowserReport(this.cases.values(), result.status)) {
      console.log(
        `Retained full browser duration report unchanged: run was not a complete passing ${EXPECTED_CASES}-case suite.`,
      );
      return;
    }
    const path = reportPath();
    let baseline: Map<string, number> | undefined;
    try {
      baseline = parseCompleteFullBrowserBaseline(await readFile(path, "utf8"));
    } catch {
      // A first run, or a missing prior report, simply has no baseline.
    }
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(
      path,
      formatFullBrowserReport(
        this.cases.values(),
        result.status,
        Date.now() - this.startedAt,
        currentRevision(),
        baseline,
      ),
      "utf8",
    );
    console.log(
      `Retained full browser duration report: ${path} (${this.cases.size} cases)`,
    );
  }
}
