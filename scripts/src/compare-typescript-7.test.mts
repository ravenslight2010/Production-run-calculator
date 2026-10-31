import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  analyzeTypescript7HistoricalReports,
  declarationManifest,
  editorServiceEvidenceFromResult,
  EDITOR_TYPESCRIPT_CHECK_TIMEOUT_MS,
  normalizeDiagnostics,
  selectTypescript7HistoricalReports,
  typescript7ProjectMeasurementCommands,
  typescript7RetainedSummaryCheckArgs,
  typescript7TrendHistorySummary,
  typescript7RunnerFingerprint,
  typescript7ResourceRegressions,
  typescript7PromotionGatesMet,
  validateTypescript7ResourceApprovalEvidence,
  TYPESCRIPT_7_DECLARATION_EXTENSIONS,
  TYPESCRIPT_7_SUPPORTED_RUNNERS,
} from "./compare-typescript-7.mts";
import {
  approvedTypescript7Runner,
  typescript7NativePackagesFromLockfile,
} from "./typescript-7-native-contract.mts";
import {
  createRetainedDeclarationContractReport,
  verifyRetainedDeclarationContractReport,
} from "./typescript-declaration-contract-evidence.mts";
import {
  TYPESCRIPT_7_CONTRACT_MANIFEST_FILE,
  TYPESCRIPT_7_CONTRACT_REPORT_FILE,
  verifyTypescript7ContractArtifact,
  writeTypescript7ContractArtifact,
} from "./typescript-7-contract-artifact.mts";
import { validateTypescript7ComparisonEvidence } from "./release-check.mts";
import {
  diagnosticsEqualForPairs,
  releaseRevisionGitArgs,
} from "./typescript-7-evidence.mts";
import {
  TYPESCRIPT_7_MEASURED_PROJECTS,
  TYPESCRIPT_7_RESOURCE_BUDGETS,
  typescript7ExpectedMeasurementCommandNames,
  typescript7MeasuredCheckNames,
  typescript7ResourceBudgetsEqual,
} from "./typescript-7-resource-contract.mts";
import { generateTypescript7ResourceApprovalEvidence } from "./generate-typescript-7-resource-approval.mts";
import { TYPESCRIPT_7_HISTORY_LIMIT } from "./typescript-7-trend-contract.mts";

test("normalizes diagnostic paths and ordering", () => {
  assert.deepEqual(
    normalizeDiagnostics(
      "/tmp/copy/z.ts(2,3): error TS2: second\n/tmp/copy/a.ts(1,1): error TS1: first\nnoise",
      "/tmp/copy",
    ),
    [
      "a.ts(1,1): error TS1: first",
      "z.ts(2,3): error TS2: second",
    ],
  );
});

test("lockfile native inventory is complete and unsupported runners fail closed", async () => {
  const lockfile = await readFile(
    resolve(import.meta.dirname, "../../pnpm-lock.yaml"),
    "utf8",
  );
  const packages = typescript7NativePackagesFromLockfile(lockfile, "7.0.2");
  assert.deepEqual(
    typescript7NativePackagesFromLockfile(
      `---\nlockfileVersion: '9.0'\npackages:\n  'ignored@1.0.0': {}\nsnapshots:\n  'ignored@1.0.0': {}\n---\n${lockfile}`,
      "7.0.2",
    ),
    packages,
  );
  assert.equal(packages.length, 20);
  assert.ok(packages.includes("@typescript/typescript-linux-x64"));
  assert.deepEqual(approvedTypescript7Runner("linux", "x64"), {
    ...TYPESCRIPT_7_SUPPORTED_RUNNERS[0],
  });
  assert.throws(
    () => approvedTypescript7Runner("linux", "arm64"),
    /refusing to use a fallback binary/,
  );
});

test("promotion evidence records the editor SDK and smoke outcome", () => {
  assert.deepEqual(
    editorServiceEvidenceFromResult({
      status: 0,
      stdout:
        "Editor TypeScript service smoke passed: 1 live workspace service process(es), SDK 6.0.3, diagnostics TS2322, definition navigation.\n",
    }),
    {
      command: "pnpm run check:editor-typescript",
      sdkPath: "node_modules/typescript/lib",
      sdkVersion: "6.0.3",
      outcome: "PASS",
      exitCode: 0,
      failureReason: null,
    },
  );
  assert.equal(
    editorServiceEvidenceFromResult({
      status: 1,
      stderr: "Expected diagnostic TS2322",
    }).outcome,
    "FAIL",
  );
  const timedOutEditorCheck = editorServiceEvidenceFromResult({
    status: null,
    error: Object.assign(new Error("spawnSync pnpm ETIMEDOUT"), {
      code: "ETIMEDOUT",
    }),
    stderr: "spawnSync pnpm ETIMEDOUT",
  });
  assert.equal(EDITOR_TYPESCRIPT_CHECK_TIMEOUT_MS, 5 * 60 * 1_000);
  assert.deepEqual(timedOutEditorCheck, {
    command: "pnpm run check:editor-typescript",
    sdkPath: null,
    sdkVersion: null,
    outcome: "FAIL",
    exitCode: 1,
    failureReason: "TIMEOUT",
  });
  assert.equal(
    typescript7PromotionGatesMet(true, timedOutEditorCheck, { eligible: true }),
    false,
    "a timed-out editor check must block promotion even when compiler gates pass",
  );
});

test("diagnostics compare within exact pairs and ignore clean output", () => {
  const checks = ["build", "scripts"];
  assert.equal(
    diagnosticsEqualForPairs(
      [
        { name: "typescript-6-build", diagnostics: ["build"] },
        { name: "typescript-7-build", diagnostics: ["build"] },
        { name: "typescript-6-scripts", diagnostics: ["scripts"] },
        { name: "typescript-7-scripts", diagnostics: ["scripts"] },
        { name: "typescript-6-clean", diagnostics: ["ignored"] },
      ],
      checks,
    ),
    true,
  );
  assert.equal(
    diagnosticsEqualForPairs(
      [
        { name: "typescript-6-build", diagnostics: ["moved"] },
        { name: "typescript-7-build", diagnostics: [] },
        { name: "typescript-6-scripts", diagnostics: [] },
        { name: "typescript-7-scripts", diagnostics: ["moved"] },
      ],
      checks,
    ),
    false,
  );
});

