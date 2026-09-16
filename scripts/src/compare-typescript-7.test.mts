import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  analyzeTypescript7HistoricalReports,
  declarationManifest,
  editorServiceEvidenceFromResult,
  normalizeDiagnostics,
  selectTypescript7HistoricalReports,
  typescript7ProjectMeasurementCommands,
  typescript7TrendHistorySummary,
  typescript7RunnerFingerprint,
  typescript7ResourceRegressions,
  validateTypescript7ResourceApprovalEvidence,
} from "./compare-typescript-7.mts";
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
    },
  );
  assert.equal(
    editorServiceEvidenceFromResult({
      status: 1,
      stderr: "Expected diagnostic TS2322",
    }).outcome,
    "FAIL",
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
    const manifest = await declarationManifest(root);
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0]?.path, "lib/example/dist/index.d.ts");
    assert.match(manifest[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
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
      supportedRunners: [{ platform: process.platform, arch: process.arch }],
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
  const previousImage = process.env.TYPESCRIPT_7_RUNNER_IMAGE;
  const previousImageOs = process.env.ImageOS;
  const previousImageVersion = process.env.ImageVersion;
  try {
    delete process.env.ImageOS;
    delete process.env.ImageVersion;
    process.env.TYPESCRIPT_7_RUNNER_IMAGE = `ubuntu label/${"x".repeat(100)}`;
    const fingerprint = typescript7RunnerFingerprint();
    assert.match(fingerprint.image, /^[A-Za-z0-9._@+-]{1,80}$/);
    assert.match(fingerprint.hardwareClass, /^[a-f0-9]{64}$/);
    assert.ok(fingerprint.logicalCpuCount > 0);
    assert.ok(fingerprint.memoryGiB > 0);
  } finally {
    if (previousImage === undefined) delete process.env.TYPESCRIPT_7_RUNNER_IMAGE;
    else process.env.TYPESCRIPT_7_RUNNER_IMAGE = previousImage;
    if (previousImageOs === undefined) delete process.env.ImageOS;
    else process.env.ImageOS = previousImageOs;
    if (previousImageVersion === undefined) delete process.env.ImageVersion;
    else process.env.ImageVersion = previousImageVersion;
  }
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
      supportedRunners: [{ platform: process.platform, arch: process.arch }],
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
