import { captureReleaseIdentity } from "../../../scripts/src/release-source-identity.mjs";
import { mkdir } from "node:fs/promises";
import { atomicWriteBrowserMetadata } from "../../../scripts/src/browser-attempt-progress.mjs";
import { WebKitAttemptProgress } from "./webkit-attempt-progress";
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

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_OUTPUT = "release-evidence/browser-smoke/webkit-result.json";
const VALID_CLASSIFICATIONS = [
  "product",
  "test-setup",
  "infrastructure",
  "optional-environment-gap",
] as const;

function relativeFilePath(file: string): string {
  return relative(repositoryRoot, file).replaceAll("\\", "/");
}

type FailureClassification = (typeof VALID_CLASSIFICATIONS)[number];

function errorName(error: TestResult["errors"][number]): string {
  // Older fixture/error adapters supplied a name; Playwright TestError does not
  // require one. Narrow it without assuming an Error instance.
  return "name" in error && typeof error.name === "string" ? error.name : "";
}

type EvidenceCase = {
  file: string;
  title: string;
  projectName: string;
  status: TestResult["status"] | "not-run";
  durationMs: number;
  failureClassification?: FailureClassification;
  error?: string;
};

function revision(): string {
  const configured = process.env.RELEASE_REVISION?.trim();
  if (configured) return configured;
  return captureReleaseIdentity(repositoryRoot).revision;
}

function outputPath(requireConfiguredPath: boolean): string | undefined {
  const configured = process.env.PLAYWRIGHT_RELEASE_SMOKE_EVIDENCE_PATH?.trim();
  if (configured) return resolve(repositoryRoot, configured);
  return requireConfiguredPath ? undefined : resolve(repositoryRoot, DEFAULT_OUTPUT);
}

function classifyFailure(result: TestResult): FailureClassification | undefined {
  if (result.status === "passed" || result.status === "skipped") return undefined;
  const text = result.errors
    .map((error) => `${errorName(error)} ${error.message ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (
    result.status === "timedOut" ||
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
  const name = errorName(first);
  return `${name ? `${name}: ` : ""}${(first.message ?? "Browser test failed.").slice(0, 1_000)}`;
}

export default class ReleaseBrowserEvidenceReporter implements Reporter {
  private readonly cases = new Map<string, EvidenceCase>();
  private readonly requireConfiguredPath: boolean;
  private readonly progress: WebKitAttemptProgress;

  constructor(options?: { requireConfiguredPath?: boolean }) {
    this.requireConfiguredPath = options?.requireConfiguredPath ?? false;
    this.progress = new WebKitAttemptProgress(this.requireConfiguredPath ? "webkit-compatibility" : "webkit-smoke");
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.progress.begin(_config, suite);
    for (const testCase of suite.allTests()) {
      this.cases.set(testCase.id, {
        file: relativeFilePath(testCase.location.file),
        title: testCase.titlePath().join(" › "),
        projectName: testCase.parent.project()?.name ?? "",
        status: "not-run",
        durationMs: 0,
      });
    }
  }

  onTestBegin(testCase: TestCase, result: TestResult): void {
    this.progress.testBegin(testCase, result);
  }

  onError(): void { this.progress.error(); }

  onTestEnd(testCase: TestCase, result: TestResult): void {
    this.progress.testEnd(testCase, result);
    this.cases.set(testCase.id, {
      file: relativeFilePath(testCase.location.file),
      title: testCase.titlePath().join(" › "),
      projectName: testCase.parent.project()?.name ?? "",
      status: result.status,
      durationMs: result.duration,
      failureClassification: classifyFailure(result),
      error: errorSummary(result),
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    const eligible = this.progress.end(result);
    const path = outputPath(this.requireConfiguredPath);
    if (!path || !eligible || [...this.cases.values()].some((entry) =>
      ["not-run", "interrupted", "timedOut"].includes(entry.status))) return;
    const cases = [...this.cases.values()];
    const failed = cases.filter(
      (testCase) => testCase.status !== "passed" && testCase.status !== "skipped",
    );
    await mkdir(resolve(path, ".."), { recursive: true });
    atomicWriteBrowserMetadata(
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
    );
    console.log(`Retained WebKit browser evidence: ${path} (${cases.length} cases)`);
  }
}