test("shared resource contract drives comparison and validation thresholds", () => {
  const checks = [
    "build",
    "scripts",
    "api-server",
    "run-calculator",
    "mockup-sandbox",
    "ai-evaluation",
    "corpus-harness",
  ];
  const measurements = TYPESCRIPT_7_RESOURCE_BUDGETS.requiredModes.flatMap(
    (mode) =>
      checks.map((check) => ({
        check,
        mode,
        elapsedMs: { candidate: 15, ratio: 1.5 },
        peakRssKiB: { candidate: 10, ratio: 1 },
      })),
  );
  const revisedContract = {
    ...TYPESCRIPT_7_RESOURCE_BUDGETS,
    maxElapsedRatio: 1.5,
  };

  assert.equal(
    typescript7ResourceRegressions(measurements)?.length,
    measurements.length,
  );
  assert.deepEqual(
    typescript7ResourceRegressions(measurements, revisedContract),
    [],
  );
  assert.equal(
    typescript7ResourceBudgetsEqual(revisedContract),
    false,
  );
  assert.equal(
    typescript7ResourceBudgetsEqual(revisedContract, revisedContract),
    true,
  );
});

test("measured project revisions update producer and validator coverage together", () => {
  const revisedProjects = [
    ...TYPESCRIPT_7_MEASURED_PROJECTS,
    { name: "new-consumer", tsconfig: "lib/new-consumer/tsconfig.json" },
  ];

  assert.ok(
    typescript7MeasuredCheckNames(revisedProjects).includes("new-consumer"),
    "release validation must require the revised check",
  );
  assert.ok(
    typescript7ProjectMeasurementCommands("warm", revisedProjects).some(
      (command) => command.name === "typescript-7-new-consumer-warm",
    ),
    "producer command coverage must include the revised project",
  );
  assert.ok(
    typescript7ExpectedMeasurementCommandNames(revisedProjects).includes(
      "typescript-7-new-consumer-warm",
    ),
    "release validation must require the producer's revised command",
  );
});

test("release revision selection excludes retained evidence commits", () => {
  assert.deepEqual(releaseRevisionGitArgs.slice(-4), [
    ":(exclude)release-evidence",
    ":(exclude)release-evidence/**",
    ":(exclude)release-evidence-full",
    ":(exclude)release-evidence-full/**",
  ]);
});

test("declaration manifests retain paths and content hashes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ts7-manifest-"));
  try {
    await mkdir(resolve(root, "lib/example/dist"), { recursive: true });
    await writeFile(resolve(root, "lib/example/dist/index.d.ts"), "export {};\n");
    await writeFile(resolve(root, "lib/example/dist/module.d.mts"), "export {};\n");
    await writeFile(resolve(root, "lib/example/dist/legacy.d.cts"), "export {};\n");
    await writeFile(resolve(root, "lib/example/dist/index.d.ts.map"), "{}\n");
    await writeFile(resolve(root, "lib/example/source.d.ts"), "export {};\n");
    const manifest = await declarationManifest(root);
    assert.deepEqual(
      manifest.map((entry) => entry.path),
      [
        "lib/example/dist/index.d.ts",
        "lib/example/dist/legacy.d.cts",
        "lib/example/dist/module.d.mts",
      ],
    );
    assert.ok(
      TYPESCRIPT_7_DECLARATION_EXTENSIONS.every((extension) =>
        manifest.some((entry) => entry.path.endsWith(extension)),
      ),
    );
    for (const entry of manifest) {
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disposable reproduction shares declaration and prerequisite boundaries", async () => {
  const reproduction = await readFile(
    resolve(
      import.meta.dirname,
      "../../docs/evidence/reproduce-typescript-7-comparison.sh",
    ),
    "utf8",
  );
  for (const extension of TYPESCRIPT_7_DECLARATION_EXTENSIONS) {
    assert.ok(
      reproduction.includes(`-name '*${extension}'`),
      `reproduction must include the ${extension} declaration extension`,
    );
  }
  const recipeBuild = reproduction.indexOf(
    "lib/recipe-guide-import/tsconfig.json",
  );
  const runCalculator = reproduction.indexOf(
    'run_timed "$label-run-calculator"',
  );
  assert.ok(recipeBuild >= 0, "reproduction must build recipe-guide-import");
  assert.ok(
    recipeBuild < runCalculator,
    "recipe-guide-import must be built before run-calculator is checked",
  );
});

test("historical summary validation stays separate from the current comparison", async () => {
  const reproductionScript = resolve(
    import.meta.dirname,
    "../../docs/evidence/reproduce-typescript-7-comparison.sh",
  );
  const reproduction = await readFile(reproductionScript, "utf8");
  assert.deepEqual(
    typescript7RetainedSummaryCheckArgs(reproductionScript),
    [reproductionScript, "--check-retained-summary"],
  );
  assert.match(reproduction, /--check-current-summary SUMMARY_PATH \[CONTRACT_REPORT_PATH\]/);
  assert.match(reproduction, /capturedAt:/);
  assert.match(reproduction, /sourceIdentity:/);
  assert.match(reproduction, /bundleSha256:/);
  assert.match(reproduction, /contractComparison:/);
  assert.match(reproduction, /check_current_summary "\$OUT\/summary\.json" "\$OUT\/typescript-7-declaration-contracts-current\.json"/);
  assert.match(reproduction, /Latest successful declaration contract report retained at/);
  assert.doesNotMatch(
    reproduction,
    /check_documented_declaration_counts "\$OUT\/summary\.json"/,
  );
});

