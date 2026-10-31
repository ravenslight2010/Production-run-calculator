import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import EvidenceReporter from "./release-browser-evidence-reporter.ts";
import DebugReporter from "./compatibility-debug-reporter.ts";
import { captureReleaseIdentity } from "../../../scripts/src/release-source-identity.mjs";
import { startBrowserAttempt } from "../../../scripts/src/browser-attempt-progress.mjs";
import { WEBKIT_EXPECTED_CASE_IDENTITIES, WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES } from "../../../scripts/src/webkit-case-contract.mts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
// Load the real configuration without resolving/installing browser runtimes.
// These placeholders are config-only: no executable, Nix command or browser runs.
const compatibilityConfig = await (async () => {
  const saved = { ...process.env };
  try {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = process.execPath;
    process.env.PLAYWRIGHT_WEBKIT_LIBRARY_PATH = "/fixture/config-only/lib";
    process.env.GIO_EXTRA_MODULES = "/fixture/config-only/gio";
    return (await import("../playwright.compatibility.config.ts")).default;
  } finally {
    process.env = saved;
  }
})();
const event = (status = "passed", retry = 0) => ({
  status, retry, workerIndex: retry, duration: 25, startTime: new Date(),
  errors: [{ message: "PRIVATE-ERROR" }], attachments: [], steps: [],
  stdout: ["PRIVATE-OUTPUT"],
}) as unknown as TestResult;
const full = (status: FullResult["status"]) => ({ status }) as FullResult;

