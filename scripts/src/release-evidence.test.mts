import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RELEASE_EVIDENCE_ALLOWLIST,
  RELEASE_CHECKPOINT_REPORT,
  RELEASE_CHECK_API_CONCURRENCY,
  RELEASE_CHECK_DEFAULT_CONCURRENCY,
  SOURCE_LIBRARY_RECONCILIATION_EVIDENCE,
  SOURCE_LIBRARY_RECONCILIATION_FIXTURE_STEP,
  SOURCE_LIBRARY_RECONCILIATION_STEP,
  assertUniqueReleaseSteps,
  PRODUCTION_AUDIT_TIMEOUT_MS,
  PRODUCTION_AUDIT_WARNING_MS,
  PRODUCTION_DEPENDENCY_AUDIT_STEP,
  defaultReleaseEvidenceDir,
  formatReleaseReport,
  parseBrowserDurationRegressions,
  releaseConcurrencyLimit,
  releaseGateLabelsForMode,
  runStep,
  resolveReleaseEvidenceDir,
  sourceLibraryReconciliationRequired,
  validateFullBrowserReport,
  validateReportKeyRotationEvidence,
  validateReleaseReport,
  validateWebKitBrowserEvidence,
  validateSourceLibraryReconciliationEvidence,
  verifyReleaseEvidence,
} from "./release-check.mts";
import { parseReportSigningKeyring } from "./report-key-rotation-preflight.mts";
import {
  computeSourceLibraryEvidenceId,
  DEFAULT_FROM_DATE,
  DEFAULT_HEAL_ID,
  DEFAULT_REPORT,
} from "./verify-source-library-reconciliation.mts";

const sourceReportSha256 = createHash("sha256")
  .update(await readFile(new URL(`../../${DEFAULT_REPORT}`, import.meta.url)))
  .digest("hex");

function sourceEvidence(overrides: Record<string, unknown> = {}) {
  const evidence = {
    verifier: "source-library-reconciliation",
    environment: "development",
    revision: "current-revision",
    capturedAt: "2026-09-08T12:00:00.000Z",
    healId: DEFAULT_HEAL_ID,
    repairBoundary: { fromDate: DEFAULT_FROM_DATE },
    report: {
      sha256: sourceReportSha256,
      formatVersion: 1,
      automaticProposals: 68,
      stubs: 3,
    },
    marker: {},
    pools: {},
    aliases: {},
    profiles: {},
    pendingRuns: {},
    protectedHistory: { references: 0 },
    stubs: {},
    idempotencyFingerprint: {
      algorithm: "sha256",
      value: "b".repeat(64),
    },
    ok: true,
    failures: [],
    ...overrides,
  };
  return {
    ...evidence,
    evidenceId: computeSourceLibraryEvidenceId(evidence),
  };
}

assert.equal(
  PRODUCTION_DEPENDENCY_AUDIT_STEP.timeoutMs,
  PRODUCTION_AUDIT_TIMEOUT_MS,
  "the production dependency audit must have a hard timeout",
);
assert.equal(
  PRODUCTION_DEPENDENCY_AUDIT_STEP.warningMs,
  PRODUCTION_AUDIT_WARNING_MS,
  "the production dependency audit must warn before its hard timeout",
);
assert.ok(
  PRODUCTION_AUDIT_WARNING_MS < PRODUCTION_AUDIT_TIMEOUT_MS,
  "the production dependency audit warning must precede its timeout",
);

async function fixture(
  files: readonly string[] = ["release-check-report.md"],
  report = "fixture evidence\n",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-evidence-"));
  for (const file of files) {
    if (file === RELEASE_CHECKPOINT_REPORT) continue;
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      file === "release-check-report.md"
        ? report
        : file === "browser-smoke/webkit-result.json"
          ? `${JSON.stringify({
              schemaVersion: 1,
              browser: "webkit",
              revision: "current-revision",
              environment: "disposable release test",
              result: "passed",
              cases: [{
                file: "release-webkit-smoke.spec.ts",
                title: "fixture smoke",
                status: "passed",
                durationMs: 100,
              }],
            })}\n`
        : file === "report-key-rotation-preflight.json"
          ? `${JSON.stringify({
              verifier: "report-key-rotation-preflight",
              environment: "disposable release test",
              revision: "current-revision",
              status: "pass",
              canRotate: true,
              activeKeyId: "current",
              storedKeyIds: ["current", "previous"],
              missingKeyIds: [],
              scan: {
                limit: 100,
                checkedDistinctKeyIds: 2,
                truncated: false,
                complete: true,
              },
              failure: null,
              remediation: null,
            })}\n`
        : file === SOURCE_LIBRARY_RECONCILIATION_EVIDENCE
          ? `${JSON.stringify(sourceEvidence())}\n`
          : "fixture evidence\n",
    );
  }
  return root;
}

