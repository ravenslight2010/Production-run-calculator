import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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

const EXPECTED_CASES = 99;
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

export function formatFullBrowserReport(
  cases: Iterable<CaseRecord>,
  fullResult: FullResult["status"],
  durationMs: number,
  revision: string,
): string {
  const summaries = summarizeCases(cases);
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
    if (
      process.argv.includes("--list") ||
      (!process.env.PLAYWRIGHT_RELEASE_REPORT_PATH &&
        this.cases.size !== EXPECTED_CASES)
    ) {
      return;
    }
    const path = reportPath();
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(
      path,
      formatFullBrowserReport(
        this.cases.values(),
        result.status,
        Date.now() - this.startedAt,
        currentRevision(),
      ),
      "utf8",
    );
    console.log(
      `Retained full browser duration report: ${path} (${this.cases.size} cases)`,
    );
  }
}