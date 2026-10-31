import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import ReleaseDurationReporter, { formatFullBrowserReport } from "./release-duration-reporter.ts";
import { FULL_BROWSER_EXPECTED_CASE_IDENTITIES } from "../../../scripts/src/full-browser-case-contract.mts";
import { captureReleaseIdentity } from "../../../scripts/src/release-source-identity.mjs";
import { startBrowserAttempt } from "../../../scripts/src/browser-attempt-progress.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const config = {
  workers: 1, globalTimeout: 0,
  projects: [{ name: "chromium", timeout: 60_000, retries: 0 }],
} as FullConfig;
const tests = FULL_BROWSER_EXPECTED_CASE_IDENTITIES.map((identity, index) => {
  const [file, title] = identity.split(" :: ");
  return {
    id: String(index), timeout: 60_000, retries: 0,
    location: { file: resolve(root, file!) },
    parent: { project: () => ({ name: "chromium" }) },
    titlePath: () => ["", "chromium", file!, ...title!.split(" › ")],
  } as unknown as TestCase;
});
const suite = { allTests: () => tests } as Suite;
const result = (status = "passed") => ({
  status, duration: 25, retry: 0, workerIndex: 0, startTime: new Date(),
  errors: [{ message: "PRIVATE-ERROR" }], attachments: [{ path: "PRIVATE-TRACE" }],
}) as TestResult;
const full = (status: FullResult["status"]) => ({ status }) as FullResult;

test("reporter lifecycle retains interrupted metadata and preserves a prior complete report", async (t) => {
  const temporary = mkdtempSync(resolve(tmpdir(), "reporter-progress-"));
  const saved = { ...process.env };
  const identity = captureReleaseIdentity(root);
  const attemptId = startBrowserAttempt({ root, identity });
  const directory = resolve(root, ".local/browser-verification-attempts", attemptId);
  const reportPath = resolve(temporary, "FINAL-REPORT.md");
  const baseline = formatFullBrowserReport(tests.map((entry) => ({
    file: entry.location.file, title: entry.titlePath().join(" › "),
    completed: true, status: "passed" as const, durationMs: 100,
  })), "passed", 100, identity.revision);
  writeFileSync(reportPath, baseline);
  t.after(() => {
    process.env = saved;
    rmSync(temporary, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  });
  process.env.RELEASE_BROWSER_ATTEMPT_ID = attemptId;
  process.env.RELEASE_REVISION = identity.revision;
  process.env.PLAYWRIGHT_RELEASE_REPORT_PATH = reportPath;
  delete process.env.PLAYWRIGHT_RELEASE_COUNT_SUMMARY_PATH;
  const reporter = new ReleaseDurationReporter();
  reporter.onBegin(config, suite);
  reporter.onTestBegin(tests[0]!, result());
  reporter.onTestEnd(tests[0]!, result());
  reporter.onTestBegin(tests[1]!, result());
  const interrupted = JSON.parse(readFileSync(resolve(directory, "progress.json"), "utf8"));
  assert.equal(interrupted.coverage, "INCOMPLETE");
  assert.equal(interrupted.result, null);
  assert.equal(interrupted.cases[0].identity, FULL_BROWSER_EXPECTED_CASE_IDENTITIES[0]);
  assert.equal(interrupted.cases[0].status, "passed");
  assert.equal(interrupted.cases[1].status, "running");
  assert.equal(interrupted.cases[2].status, "not-run");
  assert.doesNotMatch(JSON.stringify(interrupted), /PRIVATE-|exitCode/);
  await reporter.onEnd(full("interrupted"));
  const ended = JSON.parse(readFileSync(resolve(directory, "progress.json"), "utf8"));
  assert.equal(ended.coverage, "INCOMPLETE");
  assert.equal(ended.result, "interrupted");
  assert.equal(readFileSync(reportPath, "utf8"), baseline);
  assert.throws(() => new ReleaseDurationReporter().onBegin(config, suite), /already claimed/);
});

test("complete fake lifecycle finalizes, while storage failure prevents report promotion", async (t) => {
  const temporary = mkdtempSync(resolve(tmpdir(), "reporter-progress-"));
  const saved = { ...process.env };
  const identity = captureReleaseIdentity(root);
  const directories: string[] = [];
  t.after(() => {
    process.env = saved;
    rmSync(temporary, { recursive: true, force: true });
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  });
  process.env.RELEASE_REVISION = identity.revision;
  process.env.PLAYWRIGHT_RELEASE_REPORT_PATH = resolve(temporary, "FINAL-REPORT.md");
  delete process.env.PLAYWRIGHT_RELEASE_COUNT_SUMMARY_PATH;
  for (const fail of [false, true]) {
    const attemptId = startBrowserAttempt({ root, identity });
    const directory = resolve(root, ".local/browser-verification-attempts", attemptId);
    directories.push(directory);
    process.env.RELEASE_BROWSER_ATTEMPT_ID = attemptId;
    const reporter = new ReleaseDurationReporter();
    reporter.onBegin(config, suite);
    for (const entry of tests) {
      reporter.onTestBegin(entry, result());
      reporter.onTestEnd(entry, result());
    }
    const before = fail ? readFileSync(process.env.PLAYWRIGHT_RELEASE_REPORT_PATH, "utf8") : null;
    if (fail) {
      // A real rename failure: progress.json is replaced by a directory. The
      // immutable start.json remains readable even if the progress path is lost.
      rmSync(resolve(directory, "progress.json"));
      const { mkdirSync } = await import("node:fs");
      mkdirSync(resolve(directory, "progress.json"));
    }
    const outcome = await reporter.onEnd(full("passed"));
    if (fail) {
      assert.deepEqual(outcome, { status: "failed" });
      assert.equal(readFileSync(process.env.PLAYWRIGHT_RELEASE_REPORT_PATH, "utf8"), before);
      const start = JSON.parse(readFileSync(resolve(directory, "start.json"), "utf8"));
      assert.equal(start.coverage, "INCOMPLETE");
      assert.equal(start.result, null);
    } else {
      const progress = JSON.parse(readFileSync(resolve(directory, "progress.json"), "utf8"));
      assert.equal(progress.coverage, "COMPLETE");
      assert.equal(progress.result, "passed");
      assert.equal(progress.cases.length, tests.length);
      assert.match(readFileSync(process.env.PLAYWRIGHT_RELEASE_REPORT_PATH, "utf8"), /Coverage: COMPLETE/);
    }
  }
});