test("compact contract evidence reuses the existing TypeScript 6 and 7 builds", async () => {
  const comparisonSource = await readFile(
    resolve(import.meta.dirname, "./compare-typescript-7.mts"),
    "utf8",
  );
  const baselineBuild = comparisonSource.indexOf(
    'run("typescript-6-build-cold"',
  );
  const baselineSnapshot = comparisonSource.indexOf(
    "copyDeclarationSnapshot(\n        checkout,\n        baselineDeclarationSnapshot",
    baselineBuild,
  );
  const baselineClean = comparisonSource.indexOf(
    '"typescript-6-clean"',
    baselineBuild,
  );
  const candidateBuild = comparisonSource.indexOf(
    'run("typescript-7-build-cold"',
    baselineBuild,
  );
  const candidateSnapshot = comparisonSource.indexOf(
    "copyDeclarationSnapshot(\n        checkout,\n        candidateDeclarationSnapshot",
    candidateBuild,
  );
  assert.ok(baselineBuild >= 0 && baselineBuild < baselineSnapshot);
  assert.ok(baselineSnapshot < baselineClean);
  assert.ok(candidateBuild >= 0 && candidateBuild < candidateSnapshot);
  assert.match(comparisonSource, /compare-declaration-contracts\.mts/u);
  assert.match(comparisonSource, /comparisonReportMatchesDeclarationManifests/u);
  assert.match(comparisonSource, /TYPESCRIPT_7_DECLARATION_CONTRACT_ARTIFACT_DIR/u);

  const workflow = await readFile(
    resolve(import.meta.dirname, "../../.github/workflows/release-check.yml"),
    "utf8",
  );
  assert.equal((workflow.match(/run: node scripts\/src\/test-results\.mjs run --lane release-/gu) ?? []).length, 2);
  assert.equal((workflow.match(/uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2/gu) ?? []).length >= 2, true);
  assert.match(workflow, /typescript-7-declaration-contracts-standard-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
  assert.match(workflow, /typescript-7-declaration-contracts-full-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
});

test("retained declaration evidence is revision-bound and integrity-checked", () => {
  const revision = "a".repeat(40);
  const bundleSha256 = "b".repeat(64);
  const formattingFile = {
    path: "lib/db/dist/formatting.d.ts",
    category: "db" as const,
    baselineSha256: "c".repeat(64),
    candidateSha256: "d".repeat(64),
    classification: "formatting-only" as const,
  };
  const approvedFile = {
    path: "lib/api-zod/dist/approved.d.ts",
    category: "api-zod" as const,
    baselineSha256: "e".repeat(64),
    candidateSha256: "f".repeat(64),
    classification: "approved-semantic" as const,
    approvalReason: "Reviewed exact-hash emitter change.",
  };
  const files = [formattingFile, approvedFile];
  const categories = [
    { category: "api-client-react" as const, changed: 0, formattingOnly: 0, approvedSemantic: 0, unexplainedSemantic: 0 },
    { category: "api-zod" as const, changed: 1, formattingOnly: 0, approvedSemantic: 1, unexplainedSemantic: 0 },
    { category: "db" as const, changed: 1, formattingOnly: 1, approvedSemantic: 0, unexplainedSemantic: 0 },
    { category: "other" as const, changed: 0, formattingOnly: 0, approvedSemantic: 0, unexplainedSemantic: 0 },
  ];
  const summary = {
    capturedAt: "2026-10-15T09:00:00.000Z",
    sourceIdentity: { revision, bundleSha256 },
    declarations: {
      textuallyChangedFileCount: 2,
      contractComparison: {
        status: "pass",
        changedFiles: 2,
        formattingOnlyChanges: 1,
        approvedSemanticChanges: 1,
        unexplainedSemanticChanges: 0,
      },
    },
  };
  const comparison = {
    schemaVersion: 1,
    baselineFileCount: 10,
    candidateFileCount: 10,
    status: "pass",
    categories,
    files,
  };
  const retained = createRetainedDeclarationContractReport(summary, comparison);

  assert.equal(retained.sourceIdentity.revision, revision);
  assert.equal(retained.sourceIdentity.bundleSha256, bundleSha256);
  assert.deepEqual(retained.declarationContract.classificationTotals, {
    changedFiles: 2,
    formattingOnly: 1,
    approvedSemantic: 1,
    unexplainedSemantic: 0,
  });
  assert.equal(retained.declarationContract.files[1].approvalReason, approvedFile.approvalReason);
  assert.equal(retained.integrity.algorithm, "sha256");
  verifyRetainedDeclarationContractReport(summary, retained);

  const tampered = structuredClone(retained);
  tampered.declarationContract.files[1].approvalReason = "Changed after comparison.";
  assert.throws(
    () => verifyRetainedDeclarationContractReport(summary, tampered),
    /integrity check failed/,
  );

  assert.throws(
    () =>
      verifyRetainedDeclarationContractReport(
        {
          ...summary,
          sourceIdentity: { revision, bundleSha256: "9".repeat(64) },
        },
        retained,
      ),
    /identity does not match/,
  );
  assert.throws(
    () =>
      createRetainedDeclarationContractReport(
        {
          ...summary,
          declarations: {
            ...summary.declarations,
            contractComparison: {
              ...summary.declarations.contractComparison,
              formattingOnlyChanges: 0,
            },
          },
        },
        comparison,
      ),
    /classification totals do not match/,
  );
});

test("run-specific declaration artifacts are minimal, revision-bound, and success-only", async () => {
  const runnerTemp = await mkdtemp(resolve(tmpdir(), "ts7-contract-artifact-"));
  const directory = resolve(runnerTemp, "artifact");
  const revision = "a".repeat(40);
  const bundleSha256 = "b".repeat(64);
  const workflow = {
    runId: "12345",
    runAttempt: "2",
    repository: "example/repository",
    eventName: "pull_request",
    sha: revision,
  };
  const summary = {
    capturedAt: "2026-10-15T09:00:00.000Z",
    sourceIdentity: { revision, bundleSha256 },
    declarations: {
      textuallyChangedFileCount: 1,
      contractComparison: {
        status: "pass",
        changedFiles: 1,
        formattingOnlyChanges: 1,
        approvedSemanticChanges: 0,
        unexplainedSemanticChanges: 0,
      },
    },
  };
  const comparison = {
    schemaVersion: 1,
    baselineFileCount: 10,
    candidateFileCount: 10,
    status: "pass",
    categories: [
      { category: "api-client-react" as const, changed: 0, formattingOnly: 0, approvedSemantic: 0, unexplainedSemantic: 0 },
      { category: "api-zod" as const, changed: 0, formattingOnly: 0, approvedSemantic: 0, unexplainedSemantic: 0 },
      { category: "db" as const, changed: 1, formattingOnly: 1, approvedSemantic: 0, unexplainedSemantic: 0 },
      { category: "other" as const, changed: 0, formattingOnly: 0, approvedSemantic: 0, unexplainedSemantic: 0 },
    ],
    files: [
      {
        path: "lib/db/dist/formatting.d.ts",
        category: "db" as const,
        baselineSha256: "c".repeat(64),
        candidateSha256: "d".repeat(64),
        classification: "formatting-only" as const,
      },
    ],
  };
  const comparisonOutcome = {
    status: "ADVISORY_DRIFT" as const,
    commandsSucceeded: true,
    diagnosticsEqual: true,
    advisory: true,
    acceptanceGatesMet: false,
  };

  try {
    await assert.rejects(
      () =>
        writeTypescript7ContractArtifact({
          directory,
          runnerTemp,
          summary,
          declarationComparison: comparison,
          comparison: {
            ...comparisonOutcome,
            status: "PROMOTION_BLOCKED",
          },
          workflow,
        }),
      /failed or incomplete TypeScript comparison/,
    );
    assert.equal(
      await readdir(runnerTemp).then((entries) => entries.includes("artifact")),
      false,
    );
    await writeTypescript7ContractArtifact({
      directory,
      runnerTemp,
      summary,
      declarationComparison: comparison,
      comparison: comparisonOutcome,
      workflow,
    });
    assert.deepEqual(
      (await readdir(directory)).sort(),
      [
        TYPESCRIPT_7_CONTRACT_MANIFEST_FILE,
        TYPESCRIPT_7_CONTRACT_REPORT_FILE,
      ].sort(),
    );
    assert.equal(
      verifyTypescript7ContractArtifact({
        directory,
        runnerTemp,
        workflow,
        sourceBundleSha256: bundleSha256,
      }),
      true,
    );
    assert.throws(
      () =>
        verifyTypescript7ContractArtifact({
          directory,
          runnerTemp,
          workflow: { ...workflow, sha: "e".repeat(40) },
          sourceBundleSha256: bundleSha256,
        }),
      /identity or comparison outcome is invalid/,
    );
    await writeFile(resolve(directory, "compiler-output.log"), "not compact");
    assert.throws(
      () =>
        verifyTypescript7ContractArtifact({
          directory,
          runnerTemp,
          workflow,
          sourceBundleSha256: bundleSha256,
        }),
      /unexpected files or directories/,
    );
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("retained resource approval evidence is compact and integrity-checked", async () => {
  const path = resolve(
    import.meta.dirname,
    "../../docs/typescript-7-resource-approval-evidence.json",
  );
  const bytes = await import("node:fs/promises").then(({ readFile }) =>
    readFile(path),
  );
  assert.doesNotThrow(() =>
    validateTypescript7ResourceApprovalEvidence(bytes),
  );

  const tampered = JSON.parse(bytes.toString("utf8"));
  tampered.samples[0].coldMaxima.candidateElapsedMs += 1;
  assert.throws(
    () =>
      validateTypescript7ResourceApprovalEvidence(
        Buffer.from(JSON.stringify(tampered)),
      ),
    /integrity check failed/,
  );

  const expanded = JSON.parse(bytes.toString("utf8"));
  expanded.samples[0].commands = ["unnecessary retained command output"];
  assert.throws(
    () =>
      validateTypescript7ResourceApprovalEvidence(
        Buffer.from(JSON.stringify(expanded)),
      ),
    /invalid sample/,
  );
});

test("resource approval generator derives compact deterministic samples", () => {
  const checks = ["build", "scripts", "api-server", "run-calculator", "mockup-sandbox", "ai-evaluation", "corpus-harness"];
  const command = (name: string, elapsedMs = 10, peakRssKiB = 100) => ({
    name, exitCode: 0, elapsedMs, peakRssKiB, diagnostics: [],
  });
  const revision = "a".repeat(40);
  const report = {
    schemaVersion: 3,
    sourceRevision: revision,
    status: "ADVISORY_DRIFT",
    authoritativeCompiler: "Version 6.0.3",
    candidateCompiler: "Version 7.0.2",
    runner: {
      platform: process.platform, arch: process.arch, supported: true,
      supportedRunners: TYPESCRIPT_7_SUPPORTED_RUNNERS,
      nativePackage: "@typescript/typescript-linux-x64",
      nativePackageVersion: "7.0.2",
      nativeBinary: "node_modules/@typescript/typescript-linux-x64/lib/tsc",
      nativePackages: ["@typescript/typescript-linux-x64"],
      image: "test-image", hardwareClass: "f".repeat(64),
      logicalCpuCount: 4, memoryGiB: 16,
    },
    commands: [
      command("frozen-install"), command("typescript-6-clean"),
      ...["cold", "warm"].flatMap((mode) => checks.flatMap((check, index) => [
        command(`typescript-6-${check}-${mode}`, 10, 100),
        {
          ...command(`typescript-7-${check}-${mode}`, 10 + index, 100 + index),
          exitCode: mode === "warm" && check === "corpus-harness" ? 1 : 0,
        },
      ])),
    ],
    performanceComparison: ["cold", "warm"].flatMap((mode) =>
      checks.map((check, index) => ({
        check, mode,
        elapsedMs: { baseline: 10, candidate: 10 + index, delta: index, ratio: (10 + index) / 10 },
        peakRssKiB: { baseline: 100, candidate: 100 + index, delta: index, ratio: (100 + index) / 100 },
      }))),
    resourceBudgets: {
      maxElapsedRatio: 1.25, maxPeakRssRatio: 1.25,
      maxCandidateElapsedMs: 60_000, maxCandidatePeakRssKiB: 1_048_576,
      minimumRevisions: 3, requiredModes: ["cold", "warm"],
      approvedForPromotion: true,
    },
    trend: {
      historyLimit: 5, incompatibleRunnerClassSamples: 0,
      distinctRevisionCount: 1, regressedRevisions: [revision],
      revisionSamples: [{ sourceRevision: revision, performanceComparison: [] }],
    },
    promotionAssessment: {
      eligible: false, thresholdApprovalRequired: false,
      repeatedEvidenceMet: false, resourceBudgetsMet: false,
      resourceRegressions: ["cold:run-calculator:elapsed", "cold:mockup-sandbox:elapsed", "cold:ai-evaluation:elapsed", "cold:corpus-harness:elapsed", "warm:run-calculator:elapsed", "warm:mockup-sandbox:elapsed", "warm:ai-evaluation:elapsed", "warm:corpus-harness:elapsed"],
    },
    promotionAttempt: false, editorService: null, diagnosticsEqual: true,
    declarations: {
      baseline: [{ path: "lib/example/dist/index.d.ts", sha256: "d".repeat(64) }],
      candidate: [{ path: "lib/example/dist/index.d.ts", sha256: "d".repeat(64) }],
      changedPaths: [],
    },
    acceptanceGatesMet: false, advisory: true,
    authoritativeOutputsChanged: false,
    containment: { beforeStatusSha256: "c".repeat(64), afterStatusSha256: "c".repeat(64) },
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  const inputs = ["a", "b", "c"].map((character, index) => {
    const workflowRunId = 123 + index;
    return {
      reportBytes: Buffer.from(JSON.stringify({
        ...report,
        sourceRevision: character.repeat(40),
        trend: {
          ...report.trend,
          regressedRevisions: [character.repeat(40)],
          revisionSamples: [{
            sourceRevision: character.repeat(40),
            performanceComparison: [],
          }],
        },
      })),
      provenance: {
        workflowRunId,
        workflowRunUrl: `https://github.com/example/project/actions/runs/${workflowRunId}`,
        workflowConclusion: "success" as const,
        evidenceCommit: (index + 4).toString(16).repeat(40),
      },
    };
  });
  const first = generateTypescript7ResourceApprovalEvidence("2026-09-15", inputs);
  const second = generateTypescript7ResourceApprovalEvidence("2026-09-15", [...inputs].reverse());
  assert.deepEqual(first, second);
  assert.doesNotThrow(() => validateTypescript7ResourceApprovalEvidence(first));
  const generated = JSON.parse(first.toString("utf8"));
  assert.deepEqual(generated.samples[0].measurementRows, { cold: 7, warm: 7 });
  assert.equal(generated.samples[0].coldMaxima.candidateElapsedMs, 16);
  assert.equal(generated.samples[0].coldMaxima.candidatePeakRssKiB, 106);
  assert.equal(generated.samples[0].commands, undefined);
  assert.equal(generated.samples[0].sourcePayload, undefined);
  assert.throws(
    () => generateTypescript7ResourceApprovalEvidence(
      "2026-09-15",
      inputs.slice(0, 2),
    ),
    /at least 3 reports/,
  );

  const withCommandOutput: any = structuredClone(report);
  withCommandOutput.commands[0].stdout = "must not be accepted";
  assert.throws(
    () => generateTypescript7ResourceApprovalEvidence("2026-09-15", [
      {
        ...inputs[0]!,
        reportBytes: Buffer.from(JSON.stringify(withCommandOutput)),
      },
      ...inputs.slice(1),
    ]),
    /unexpected or missing fields/,
  );
  assert.throws(
    () => generateTypescript7ResourceApprovalEvidence("2026-09-15", [
      {
        ...inputs[0]!,
        reportBytes: Buffer.from(JSON.stringify({
          ...report,
          sourcePayload: { secret: true },
        })),
      },
      ...inputs.slice(1),
    ]),
    /unexpected or missing fields/,
  );
  const passingReport = structuredClone(report);
  passingReport.status = "PASS";
  passingReport.acceptanceGatesMet = true;
  passingReport.commands = passingReport.commands.map((command: any) => ({
    ...command,
    exitCode: 0,
  }));
  assert.throws(
    () => generateTypescript7ResourceApprovalEvidence(
      "2026-09-15",
      inputs.map((input, index) => ({
        ...input,
        reportBytes: Buffer.from(JSON.stringify({
          ...passingReport,
          sourceRevision: (index + 10).toString(16).repeat(40),
          trend: {
            ...passingReport.trend,
            regressedRevisions: [(index + 10).toString(16).repeat(40)],
            revisionSamples: [{
              sourceRevision: (index + 10).toString(16).repeat(40),
              performanceComparison: [],
            }],
          },
        })),
      })),
    ),
    /must have ADVISORY_DRIFT status/,
  );
});

test("runner fingerprints retain only bounded non-sensitive labels", () => {
  const fingerprint = typescript7RunnerFingerprint({
    environment: {
      TYPESCRIPT_7_RUNNER_IMAGE: `ubuntu label/${"x".repeat(100)}`,
    },
    localRuntime: null,
  });
  assert.match(fingerprint.image, /^[A-Za-z0-9._@+-]{1,80}$/);
  assert.match(fingerprint.hardwareClass, /^[a-f0-9]{64}$/);
  assert.ok(fingerprint.logicalCpuCount > 0);
  assert.ok(fingerprint.memoryGiB > 0);
});

test("Replit image identity is retained as a digest, not a registry path", () => {
  const fingerprint = typescript7RunnerFingerprint({
    environment: { REPL_IMAGE: "internal-registry/private-runner:stable" },
    localRuntime: null,
  });
  assert.match(fingerprint.image, /^repl-image-[a-f0-9]{64}$/);
  assert.doesNotMatch(fingerprint.image, /internal-registry|private-runner/u);
});

test("local runner identity changes when its OS/runtime fingerprint changes", () => {
  const environment = {};
  const localRuntime = {
    platform: "linux",
    arch: "x64",
    osRelease: 'ID=ubuntu\nVERSION_ID="24.04"\n',
    kernelRelease: "6.18.55",
    nodeVersion: "v24.13.0",
  };
  const first = typescript7RunnerFingerprint({ environment, localRuntime });
  const repeated = typescript7RunnerFingerprint({ environment, localRuntime });
  const changed = typescript7RunnerFingerprint({
    environment,
    localRuntime: { ...localRuntime, kernelRelease: "6.18.56" },
  });
  assert.match(first.image, /^runtime-[a-f0-9]{64}$/);
  assert.equal(repeated.image, first.image);
  assert.notEqual(changed.image, first.image);
});

test("runner fingerprint refuses to capture evidence without an image identity", () => {
  assert.throws(
    () =>
      typescript7RunnerFingerprint({
        environment: {},
        localRuntime: null,
      }),
    /runner image identity is unavailable/,
  );
});

test("retained comparison evidence is revision-bound and advisory", () => {
  const checks = [
    "build",
    "scripts",
    "api-server",
    "run-calculator",
    "mockup-sandbox",
    "ai-evaluation",
    "corpus-harness",
  ];
  const command = (name: string) => ({
    name,
    exitCode: 0,
    elapsedMs: 1,
    peakRssKiB: 10,
    diagnostics: [],
  });
  const evidence = {
    schemaVersion: 3,
    sourceRevision: "a".repeat(40),
    status: "PASS",
    authoritativeCompiler: "Version 6.0.3",
    candidateCompiler: "Version 7.0.2",
    authoritativeOutputsChanged: false,
    runner: {
      platform: process.platform,
      arch: process.arch,
      supported: true,
      supportedRunners: TYPESCRIPT_7_SUPPORTED_RUNNERS,
      nativePackage: "@typescript/typescript-linux-x64",
      nativePackageVersion: "7.0.2",
      nativeBinary: "node_modules/@typescript/typescript-linux-x64/lib/tsc",
      nativePackages: ["@typescript/typescript-linux-x64"],
      image: "test-image",
      hardwareClass: "f".repeat(64),
      logicalCpuCount: 4,
      memoryGiB: 16,
    },
    commands: [
      command("frozen-install"),
      command("typescript-6-clean"),
      ...["cold", "warm"].flatMap((mode) =>
        checks.flatMap((check) => [
          command(`typescript-6-${check}-${mode}`),
          command(`typescript-7-${check}-${mode}`),
        ]),
      ),
    ],
    performanceComparison: ["cold", "warm"].flatMap((mode) =>
      checks.map((check) => ({
        check,
        mode,
        elapsedMs: { baseline: 1, candidate: 1, delta: 0, ratio: 1 },
        peakRssKiB: { baseline: 10, candidate: 10, delta: 0, ratio: 1 },
      })),
    ),
    resourceBudgets: {
      maxElapsedRatio: 1.25,
      maxPeakRssRatio: 1.25,
      maxCandidateElapsedMs: 60_000,
      maxCandidatePeakRssKiB: 1_048_576,
      minimumRevisions: 3,
      requiredModes: ["cold", "warm"],
      approvedForPromotion: true,
    },
    trend: {
      historyLimit: TYPESCRIPT_7_HISTORY_LIMIT,
      incompatibleRunnerClassSamples: 0,
      distinctRevisionCount: 1,
      regressedRevisions: [],
      revisionSamples: [{ sourceRevision: "a".repeat(40), performanceComparison: [] }],
    },
    promotionAssessment: {
      eligible: false,
      thresholdApprovalRequired: false,
      repeatedEvidenceMet: false,
      resourceBudgetsMet: true,
      resourceRegressions: [],
    },
    diagnosticsEqual: true,
    declarations: {
      baseline: [{ path: "lib/example/dist/index.d.ts", sha256: "d".repeat(64) }],
      candidate: [{ path: "lib/example/dist/index.d.ts", sha256: "d".repeat(64) }],
      changedPaths: [],
    },
    containment: {
      beforeStatusSha256: "c".repeat(64),
      afterStatusSha256: "c".repeat(64),
    },
    acceptanceGatesMet: true,
    advisory: true,
  };
  assert.doesNotThrow(() =>
    validateTypescript7ComparisonEvidence(
      Buffer.from(JSON.stringify(evidence)),
      "a".repeat(40),
    ),
  );
  const revisedHistoryLimit = 2;
  const revisedHistoryEvidence = {
    ...evidence,
    trend: {
      ...evidence.trend,
      historyLimit: revisedHistoryLimit,
      incompatibleRunnerClassSamples: revisedHistoryLimit,
    },
  };
  assert.doesNotThrow(() =>
    validateTypescript7ComparisonEvidence(
      Buffer.from(JSON.stringify(revisedHistoryEvidence)),
      "a".repeat(40),
      revisedHistoryLimit,
    ),
  );
  assert.throws(
    () =>
      validateTypescript7ComparisonEvidence(
        Buffer.from(JSON.stringify(revisedHistoryEvidence)),
        "a".repeat(40),
      ),
    /resource-budget evidence is stale or malformed/,
  );
  assert.throws(
    () =>
      validateTypescript7ComparisonEvidence(
        Buffer.from(
          JSON.stringify({
            ...evidence,
            trend: {
              ...evidence.trend,
              incompatibleRunnerClassSamples: 6,
            },
          }),
        ),
        "a".repeat(40),
      ),
    /resource-budget evidence is stale or malformed/,
  );
  const eligibleEvidence = {
    ...evidence,
    trend: {
      ...evidence.trend,
      distinctRevisionCount: 3,
      revisionSamples: [
        { sourceRevision: "b".repeat(40), performanceComparison: [] },
        { sourceRevision: "c".repeat(40), performanceComparison: [] },
        { sourceRevision: "a".repeat(40), performanceComparison: [] },
      ],
    },
    promotionAssessment: {
      ...evidence.promotionAssessment,
      eligible: true,
      repeatedEvidenceMet: true,
    },
  };
  assert.doesNotThrow(() =>
    validateTypescript7ComparisonEvidence(
      Buffer.from(
        JSON.stringify({
          ...evidence,
          promotionAttempt: true,
          advisory: false,
          editorService: {
            command: "pnpm run check:editor-typescript",
            sdkPath: "node_modules/typescript/lib",
            sdkVersion: "6.0.3",
            outcome: "PASS",
            exitCode: 0,
          },
        }),
      ),
      "a".repeat(40),
    ),
  );
  assert.throws(
    () =>
      validateTypescript7ComparisonEvidence(
        Buffer.from(
          JSON.stringify({
            ...evidence,
            promotionAttempt: true,
            advisory: false,
            editorService: {
              command: "pnpm run check:editor-typescript",
              sdkPath: "node_modules/typescript/lib",
              sdkVersion: "6.0.3",
              outcome: "FAIL",
              exitCode: 1,
            },
          }),
        ),
        "a".repeat(40),
      ),
    /stale, incomplete/,
  );
  assert.doesNotThrow(() =>
    validateTypescript7ComparisonEvidence(
      Buffer.from(JSON.stringify(eligibleEvidence)),
      "a".repeat(40),
    ),
  );
  assert.throws(
    () =>
      validateTypescript7ComparisonEvidence(
        Buffer.from(
          JSON.stringify({
            ...eligibleEvidence,
            trend: {
              ...eligibleEvidence.trend,
              regressedRevisions: ["b".repeat(40)],
            },
          }),
        ),
        "a".repeat(40),
      ),
    /resource assessment/,
    "a retained regression must block promotion after threshold approval",
  );
  assert.throws(
    () =>
      validateTypescript7ComparisonEvidence(
        Buffer.from(JSON.stringify(evidence)),
        "b".repeat(40),
      ),
    /stale, incomplete/,
  );
  assert.doesNotThrow(() =>
    validateTypescript7ComparisonEvidence(
      Buffer.from(
        JSON.stringify({
          ...evidence,
          status: "ADVISORY_DRIFT",
          diagnosticsEqual: false,
          acceptanceGatesMet: false,
          commands: evidence.commands.map((command) =>
            command.name === "typescript-7-build-cold"
              ? { ...command, diagnostics: ["a.ts(1,1): error TS1: drift"] }
              : command,
          ),
        }),
      ),
      "a".repeat(40),
    ),
    "diagnostic drift must remain advisory",
  );
  assert.throws(
    () =>
      validateTypescript7ComparisonEvidence(
        Buffer.from(
          JSON.stringify({
            ...evidence,
            commands: evidence.commands.map((command) =>
              command.name === "typescript-7-build-cold"
                ? { ...command, diagnostics: ["a.ts(1,1): error TS1: drift"] }
                : command,
            ),
          }),
        ),
        "a".repeat(40),
      ),
    /diagnostic comparison/,
    "a false diagnostic-equality summary must fail closed",
  );
  const regressedComparison = evidence.performanceComparison.map(
    (comparison, index) =>
      index === 0
        ? {
            ...comparison,
            elapsedMs: {
              baseline: 1,
              candidate: 2,
              delta: 1,
              ratio: 2,
            },
          }
        : comparison,
  );
  assert.doesNotThrow(
    () =>
      validateTypescript7ComparisonEvidence(
        Buffer.from(
          JSON.stringify({
            ...evidence,
            performanceComparison: regressedComparison,
            commands: evidence.commands.map((command) =>
              command.name === "typescript-7-build-cold"
                ? { ...command, elapsedMs: 2 }
                : command,
            ),
            promotionAssessment: {
              ...evidence.promotionAssessment,
              resourceBudgetsMet: false,
              resourceRegressions: ["cold:build:elapsed"],
            },
            trend: {
              ...evidence.trend,
              regressedRevisions: ["a".repeat(40)],
            },
          }),
        ),
        "a".repeat(40),
      ),
    "resource regressions must be retained without making advisory evidence invalid",
  );
  const declarationPath = "lib/example/dist/index.d.ts";
  assert.doesNotThrow(() =>
    validateTypescript7ComparisonEvidence(
      Buffer.from(
        JSON.stringify({
          ...evidence,
          status: "ADVISORY_DRIFT",
          acceptanceGatesMet: false,
          commands: evidence.commands.map((command) =>
            command.name === "typescript-7-build-cold"
              ? { ...command, exitCode: 1 }
              : command,
          ),
          declarations: {
            baseline: evidence.declarations.baseline,
            candidate: [],
            changedPaths: [declarationPath],
          },
        }),
      ),
      "a".repeat(40),
    ),
    "a failed candidate build with no declarations must remain advisory",
  );
});

test("history deduplicates revisions and evaluates each sample independently", () => {
  const checks = [
    "build",
    "scripts",
    "api-server",
    "run-calculator",
    "mockup-sandbox",
    "ai-evaluation",
    "corpus-harness",
  ];
  const measurements = (elapsedRatio = 1) =>
    ["cold", "warm"].flatMap((mode) =>
      checks.map((check) => ({
        check,
        mode,
        elapsedMs: {
          baseline: 10,
          candidate: 10 * elapsedRatio,
          delta: 10 * elapsedRatio - 10,
          ratio: elapsedRatio,
        },
        peakRssKiB: {
          baseline: 10,
          candidate: 10,
          delta: 0,
          ratio: 1,
        },
      })),
    );
  const breachedRevision = "b".repeat(40);
  const cleanRevision = "c".repeat(40);
  const history = [
    {
      schemaVersion: 3,
      sourceRevision: breachedRevision,
      runner: { hardwareClass: "f".repeat(64) },
      performanceComparison: measurements(2),
      promotionAssessment: { resourceBudgetsMet: false },
    },
    {
      schemaVersion: 3,
      sourceRevision: cleanRevision,
      runner: { hardwareClass: "f".repeat(64) },
      performanceComparison: measurements(),
      promotionAssessment: {
        resourceBudgetsMet: false,
        resourceRegressions: ["inherited-from-history"],
      },
    },
    {
      schemaVersion: 3,
      sourceRevision: cleanRevision,
      runner: { hardwareClass: "f".repeat(64) },
      performanceComparison: measurements(),
    },
  ];
  const selected = selectTypescript7HistoricalReports(
    history,
    "a".repeat(40),
    "f".repeat(64),
  );
  assert.deepEqual(
    selected.map((report) => report.sourceRevision),
    [breachedRevision, cleanRevision],
  );
  assert.deepEqual(
    typescript7ResourceRegressions(selected[0]?.performanceComparison),
    ["cold:build:elapsed", "cold:scripts:elapsed", "cold:api-server:elapsed",
      "cold:run-calculator:elapsed", "cold:mockup-sandbox:elapsed",
      "cold:ai-evaluation:elapsed", "cold:corpus-harness:elapsed",
      "warm:build:elapsed", "warm:scripts:elapsed", "warm:api-server:elapsed",
      "warm:run-calculator:elapsed", "warm:mockup-sandbox:elapsed",
      "warm:ai-evaluation:elapsed", "warm:corpus-harness:elapsed"],
  );
  assert.deepEqual(
    typescript7ResourceRegressions(selected[1]?.performanceComparison),
    [],
    "a clean revision must not inherit an older aggregate regression",
  );
});

test("history rejects a different runner class without weakening advisory evidence", () => {
  const measurements = ["cold", "warm"].flatMap((mode) =>
    ["build", "scripts", "api-server", "run-calculator", "mockup-sandbox", "ai-evaluation", "corpus-harness"].map((check) => ({
      check,
      mode,
      elapsedMs: { baseline: 10, candidate: 10, delta: 0, ratio: 1 },
      peakRssKiB: { baseline: 10, candidate: 10, delta: 0, ratio: 1 },
    })),
  );
  const history = [
    {
      schemaVersion: 3,
      sourceRevision: "b".repeat(40),
      runner: { hardwareClass: "e".repeat(64) },
      performanceComparison: measurements,
    },
  ];
  const selected = selectTypescript7HistoricalReports(
    history,
    "a".repeat(40),
    "f".repeat(64),
  );
  assert.deepEqual(selected, []);
  assert.deepEqual(
    analyzeTypescript7HistoricalReports(
      history,
      "a".repeat(40),
      "f".repeat(64),
    ),
    { reports: [], incompatibleRunnerClassSamples: 1 },
  );
});

test("history bounds incompatible runner-class counts without retaining hardware details", () => {
  const measurements = ["cold", "warm"].flatMap((mode) =>
    ["build", "scripts", "api-server", "run-calculator", "mockup-sandbox", "ai-evaluation", "corpus-harness"].map((check) => ({
      check,
      mode,
      elapsedMs: { baseline: 10, candidate: 10, delta: 0, ratio: 1 },
      peakRssKiB: { baseline: 10, candidate: 10, delta: 0, ratio: 1 },
    })),
  );
  const history = Array.from({ length: 8 }, (_, index) => ({
    schemaVersion: 3,
    sourceRevision: (index + 1).toString(16).repeat(40),
    runner: {
      hardwareClass: "e".repeat(64),
      cpuModel: `sensitive-model-${index}`,
    },
    performanceComparison: measurements,
  }));
  assert.deepEqual(
    analyzeTypescript7HistoricalReports(
      history,
      "a".repeat(40),
      "f".repeat(64),
    ),
    { reports: [], incompatibleRunnerClassSamples: 5 },
  );
});

test("revised history limit bounds producer selection", () => {
  const revisedHistoryLimit = 2;
  const measurements = ["cold", "warm"].flatMap((mode) =>
    ["build", "scripts", "api-server", "run-calculator", "mockup-sandbox", "ai-evaluation", "corpus-harness"].map((check) => ({
      check,
      mode,
      elapsedMs: { baseline: 10, candidate: 10, delta: 0, ratio: 1 },
      peakRssKiB: { baseline: 10, candidate: 10, delta: 0, ratio: 1 },
    })),
  );
  const history = Array.from({ length: 4 }, (_, index) => ({
    schemaVersion: 3,
    sourceRevision: (index + 1).toString(16).repeat(40),
    runner: { hardwareClass: "f".repeat(64) },
    performanceComparison: measurements,
  }));

  assert.equal(
    selectTypescript7HistoricalReports(
      history,
      "a".repeat(40),
      "f".repeat(64),
      revisedHistoryLimit,
    ).length,
    revisedHistoryLimit,
  );
});

test("history limit contract rejects invalid producer and release settings", () => {
  for (const invalidHistoryLimit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        selectTypescript7HistoricalReports(
          [],
          "a".repeat(40),
          "f".repeat(64),
          invalidHistoryLimit,
        ),
      /TypeScript 7 history limit must be a positive safe integer/,
    );
    assert.throws(
      () =>
        validateTypescript7ComparisonEvidence(
          Buffer.from("{}"),
          "a".repeat(40),
          invalidHistoryLimit,
        ),
      /TypeScript 7 history limit must be a positive safe integer/,
    );
  }
});

test("trend output distinguishes runner-class resets from missing history", () => {
  assert.match(
    typescript7TrendHistorySummary(1, 2),
    /history reset for this runner class: 2 incompatible prior sample\(s\) excluded/,
  );
  assert.equal(
    typescript7TrendHistorySummary(1, 0),
    "TypeScript 7 trend history is missing: no valid prior samples were available.",
  );
  assert.match(
    typescript7TrendHistorySummary(3, 1),
    /includes 2 compatible prior revision\(s\); 1 incompatible runner-class sample\(s\) excluded/,
  );
});