for (const responsive of [false, true]) {
  const lane = responsive ? "webkit-compatibility" : "webkit-smoke";
  const tests = (responsive ? WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES : WEBKIT_EXPECTED_CASE_IDENTITIES)
    .map((identity, index) => {
      const [file, value] = identity.split(" :: ");
      const parts = value!.split(" › ");
      const project = responsive ? parts.shift()! : "webkit";
      return {
        id: `${project}-${index}`, title: parts.at(-1)!, timeout: 75_000, retries: 0,
        expectedStatus: "passed", location: { file: resolve(root, file!), line: 1, column: 1 },
        parent: { project: () => ({ name: project }) },
        titlePath: () => ["", project, file!, ...parts],
      } as unknown as TestCase;
    });
  const config = {
    outputDir: "/unused", workers: 1, globalTimeout: responsive ? 900_000 : 360_000,
    projects: responsive ? compatibilityConfig.projects!.map((project) => ({
      name: project.name, timeout: project.timeout ?? compatibilityConfig.timeout,
      retries: project.retries ?? compatibilityConfig.retries,
    })) : [{ name: "webkit", timeout: 75_000, retries: 0 }],
  } as unknown as FullConfig;
  if (responsive) {
    assert(config.projects.some((project) => project.name === "desktop-chromium"));
    assert(config.projects.some((project) => project.name === "desktop-webkit"));
    assert(config.projects.some((project) => project.name === "tablet-landscape-webkit"));
    assert(config.projects.length > 2, "FullConfig retains unselected projects");
  }
  const suite = { allTests: () => tests } as Suite;

  for (const mode of ["abandoned", "passed", "interrupted", "timedout", "error", "write-fault", "final-write-fault", "inventory-mismatch", ...(responsive ? ["debug-write-fault", "extra-project"] : [])]) {
    test(`${lane}: ${mode} preserves independent bounded progress`, async (t) => {
      const saved = { ...process.env };
      const temporary = mkdtempSync(resolve(tmpdir(), "webkit-progress-"));
      const identity = captureReleaseIdentity(root);
      const budgets = { timeoutMs: 1_800_000, warningMs: 1_500_000 };
      const id = startBrowserAttempt({ root, identity, lane, runnerBudgets: budgets });
      const debugId = responsive ? startBrowserAttempt({
        root, identity, lane: "webkit-compatibility-debug", runnerBudgets: budgets,
      }) : undefined;
      const directory = (attempt: string) => resolve(root, ".local/browser-verification-attempts", attempt);
      t.after(() => {
        process.env = saved;
        rmSync(temporary, { recursive: true, force: true });
        for (const attempt of [id, debugId]) if (attempt) rmSync(directory(attempt), { recursive: true, force: true });
      });
      delete process.env.RELEASE_BROWSER_ATTEMPT_ID;
      process.env.RELEASE_WEBKIT_ATTEMPT_ID = id;
      if (debugId) process.env.RELEASE_WEBKIT_DEBUG_ATTEMPT_ID = debugId;
      process.env.RELEASE_REVISION = identity.revision;
      const output = resolve(temporary, "webkit-result.json");
      process.env.PLAYWRIGHT_RELEASE_SMOKE_EVIDENCE_PATH = output;
      // Disable unrelated CI screenshot publishing in these metadata fixtures.
      delete process.env.PLAYWRIGHT_COMPATIBILITY_DEBUG_DIR;
      writeFileSync(output, "PRIOR COMPLETE REPORT\n");
      const reporter = new EvidenceReporter({ requireConfiguredPath: responsive });
      const debug = responsive ? new DebugReporter() : undefined;
      const executedTests = mode === "inventory-mismatch" ? tests.slice(1) :
        mode === "extra-project" ? [...tests, {
          ...tests[0], id: "extra-chromium-case",
          parent: { project: () => ({ name: "desktop-chromium" }) },
          titlePath: () => ["", "desktop-chromium", "file", tests[0]!.title],
        } as unknown as TestCase] : tests;
      const selectedSuite = executedTests === tests ? suite :
        { allTests: () => executedTests } as Suite;
      reporter.onBegin(config, selectedSuite);
      debug?.onBegin(config, selectedSuite);
      const read = (attempt = id, file = "progress.json") =>
        JSON.parse(readFileSync(resolve(directory(attempt), file), "utf8"));
      assert.equal(read().lane, lane);
      assert.deepEqual(read().originalRunnerBudgets, budgets);
      assert.equal(read().originalPlaywrightBudgets.workers, 1);
      assert.equal(read().originalPlaywrightBudgets.globalTimeoutMs, config.globalTimeout);
      assert.deepEqual(read().originalPlaywrightBudgets.projects, config.projects.map((project) => ({
        name: project.name, timeoutMs: project.timeout, retries: project.retries,
      })), "retain all configured budgets, including unselected projects");
      assert.equal(read().cases[0].projectName, (mode === "inventory-mismatch" ? tests[1] : tests[0])!.parent.project()!.name);
      if (mode === "debug-write-fault") {
        const progress = resolve(directory(debugId!), "progress.json");
        // Keep the old checkpoint as a readable fixture; force the next rename to fail.
        const retained = readFileSync(progress, "utf8");
        rmSync(progress);
        mkdirSync(progress);
        writeFileSync(resolve(progress, "retained"), retained);
        assert.throws(() => debug!.onTestBegin(tests[0]!, event()), /checkpoint failed/);
        await assert.rejects(debug!.onEnd(full("passed")), /closed/);
        assert.equal(read(debugId!, "start.json").coverage, "INCOMPLETE");
        assert.equal(JSON.parse(readFileSync(resolve(progress, "retained"), "utf8")).coverage, "INCOMPLETE");
        assert.equal(read().result, null, "failure does not finalize the independent evidence lane");
      } else if (mode === "write-fault") {
        // A real rename fault after startup: no previous snapshot is truncated.
        rmSync(resolve(directory(id), "progress.json"));
        mkdirSync(resolve(directory(id), "progress.json"));
        assert.throws(() => reporter.onTestBegin(tests[0]!, event()), /checkpoint failed/);
        assert.equal(read(id, "start.json").coverage, "INCOMPLETE");
        await assert.rejects(reporter.onEnd(full("passed")), /closed/);
      } else {
        for (const entry of executedTests) {
          reporter.onTestBegin(entry, event());
          debug?.onTestBegin(entry, event());
          if (mode === "abandoned") break;
          reporter.onTestEnd(entry, event());
          debug?.onTestEnd(entry, event());
        }
        if (mode === "abandoned") {
          assert.equal(read().result, null);
          assert.equal(read().cases[0].status, "running");
        } else {
          if (mode === "error") { reporter.onError(); debug?.onError(); }
          const outcome = mode === "interrupted" || mode === "timedout" ? mode : "passed";
          if (mode === "final-write-fault") {
            rmSync(output);
            mkdirSync(output);
            writeFileSync(resolve(output, "prior"), "PRIOR COMPLETE REPORT\n");
            await assert.rejects(reporter.onEnd(full(outcome)));
            assert.equal(readFileSync(resolve(output, "prior"), "utf8"), "PRIOR COMPLETE REPORT\n");
          } else {
            await reporter.onEnd(full(outcome));
          }
          await debug?.onEnd(full(outcome));
          assert.equal(read().coverage, ["passed", "final-write-fault"].includes(mode) ? "COMPLETE" : "INCOMPLETE");
        }
        assert.doesNotMatch(JSON.stringify(read()), /PRIVATE-|exitCode/);
        if (debugId) {
          assert.equal(read(debugId).lane, "webkit-compatibility-debug");
          assert.notEqual(read().attemptId, read(debugId).attemptId);
          assert.equal(read(debugId).coverage, mode === "extra-project" ? "COMPLETE" : read().coverage);
          assert.doesNotMatch(JSON.stringify(read(debugId)), /PRIVATE-/);
        }
      }
      if (mode === "passed") {
        const final = JSON.parse(readFileSync(output, "utf8"));
        assert.equal(final.browser, "webkit");
        assert.equal(final.caseCount, tests.length);
        assert.equal(final.revision, identity.revision);
      } else if (mode !== "final-write-fault") {
        assert.equal(readFileSync(output, "utf8"), "PRIOR COMPLETE REPORT\n");
      }
    });
  }
}
