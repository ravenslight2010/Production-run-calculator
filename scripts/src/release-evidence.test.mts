import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RELEASE_EVIDENCE_ALLOWLIST,
  defaultReleaseEvidenceDir,
  formatReleaseReport,
  parseBrowserDurationRegressions,
  releaseGateLabelsForMode,
  runStep,
  resolveReleaseEvidenceDir,
  validateFullBrowserReport,
  validateReleaseReport,
  verifyReleaseEvidence,
} from "./release-check.mts";

async function fixture(
  files: readonly string[] = ["release-check-report.md"],
  report = "fixture evidence\n",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-evidence-"));
  for (const file of files) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      file === "release-check-report.md" ? report : "fixture evidence\n",
    );
  }
  return root;
}

async function run(): Promise<void> {
  assert.equal(
    defaultReleaseEvidenceDir("standard"),
    "release-evidence",
    "standard release checks should use their own default evidence directory",
  );
  assert.equal(
    defaultReleaseEvidenceDir("full"),
    "release-evidence-full",
    "full release checks should use their own default evidence directory",
  );
  assert.notEqual(
    defaultReleaseEvidenceDir("standard"),
    defaultReleaseEvidenceDir("full"),
    "standard and full release checks must not share default evidence paths",
  );
  assert.equal(
    releaseGateLabelsForMode("full").at(-1),
    "full browser E2E suite",
    "full evidence verification must derive the full browser gate from report mode",
  );
  assert.equal(
    resolveReleaseEvidenceDir("standard", "release-evidence-single-run"),
    "release-evidence-single-run",
    "an explicit evidence directory must remain an exact override",
  );
  assert.equal(
    resolveReleaseEvidenceDir("full", "release-evidence-single-run"),
    "release-evidence-single-run",
    "an explicit full-mode evidence directory must remain an exact override",
  );

  const timedOut = await runStep({
    label: "timed-out fixture",
    args: ["exec", "node", "-e", "setTimeout(() => {}, 5000)"],
    timeoutMs: 50,
  });
  assert.equal(timedOut.exitCode, 124);
  assert.equal(timedOut.status, "INFRASTRUCTURE TIMEOUT");
  assert.match(
    formatReleaseReport([
      {
        label: "timed-out fixture",
        status: timedOut.status,
        elapsedMs: timedOut.elapsedMs,
      },
    ]),
    /\| timed-out fixture \| INFRASTRUCTURE TIMEOUT \|/,
  );
  const validLabels = ["gate one", "gate two"];
  const validReport = formatReleaseReport(
    validLabels.map((label) => ({
      label,
      status: "PASS" as const,
      elapsedMs: 100,
    })),
    "standard",
    new Set(),
    {
      revision: "current-revision",
      environment: "disposable release test",
      decision: "GO",
    },
  );
  assert.doesNotThrow(() =>
    validateReleaseReport(validReport, {
      currentRevision: "current-revision",
      expectedMode: "standard",
      expectedLabels: validLabels,
    }),
  );
  const browserDurationReport = [
    "## Historical duration comparison",
    "",
    "Baseline: prior retained full browser report.",
    "Alert thresholds: at least 30s and 25% slower for the same file.",
    "",
    "| File | Prior | Current | Increase |",
    "| --- | ---: | ---: | ---: |",
    "| `e2e/slow.spec.ts` | 60000ms | 100000ms | +40000ms (+66.7%) |",
    "",
  ].join("\n");
  assert.deepEqual(parseBrowserDurationRegressions(browserDurationReport), [
    {
      file: "e2e/slow.spec.ts",
      baselineDurationMs: 60_000,
      durationMs: 100_000,
      increaseMs: 40_000,
      increasePercent: 66.7,
    },
  ]);
  const alertingReleaseReport = formatReleaseReport(
    validLabels.map((label) => ({
      label,
      status: "PASS" as const,
      elapsedMs: 100,
    })),
    "full",
    new Set(),
    {
      revision: "current-revision",
      environment: "disposable release test",
      decision: "GO",
      browserDurationRegressions: parseBrowserDurationRegressions(
        browserDurationReport,
      ),
    },
  );
  assert.match(
    alertingReleaseReport,
    /ALERT: meaningful per-file duration regressions detected:/,
  );
  assert.match(
    alertingReleaseReport,
    /`e2e\/slow\.spec\.ts`: \+40000ms \(\+66\.7%\)/,
  );
  assert.doesNotThrow(() =>
    validateReleaseReport(alertingReleaseReport, {
      currentRevision: "current-revision",
      expectedMode: "full",
      expectedLabels: validLabels,
    }),
  );
  assert.throws(
    () =>
      validateReleaseReport(validReport, {
        currentRevision: "stale-revision",
        expectedMode: "standard",
        expectedLabels: validLabels,
      }),
    /stale/,
    "a report from another revision must be rejected",
  );
  assert.throws(
    () =>
      validateReleaseReport(
        validReport.replace("| gate two | PASS |", "| gate two | FAIL |"),
        {
          currentRevision: "current-revision",
          expectedMode: "standard",
          expectedLabels: validLabels,
        },
      ),
    /every applicable gate is PASS/,
    "GO with a failed gate must be rejected",
  );
  assert.throws(
    () =>
      validateReleaseReport(
        validReport.replace("| gate two | PASS |", "| gate two | INFRASTRUCTURE TIMEOUT |"),
        {
          currentRevision: "current-revision",
          expectedMode: "standard",
          expectedLabels: validLabels,
        },
      ),
    /every applicable gate is PASS/,
    "GO with an infrastructure timeout must be rejected",
  );
  assert.throws(
    () =>
      validateReleaseReport(validReport.replace("Commands:", "Commandz:"), {
        currentRevision: "current-revision",
        expectedMode: "standard",
        expectedLabels: validLabels,
      }),
    /malformed/,
    "a partial report must be rejected",
  );

  const failedChild = await runStep({
    label: "failed-child fixture",
    args: ["exec", "node", "-e", "process.exit(7)"],
  });
  assert.equal(failedChild.exitCode, 7);
  assert.equal(failedChild.status, "FAIL");
  assert.match(
    formatReleaseReport([
      {
        label: "failed-child fixture",
        status: failedChild.status,
        elapsedMs: failedChild.elapsedMs,
      },
    ]),
    /\| failed-child fixture \| FAIL \|/,
  );

  const signaledChild = await runStep({
    label: "signaled-child fixture",
    command: process.execPath,
    args: ["-e", "process.kill(process.pid, 'SIGTERM')"],
  });
  assert.equal(signaledChild.exitCode, 1);
  assert.equal(signaledChild.status, "INFRASTRUCTURE ERROR");
  assert.match(
    formatReleaseReport([
      {
        label: "signaled-child fixture",
        status: signaledChild.status,
        elapsedMs: signaledChild.elapsedMs,
      },
    ]),
    /\| signaled-child fixture \| INFRASTRUCTURE ERROR \|/,
  );

  const allowlistedFiles = [...RELEASE_EVIDENCE_ALLOWLIST];
  const root = await fixture(allowlistedFiles, validReport);
  try {
    await assert.doesNotReject(
      verifyReleaseEvidence(root, {
        currentRevision: "current-revision",
        expectedMode: "standard",
        expectedLabels: validLabels,
      }),
      "an allowlisted evidence set should pass",
    );

    await rm(join(root, "release-check-report.md"));
    await assert.rejects(
      verifyReleaseEvidence(root),
      /release-check-report\.md \(missing\)/,
      "a missing report should be clearly identified",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const forbiddenRoot = await fixture();
  try {
    await writeFile(join(forbiddenRoot, "debug.log"), "not retained\n");
    await assert.rejects(
      verifyReleaseEvidence(forbiddenRoot),
      /- debug\.log/,
      "a forbidden file should be listed in the validation error",
    );
  } finally {
    await rm(forbiddenRoot, { recursive: true, force: true });
  }

  const missingModeRoot = await fixture(
    RELEASE_EVIDENCE_ALLOWLIST,
    validReport.replace("Mode: standard\n", ""),
  );
  try {
    await assert.rejects(
      verifyReleaseEvidence(missingModeRoot, {
        currentRevision: "current-revision",
        expectedLabels: validLabels,
      }),
      /Release report mode is missing or invalid; regenerate the report/,
      "a report without a mode must explain how to recover",
    );
  } finally {
    await rm(missingModeRoot, { recursive: true, force: true });
  }

  const fullRoot = await fixture(
    RELEASE_EVIDENCE_ALLOWLIST.filter((file) => !file.startsWith("browser-full/")),
    formatReleaseReport(
      validLabels.map((label) => ({
        label,
        status: "PASS" as const,
        elapsedMs: 100,
      })),
      "full",
      new Set(),
      {
        revision: "current-revision",
        environment: "disposable release test",
        decision: "NO-GO",
      },
    ),
  );
  const standardModeRoot = await fixture(
    RELEASE_EVIDENCE_ALLOWLIST,
    validReport,
  );
  try {
    await assert.rejects(
      verifyReleaseEvidence(fullRoot, {
        currentRevision: "current-revision",
        expectedLabels: validLabels,
      }),
      /browser-full\/FINAL-REPORT\.md/,
      "full mode must require browser evidence",
    );
    const validBrowserReport = [
      "# Full Browser Release Run",
      "",
      "Revision: current-revision",
      "Result: FAIL",
      "Expected cases: 112",
      "Enumerated cases: 112",
      "Completed cases: 0",
      "Passed cases: 0",
      "Skipped cases: 0",
      "Failed cases: 0",
      "Not-run cases: 112",
      "Coverage: INCOMPLETE",
      "Duration: 0ms",
      "## Per-file duration",
      "",
      "| File | Cases | Completed | Passed | Skipped | Failed | Not run | Duration |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      "| `e2e/example.spec.ts` | 112 | 0 | 0 | 0 | 0 | 112 | 0ms |",
      "",
    ].join("\n");
    const invalidPassingBrowserReport = validBrowserReport
      .replace("Result: FAIL", "Result: PASS")
      .replace("Completed cases: 0", "Completed cases: 112")
      .replace("Passed cases: 0", "Passed cases: 111")
      .replace("Failed cases: 0", "Failed cases: 1")
      .replace("Not-run cases: 112", "Not-run cases: 0")
      .replace("Coverage: INCOMPLETE", "Coverage: COMPLETE")
      .replace(
        "| `e2e/example.spec.ts` | 112 | 0 | 0 | 0 | 0 | 112 | 0ms |",
        "| `e2e/example.spec.ts` | 112 | 112 | 111 | 0 | 1 | 0 | 0ms |",
      );
    assert.throws(
      () => validateFullBrowserReport(invalidPassingBrowserReport, {
        currentRevision: "current-revision",
        requirePass: true,
      }),
      /passed or was explicitly skipped/,
      "GO verification must reject a browser report containing failed cases",
    );
    await mkdir(join(fullRoot, "browser-full"), { recursive: true });
    await writeFile(
      join(fullRoot, "browser-full/FINAL-REPORT.md"),
      validBrowserReport,
      "utf8",
    );
    await assert.doesNotReject(
      verifyReleaseEvidence(fullRoot, {
        currentRevision: "current-revision",
        expectedLabels: validLabels,
      }),
      "the report mode should automatically select the full evidence contract",
    );
    await assert.rejects(
      verifyReleaseEvidence(fullRoot, {
        currentRevision: "current-revision",
        expectedMode: "standard",
        expectedLabels: validLabels,
      }),
      /contains a full report, but standard verification was requested.*--full/,
      "standard verification must not accept a full evidence directory",
    );
    await assert.rejects(
      verifyReleaseEvidence(standardModeRoot, {
        currentRevision: "current-revision",
        expectedMode: "full",
        expectedLabels: validLabels,
      }),
      /contains a standard report, but full verification was requested/,
      "full verification must not accept a standard evidence directory",
    );
    assert.throws(
      () =>
        validateFullBrowserReport(
          validBrowserReport.replace("current-revision", "stale-revision"),
          { currentRevision: "current-revision" },
        ),
      /stale/,
      "browser evidence must be bound to the current revision",
    );

    const staleReportRoot = await fixture(
      RELEASE_EVIDENCE_ALLOWLIST,
      formatReleaseReport(
        validLabels.map((label) => ({
          label,
          status: "PASS" as const,
          elapsedMs: 100,
        })),
        "full",
        new Set(),
        {
          revision: "stale-revision",
          environment: "disposable release test",
          decision: "NO-GO",
        },
      ),
    );
    try {
      await assert.rejects(
        verifyReleaseEvidence(staleReportRoot, {
          currentRevision: "current-revision",
          expectedLabels: validLabels,
        }),
        /Release report revision is missing or stale/,
        "a stale release report must remain invalid even when mode is auto-detected",
      );
    } finally {
      await rm(staleReportRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(fullRoot, { recursive: true, force: true });
    await rm(standardModeRoot, { recursive: true, force: true });
  }

  const symlinkRoot = await fixture();
  try {
    await mkdir(join(symlinkRoot, "clean-start"), { recursive: true });
    await symlink(
      join(symlinkRoot, "release-check-report.md"),
      join(symlinkRoot, "clean-start", "startup-api.log"),
    );
    await assert.rejects(
      verifyReleaseEvidence(symlinkRoot),
      /- clean-start\/startup-api\.log/,
      "a symlink should be listed as an invalid evidence entry",
    );
  } finally {
    await rm(symlinkRoot, { recursive: true, force: true });
  }

  console.log(
    "Release evidence tests passed (allowlist, missing report, forbidden file, symlink).",
  );
}

await run();