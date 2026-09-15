import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  declarationManifest,
  editorServiceEvidenceFromResult,
  normalizeDiagnostics,
  selectTypescript7HistoricalReports,
  typescript7ResourceRegressions,
} from "./compare-typescript-7.mts";
import { validateTypescript7ComparisonEvidence } from "./release-check.mts";
import {
  diagnosticsEqualForPairs,
  releaseRevisionGitArgs,
} from "./typescript-7-evidence.mts";

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
    schemaVersion: 2,
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
      approvedForPromotion: false,
    },
    trend: {
      historyLimit: 5,
      distinctRevisionCount: 1,
      regressedRevisions: [],
      revisionSamples: [{ sourceRevision: "a".repeat(40), performanceComparison: [] }],
    },
    promotionAssessment: {
      eligible: false,
      thresholdApprovalRequired: true,
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
      schemaVersion: 2,
      sourceRevision: breachedRevision,
      performanceComparison: measurements(2),
      promotionAssessment: { resourceBudgetsMet: false },
    },
    {
      schemaVersion: 2,
      sourceRevision: cleanRevision,
      performanceComparison: measurements(),
      promotionAssessment: {
        resourceBudgetsMet: false,
        resourceRegressions: ["inherited-from-history"],
      },
    },
    {
      schemaVersion: 2,
      sourceRevision: cleanRevision,
      performanceComparison: measurements(),
    },
  ];
  const selected = selectTypescript7HistoricalReports(
    history,
    "a".repeat(40),
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