async function run(): Promise<void> {
  const rootPackage = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };
  const ciWorkflow = await readFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const releaseWorkflow = await readFile(
    new URL("../../.github/workflows/release-check.yml", import.meta.url),
    "utf8",
  );
  const configuredKeyrings = [...releaseWorkflow.matchAll(
    /OPERATIONAL_REPORT_SIGNING_KEYS:\s*'([^']+)'/g,
  )].map((match) => parseReportSigningKeyring(match[1]));
  assert.equal(
    configuredKeyrings.length,
    2,
    "standard and full disposable release jobs must both configure a report keyring",
  );
  assert.deepEqual(
    configuredKeyrings,
    [
      { activeKeyId: "release-check-current", keyIds: ["release-check-current"] },
      { activeKeyId: "release-check-current", keyIds: ["release-check-current"] },
    ],
    "disposable release keyrings must satisfy the same retained-key contract as production",
  );
  assert.equal(
    rootPackage.scripts?.["audit:prod:ci"],
    "pnpm audit --prod --audit-level high --ignore-registry-errors",
    "informational CI security must report high-severity advisories and tolerate registry failures",
  );
  assert.deepEqual(
    SOURCE_LIBRARY_RECONCILIATION_FIXTURE_STEP.args,
    ["--filter", "@workspace/scripts", "run", "test:source-heal-verify"],
    "disposable CI must run focused reconciliation fixtures instead of querying an empty database for production history",
  );
  assert.equal(
    rootPackage.scripts?.["audit:prod:release"],
    "pnpm audit --prod --audit-level high",
    "blocking release security must fail on high-severity advisories and registry failures",
  );
  assert.equal(
    rootPackage.scripts?.["audit:prod"],
    "pnpm run audit:prod:release",
    "the configured production security workflow must retain its fail-closed compatibility command",
  );
  assert.match(
    ciWorkflow,
    /name: Informational security audit \(high severity; registry best-effort\)[\s\S]*continue-on-error: true[\s\S]*run: pnpm run audit:prod:ci/,
    "CI must name and run the informational security policy",
  );
  assert.doesNotMatch(
    releaseWorkflow,
    /test:source-heal-verify|verify-source-library-reconciliation\.mts/,
    "the workflow must not invoke source reconciliation outside the release evidence runner",
  );
  assert.equal(
    releaseGateLabelsForMode("standard").filter(
      (label) => label === "source-library reconciliation verification",
    ).length,
    1,
    "the retained release evidence runner must own exactly one source reconciliation gate",
  );
  const specImportPackage = JSON.parse(
    await readFile(
      new URL("../../lib/spec-import/package.json", import.meta.url),
      "utf8",
    ),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    specImportPackage.scripts?.test,
    "vitest run",
    "spec-import must expose its Vitest suite through the package test script",
  );
  assert.deepEqual(
    PRODUCTION_DEPENDENCY_AUDIT_STEP.args,
    ["run", "audit:prod:release"],
    "the retained release runner must use the blocking release security policy",
  );
  assert.ok(
    releaseGateLabelsForMode("standard").includes("spec import tests"),
    "the bounded release gate must explicitly cover spec-import",
  );
  assert.equal(
    releaseGateLabelsForMode("standard").filter(
      (label) => label === "spec import tests",
    ).length,
    1,
    "spec-import must be declared exactly once in the release contract",
  );
  assert.throws(
    () =>
      assertUniqueReleaseSteps([
        { label: "duplicate gate", args: ["run", "first"] },
        { label: "duplicate gate", args: ["run", "second"] },
      ]),
    /Duplicate labels: duplicate gate/,
    "duplicate release gate labels must be rejected",
  );
  assert.throws(
    () =>
      assertUniqueReleaseSteps([
        { label: "first label", args: ["run", "same"] },
        { label: "second label", args: ["run", "same"] },
      ]),
    /Duplicate command invocations: pnpm run same/,
    "duplicate release command invocations must be rejected even under different labels",
  );
  assert.ok(
    releaseGateLabelsForMode("standard").includes("onboarding bypass guard"),
    "standard release checks must include the onboarding bypass guard",
  );
  assert.ok(
    releaseGateLabelsForMode("standard").includes("browser WebKit smoke"),
    "standard release checks must include the bounded WebKit browser smoke",
  );
  assert.ok(
    RELEASE_EVIDENCE_ALLOWLIST.includes("browser-smoke/webkit-result.json"),
    "WebKit smoke evidence must be retained through the release allowlist",
  );
  assert.ok(
    releaseGateLabelsForMode("standard").includes(
      "source-library reconciliation verification",
    ),
    "standard release checks must include source-library reconciliation verification",
  );
  assert.ok(
    releaseGateLabelsForMode("standard").includes(
      "operational report signing-key rotation preflight",
    ),
    "standard release checks must block unsafe report signing-key rotation",
  );
  assert.equal(
    sourceLibraryReconciliationRequired({
      CI: "true",
      NODE_ENV: "test",
      E2E_TEST_DB: "1",
      RELEASE_CHECK_SKIP_PRODUCTION_SOURCE_LIBRARY_RECONCILIATION: "1",
    }),
    false,
    "a fresh disposable CI database may test the reconciliation gate without claiming production history",
  );
  assert.throws(
    () =>
      sourceLibraryReconciliationRequired({
        RELEASE_CHECK_SKIP_PRODUCTION_SOURCE_LIBRARY_RECONCILIATION: "1",
      }),
    /restricted to a disposable CI test database/,
    "production evidence must fail closed when the CI-only reconciliation bypass is requested",
  );
  assert.match(
    formatReleaseReport(
      [],
      "standard",
      new Set(),
      {
        revision: "ci-fixture",
        decision: "NO-GO",
        environment: "disposable CI gate test (not production reconciliation evidence)",
        expectedLabels: [],
      },
    ),
    /Environment: disposable CI gate test \(not production reconciliation evidence\)[\s\S]*Decision: NO-GO/,
    "disposable CI validation must never be rendered as production-ready evidence",
  );
  assert.deepEqual(
    SOURCE_LIBRARY_RECONCILIATION_STEP.args.slice(0, 5),
    [
      "--filter",
      "@workspace/scripts",
      "exec",
      "tsx",
      "./src/verify-source-library-reconciliation.mts",
    ],
    "the release gate must invoke the read-only source-library verifier",
  );
  assert.ok(
    SOURCE_LIBRARY_RECONCILIATION_STEP.args.includes("--report") &&
      SOURCE_LIBRARY_RECONCILIATION_STEP.args.includes("--heal-id") &&
      SOURCE_LIBRARY_RECONCILIATION_STEP.args.includes("--from-date") &&
      SOURCE_LIBRARY_RECONCILIATION_STEP.args.includes("--environment") &&
      SOURCE_LIBRARY_RECONCILIATION_STEP.args.includes("--output"),
    "the source-library gate must pass its report, heal boundary, and evidence output",
  );
  assert.equal(
    SOURCE_LIBRARY_RECONCILIATION_STEP.args[
      SOURCE_LIBRARY_RECONCILIATION_STEP.args.indexOf("--environment") + 1
    ],
    "development",
    "local release evidence must identify the development database explicitly",
  );
  assert.match(
    SOURCE_LIBRARY_RECONCILIATION_STEP.args[
      SOURCE_LIBRARY_RECONCILIATION_STEP.args.indexOf("--output") + 1
    ] ?? "",
    /\.source-library-reconciliation\.json\.pending$/,
    "failed release gates must not overwrite retained source-library evidence",
  );
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
  assert.equal(RELEASE_CHECK_DEFAULT_CONCURRENCY, 4);
  assert.equal(RELEASE_CHECK_API_CONCURRENCY, 2);
  assert.equal(
    releaseConcurrencyLimit({ label: "package", args: [] }, 4),
    4,
    "non-stateful work should use the bounded scheduler limit",
  );
  assert.equal(
    releaseConcurrencyLimit(
      { label: "api", args: [], group: "api-test-shards" },
      4,
    ),
    2,
    "API work should retain its lower database-aware limit",
  );
  assert.equal(
    releaseConcurrencyLimit({ label: "browser", args: [], concurrencyLimit: 1 }, 4),
    1,
    "stateful browser work must remain serial",
  );

  const timedOut = await runStep({
    label: "timed-out fixture",
    args: ["exec", "node", "-e", "setTimeout(() => {}, 5000)"],
    timeoutMs: 50,
  });
  assert.equal(timedOut.exitCode, 124);
  assert.equal(timedOut.status, "INFRASTRUCTURE TIMEOUT");
  const descendantRoot = await mkdtemp(join(tmpdir(), "release-timeout-tree-"));
  const descendantMarker = join(descendantRoot, "leaked-descendant");
  try {
    const parentScript = [
      "const { spawn } = require('node:child_process');",
      `spawn(process.execPath, ['-e', ${JSON.stringify(
        `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(
          descendantMarker,
        )}, "leaked"), 250)`,
      )}], { stdio: 'inherit' });`,
      "setTimeout(() => {}, 5000);",
    ].join("");
    const timedTree = await runStep({
      label: "timed-out process-tree fixture",
      command: process.execPath,
      args: ["-e", parentScript],
      timeoutMs: 50,
    });
    assert.equal(timedTree.status, "INFRASTRUCTURE TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, 350));
    await assert.rejects(
      readFile(descendantMarker, "utf8"),
      "a timed-out shard must terminate descendants before releasing its scheduler slot",
    );
  } finally {
    await rm(descendantRoot, { recursive: true, force: true });
  }
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
  assert.throws(
    () =>
      validateSourceLibraryReconciliationEvidence(
        Buffer.from(JSON.stringify(sourceEvidence())),
        { expectedRevision: "different-revision" },
      ),
    /revision is stale or missing/,
    "source reconciliation evidence from another revision must not be accepted",
  );
  assert.throws(
    () =>
      validateSourceLibraryReconciliationEvidence(
        Buffer.from(JSON.stringify(sourceEvidence())),
        {
          maxAgeMs: 60_000,
          now: new Date("2026-09-08T12:02:00.000Z"),
        },
      ),
    /evidence is stale/,
    "stale source reconciliation evidence must not be imported",
  );
  assert.doesNotThrow(() =>
    validateWebKitBrowserEvidence(
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          browser: "webkit",
          revision: "current-revision",
          environment: "disposable release test",
          result: "passed",
          cases: [
            {
              file: "release-webkit-smoke.spec.ts",
              title: "auth smoke",
              status: "passed",
              durationMs: 100,
            },
          ],
        }),
      ),
      { currentRevision: "current-revision", requirePass: true },
    ),
  );
  assert.throws(
    () =>
      validateWebKitBrowserEvidence(
        Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            browser: "webkit",
            revision: "old-revision",
            environment: "disposable release test",
            result: "passed",
            cases: [],
          }),
        ),
        { currentRevision: "current-revision" },
      ),
    /revision is stale/,
    "stale WebKit evidence must not be accepted",
  );
  assert.doesNotThrow(() =>
    validateSourceLibraryReconciliationEvidence(
      Buffer.from(
        JSON.stringify({
          ...sourceEvidence(),
        }),
      ),
    ),
  );
  assert.throws(
    () =>
      validateSourceLibraryReconciliationEvidence(
        Buffer.from(
          JSON.stringify({
            ...sourceEvidence(),
          }),
        ),
        { expectedEnvironment: "release" },
      ),
    /targets development, but release evidence was requested/,
    "evidence from another environment must not be accepted",
  );
  assert.throws(
    () =>
      validateSourceLibraryReconciliationEvidence(
        Buffer.from(
          JSON.stringify(sourceEvidence({
            ok: false,
            failures: [{ check: "pendingRuns", count: 2 }],
          })),
        ),
      ),
    /pendingRuns \(2\)/,
    "a pending-reference failure must block retained release evidence and name the check",
  );
  assert.throws(
    () =>
      validateSourceLibraryReconciliationEvidence(
        Buffer.from(
          JSON.stringify(sourceEvidence({
            ok: false,
            failures: [{ check: "protectedStubs", count: 1 }],
          })),
        ),
      ),
    /protectedStubs \(1\)/,
    "a protected-stub failure must block retained release evidence and name the check",
  );
  const timedReport = formatReleaseReport(
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
      timing: {
        totalElapsedMs: 12_000,
        stages: [
          { stage: "prerequisites", elapsedMs: 2_000 },
          { stage: "release-tests", elapsedMs: 10_000 },
        ],
      },
    },
  );
  assert.match(timedReport, /^## Timing$/m);
  assert.match(timedReport, /^Total wall-clock: 12s$/m);
  assert.match(timedReport, /\| release-tests \| 10s \|/);
  const incompleteReport = formatReleaseReport(
    [
      { label: "gate one", status: "PASS", elapsedMs: 100 },
      { label: "gate two", status: "FAIL", elapsedMs: 200 },
      {
        label: "gate three",
        status: "INFRASTRUCTURE TIMEOUT",
        elapsedMs: 300,
      },
    ],
    "standard",
    new Set(),
    {
      revision: "current-revision",
      environment: "disposable release test",
      decision: "NO-GO",
      expectedLabels: ["gate one", "gate two", "gate three", "gate four"],
    },
  );
  assert.match(incompleteReport, /\| gate four \| NOT REACHED \|/);
  assert.match(
    incompleteReport,
    /Failures or accepted exceptions: gate two \(FAIL\)/,
  );
  assert.match(
    incompleteReport,
    /Interrupted gates: gate three \(INFRASTRUCTURE TIMEOUT\)/,
  );
  assert.match(
    incompleteReport,
    /Not-reached gates: gate four \(NOT REACHED\)/,
  );
  assert.doesNotMatch(
    incompleteReport,
    /Failures or accepted exceptions: none/,
    "a non-passing report must not claim that there were no failures",
  );
  assert.doesNotThrow(
    () =>
      validateReleaseReport(incompleteReport, {
        currentRevision: "current-revision",
        expectedMode: "standard",
        expectedLabels: ["gate one", "gate two", "gate three", "gate four"],
      }),
    "an incomplete report is valid evidence only when explicitly marked NO-GO",
  );
  assert.match(incompleteReport, /^Decision: NO-GO$/m);
  const checkpointReport = formatReleaseReport(
    [{ label: "gate one", status: "PASS", elapsedMs: 100 }],
    "standard",
    new Set(),
    {
      revision: "current-revision",
      environment: "disposable release test",
      decision: "NO-GO",
      expectedLabels: ["gate one", "gate two"],
      reportKind: "checkpoint",
    },
  );
  assert.match(
    checkpointReport,
    /^# Release Check Checkpoint — INCOMPLETE \/ NO-GO$/m,
  );
  assert.match(checkpointReport, /^Report status: INCOMPLETE CHECKPOINT$/m);
  assert.match(checkpointReport, /^Retained evidence: NOT UPDATED$/m);
  assert.match(
    checkpointReport,
    /This is an incomplete checkpoint, not a current retained release report\./,
  );
  assert.match(
    checkpointReport,
    /Retained report: release-check-report\.md \(left unchanged by this checkpoint\)\./,
  );
  const partialKnownContractReport = formatReleaseReport(
    [
      {
        label: "blocking release security audit (high severity; registry required)",
        status: "FAIL",
        elapsedMs: 100,
      },
    ],
    "standard",
    new Set(),
    {
      revision: "current-revision",
      environment: "disposable release test",
      decision: "NO-GO",
    },
  );
  assert.match(
    partialKnownContractReport,
    /\| spec import tests \| NOT REACHED \|/,
    "recognized release gates should receive the ordered contract automatically",
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
  assert.match(
    alertingReleaseReport,
    /Source-library reconciliation evidence: not produced/,
    "release reports must link the retained source-library evidence",
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
    assert.doesNotThrow(
      () =>
        validateReportKeyRotationEvidence(
          new TextEncoder().encode(JSON.stringify({
            verifier: "report-key-rotation-preflight",
            environment: "disposable release test",
            revision: "current-revision",
            status: "pass",
            canRotate: true,
            activeKeyId: "current",
            storedKeyIds: ["current"],
            missingKeyIds: [],
            scan: {
              limit: 100,
              checkedDistinctKeyIds: 1,
              truncated: false,
              complete: true,
            },
            failure: null,
            remediation: null,
          })),
          { currentRevision: "current-revision" },
        ),
      "a complete healthy key-rotation result should be accepted",
    );
    for (const invalidEvidence of [
      JSON.stringify({
        verifier: "report-key-rotation-preflight",
        environment: "disposable release test",
        revision: "current-revision",
        status: "blocked",
        canRotate: false,
        activeKeyId: null,
        storedKeyIds: ["removed-historical"],
        missingKeyIds: ["removed-historical"],
        scan: { limit: 100, checkedDistinctKeyIds: 1, truncated: false, complete: true },
        failure: "missing-retained-keys",
        remediation: "Restore the retained signing key for proof key ID removed-historical.",
      }),
      "{malformed",
      JSON.stringify({
        verifier: "report-key-rotation-preflight",
        environment: "disposable release test",
        revision: "current-revision",
        status: "pass",
        canRotate: true,
        activeKeyId: "current",
        storedKeyIds: ["current"],
        missingKeyIds: [],
        scan: { limit: 100, checkedDistinctKeyIds: 1, truncated: true, complete: false },
        failure: null,
        remediation: null,
      }),
      JSON.stringify({
        verifier: "report-key-rotation-preflight",
        environment: "disposable release test",
        revision: "current-revision",
        status: "pass",
        canRotate: true,
        activeKeyId: "current",
        storedKeyIds: [],
        missingKeyIds: [],
        scan: { limit: 100, checkedDistinctKeyIds: 0, truncated: false, complete: true },
        failure: null,
        remediation: null,
        signingKey: "must-not-be-retained",
      }),
    ]) {
      assert.throws(
        () =>
          validateReportKeyRotationEvidence(
            new TextEncoder().encode(invalidEvidence),
            { currentRevision: "current-revision" },
          ),
        /key rotation evidence|keyring|truncated|unsafe|valid JSON/,
        "blocked, malformed, truncated, and secret-bearing evidence must fail closed",
      );
    }

    await assert.doesNotReject(
      verifyReleaseEvidence(root, {
        currentRevision: "current-revision",
        expectedMode: "standard",
        expectedLabels: validLabels,
      }),
      "an allowlisted evidence set should pass",
    );

    await writeFile(
      join(root, RELEASE_CHECKPOINT_REPORT),
      checkpointReport,
      "utf8",
    );
    await assert.rejects(
      verifyReleaseEvidence(root, {
        currentRevision: "current-revision",
        expectedMode: "standard",
        expectedLabels: validLabels,
      }),
      /incomplete checkpoint.*not retained release evidence.*left unchanged.*--resume/,
      "an active checkpoint must not make an older retained report look current",
    );
    await rm(join(root, RELEASE_CHECKPOINT_REPORT));
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
      "Expected cases: 159",
      "Enumerated cases: 159",
      "Completed cases: 0",
      "Passed cases: 0",
      "Skipped cases: 0",
      "Failed cases: 0",
      "Not-run cases: 159",
      "Coverage: INCOMPLETE",
      "Duration: 0ms",
      "## Per-file duration",
      "",
      "| File | Cases | Completed | Passed | Skipped | Failed | Not run | Duration |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      "| `e2e/example.spec.ts` | 159 | 0 | 0 | 0 | 0 | 159 | 0ms |",
      "",
    ].join("\n");
    const invalidPassingBrowserReport = validBrowserReport
      .replace("Result: FAIL", "Result: PASS")
      .replace("Completed cases: 0", "Completed cases: 159")
      .replace("Passed cases: 0", "Passed cases: 111")
      .replace("Failed cases: 0", "Failed cases: 1")
      .replace("Not-run cases: 159", "Not-run cases: 0")
      .replace("Coverage: INCOMPLETE", "Coverage: COMPLETE")
      .replace(
        "| `e2e/example.spec.ts` | 159 | 0 | 0 | 0 | 0 | 159 | 0ms |",
        "| `e2e/example.spec.ts` | 159 | 159 | 156 | 0 | 1 | 0 | 0ms |",
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