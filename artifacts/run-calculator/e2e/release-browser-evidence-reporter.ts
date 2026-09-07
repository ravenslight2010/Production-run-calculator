import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_OUTPUT = "release-evidence/browser-smoke/webkit-result.json";
const VALID_CLASSIFICATIONS = [
  "product",
  "test-setup",
  "infrastructure",
  "optional-environment-gap",
] as const;

type FailureClassification = (typeof VALID_CLASSIFICATIONS)[number];

type EvidenceCase = {
  file: string;
  title: string;
  status: TestResult["status"] | "not-run";
  durationMs: number;
  failureClassification?: FailureClassification;
  error?: string;
};

function revision(): string {
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

function outputPath(): string {
  const configured = process.env.PLAYWRIGHT_RELEASE_SMOKE_EVIDENCE_PATH?.trim();
  return configured ? resolve(repositoryRoot, configured) : resolve(repositoryRoot, DEFAULT_OUTPUT);
}

function classifyFailure(result: TestResult): FailureClassification | undefined {
  if (result.status === "passed" || result.status === "skipped") return undefined;
  const text = result.errors
    .map((error) => `${error.name ?? ""} ${error.message ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (
    result.status === "timedout" ||
    /browser.*(launch|closed|crash)|target page, context or browser has been closed|econnrefused|timeout.*database|playwright.*executable|executable doesn't exist|missing librar(?:y|ies)|host system is missing/u.test(
      text,
    )
  ) {
    return "infrastructure";
  }
  if (/fixture|setup|selector|waiting for|database.*(schema|relation)|sign.?up code/u.test(text)) {
    return "test-setup";
  }
  return "product";
}

function errorSummary(result: TestResult): string | undefined {
  const first = result.errors[0];
  if (!first) return undefined;
  return `${first.name ? `${first.name}: ` : ""}${first.message.slice(0, 1_000)}`;
}

export default class ReleaseBrowserEvidenceReporter implements Reporter {
  private readonly cases = new Map<string, EvidenceCase>();

  onBegin(_config: FullConfig, suite: Suite): void {
    for (const testCase of suite.allTests()) {
      this.cases.set(testCase.id, {
        file: testCase.location.file,
        title: testCase.titlePath().join(" › "),
        status: "not-run",
        durationMs: 0,
      });
    }
  }

  onTestEnd(testCase: TestCase, result: TestResult): void {
    this.cases.set(testCase.id, {
      file: testCase.location.file,
      title: testCase.titlePath().join(" › "),
      status: result.status,
      durationMs: result.duration,
      failureClassification: classifyFailure(result),
      error: errorSummary(result),
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    const cases = [...this.cases.values()];
    const failed = cases.filter(
      (testCase) => testCase.status !== "passed" && testCase.status !== "skipped",
    );
    const path = outputPath();
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          browser: "webkit",
          revision: revision(),
          environment:
            process.env.RELEASE_BROWSER_ENVIRONMENT?.trim() ||
            (process.env.CI ? "ci" : "development"),
          result: result.status,
          generatedAt: new Date().toISOString(),
          caseCount: cases.length,
          completedCount: cases.filter((testCase) => testCase.status !== "not-run").length,
          failureCount: failed.length,
          failureClassifications: Object.fromEntries(
            VALID_CLASSIFICATIONS.map((classification) => [
              classification,
              failed.filter((testCase) => testCase.failureClassification === classification).length,
            ]),
          ),
          cases,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`Retained WebKit browser evidence: ${path} (${cases.length} cases)`);
  }
}