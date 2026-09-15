import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  declarationManifest,
  normalizeDiagnostics,
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
    schemaVersion: 1,
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
      command("typescript-6-build"),
      command("typescript-6-clean"),
      command("typescript-7-build"),
      ...checks.slice(1).flatMap((check) => [
        command(`typescript-6-${check}`),
        command(`typescript-7-${check}`),
      ]),
    ],
    performanceComparison: checks.map((check) => ({
      check,
      elapsedMs: { baseline: 1, candidate: 1, delta: 0, ratio: 1 },
      peakRssKiB: { baseline: 10, candidate: 10, delta: 0, ratio: 1 },
    })),
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
            command.name === "typescript-7-build"
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
              command.name === "typescript-7-build"
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
  const declarationPath = "lib/example/dist/index.d.ts";
  assert.doesNotThrow(() =>
    validateTypescript7ComparisonEvidence(
      Buffer.from(
        JSON.stringify({
          ...evidence,
          status: "ADVISORY_DRIFT",
          acceptanceGatesMet: false,
          commands: evidence.commands.map((command) =>
            command.name === "typescript-7-build"
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