import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type FixtureStep = {
  label: string;
  command: string;
  args: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
  stage?: string;
  concurrencyLimit?: number;
  group?: string;
};

const rootDir = resolve(new URL("../../", import.meta.url).pathname);
const releaseCheck = join(rootDir, "scripts", "src", "release-check.mts");
const stoppedSummaryScript = join(
  rootDir,
  "scripts",
  "src",
  "release-stopped-summary.sh",
);
const onboardingGuard = join(
  rootDir,
  "artifacts",
  "run-calculator",
  "e2e",
  "onboarding-guard.mjs",
);

function runReleaseCheck(
  evidenceDir: string,
  steps: FixtureStep[],
  args: string[] = [],
  envOverrides: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", releaseCheck, ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        RELEASE_EVIDENCE_DIR: evidenceDir,
        RELEASE_CHECK_FIXTURE_STEPS: JSON.stringify(steps),
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

function runStoppedSummary(
  evidenceDir: string,
  summaryPath: string,
  mode: "standard" | "full",
  artifactUrl: string,
  envOverrides: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("bash", [stoppedSummaryScript], {
      cwd: rootDir,
      env: {
        ...process.env,
        CHECKPOINT_DIR: evidenceDir,
        CHECKPOINT_ARTIFACT_URL: artifactUrl,
        GITHUB_STEP_SUMMARY: summaryPath,
        RELEASE_MODE: mode,
        RESUME_COMMAND:
          mode === "full"
            ? "pnpm run release:check:full -- --resume"
            : "pnpm run release:check -- --resume",
        REGENERATE_COMMAND:
          mode === "full"
            ? "pnpm run release:check:full"
            : "pnpm run release:check",
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

async function runStoppedArtifactLinkVerificationScenario(): Promise<void> {
  const artifactUrl =
    "https://github.com/example/factory/actions/runs/123456789/artifacts/987654321";
  const scenarios = [
    {
      name: "same-repository-pull-request",
      eventName: "pull_request",
      baseRepository: "example/factory",
      headRepository: "example/factory",
    },
    {
      name: "forked-pull-request",
      eventName: "pull_request",
      baseRepository: "example/factory",
      headRepository: "contributor/factory",
    },
  ] as const;

  for (const mode of ["standard", "full"] as const) {
    for (const scenario of scenarios) {
      const evidenceDir = await mkdtemp(
        join(
          tmpdir(),
          `release-summary-${mode}-${scenario.name}-artifact-verification-`,
        ),
      );
      const fakeBinDir = await mkdtemp(
        join(
          tmpdir(),
          `release-summary-${mode}-${scenario.name}-artifact-verification-bin-`,
        ),
      );
      const callsPath = join(fakeBinDir, "curl-calls");
      const fakeCurlPath = join(fakeBinDir, "curl");
      const expectedArtifactName = `release-evidence-${mode}-123456789`;
      await writeFile(
        fakeCurlPath,
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(callsPath)}
if [[ "\${FAKE_CURL_MODE:-success}" == "deny" ]]; then
  exit 22
fi
output_path=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--output" ]]; then
    output_path="$argument"
  fi
  previous="$argument"
done
if [[ "\${*: -1}" == */actions/artifacts/* ]]; then
  printf '{"name":"%s"}\\n' "$EXPECTED_ARTIFACT_NAME" > "$output_path"
fi
`,
        { encoding: "utf8", mode: 0o755 },
      );

      try {
        await writeFile(
          join(evidenceDir, "release-check-checkpoint.md"),
          "# Release Check Checkpoint — INCOMPLETE / NO-GO\n",
          "utf8",
        );
        const result = await runStoppedSummary(
          evidenceDir,
          join(evidenceDir, "step-summary.md"),
          mode,
          artifactUrl,
          {
            CHECKPOINT_ARTIFACT_NAME: expectedArtifactName,
            EXPECTED_ARTIFACT_NAME: expectedArtifactName,
            GITHUB_API_URL: "https://api.example.test",
            GITHUB_REPOSITORY: "example/factory",
            GITHUB_TOKEN: "test-token",
            PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
            RELEASE_BASE_REPOSITORY: scenario.baseRepository,
            RELEASE_EVENT_NAME: scenario.eventName,
            RELEASE_HEAD_REPOSITORY: scenario.headRepository,
            VERIFY_CHECKPOINT_ARTIFACT_LINK: "1",
          },
        );
        assert.equal(result.code, 0, result.output);
        assert.doesNotMatch(
          result.output,
          /https:\/\/github\.com\/example\/factory\/actions\/runs\/123456789\/artifacts\/987654321/,
          "artifact URLs must not be exposed in process output",
        );
        assert.doesNotMatch(
          result.output,
          /test-token/,
          "workflow tokens must not be exposed in process output",
        );

        const curlCalls = await readFile(callsPath, "utf8");
        assert.equal(
          (
            curlCalls.match(
              /https:\/\/github\.com\/example\/factory\/actions\/runs\/123456789\/artifacts\/987654321/g,
            ) ?? []
          ).length,
          1,
          `${mode}/${scenario.name} uploaded artifact link should be probed exactly once`,
        );
        assert.match(
          curlCalls,
          /Authorization: Bearer test-token/,
          `${mode}/${scenario.name} artifact link probe must authenticate`,
        );
        assert.match(
          curlCalls,
          /https:\/\/api\.example\.test\/repos\/example\/factory\/actions\/artifacts\/987654321/,
          `${mode}/${scenario.name} artifact metadata should be checked by artifact id`,
        );
      } finally {
        await rm(evidenceDir, { recursive: true, force: true });
        await rm(fakeBinDir, { recursive: true, force: true });
      }
    }
  }

  for (const mode of ["standard", "full"] as const) {
    const evidenceDir = await mkdtemp(
      join(tmpdir(), `release-summary-${mode}-fork-artifact-denied-`),
    );
    const fakeBinDir = await mkdtemp(
      join(tmpdir(), `release-summary-${mode}-fork-artifact-denied-bin-`),
    );
    const fakeCurlPath = join(fakeBinDir, "curl");
    const expectedArtifactName = `release-evidence-${mode}-123456789`;
    await writeFile(
      fakeCurlPath,
      `#!/usr/bin/env bash
set -euo pipefail
exit 22
`,
      { encoding: "utf8", mode: 0o755 },
    );

    try {
      await writeFile(
        join(evidenceDir, "release-check-checkpoint.md"),
        "# Release Check Checkpoint — INCOMPLETE / NO-GO\n",
        "utf8",
      );
      const result = await runStoppedSummary(
        evidenceDir,
        join(evidenceDir, "step-summary.md"),
        mode,
        artifactUrl,
        {
          CHECKPOINT_ARTIFACT_NAME: expectedArtifactName,
          GITHUB_API_URL: "https://api.example.test",
          GITHUB_REPOSITORY: "example/factory",
          GITHUB_TOKEN: "test-token",
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
          RELEASE_BASE_REPOSITORY: "example/factory",
          RELEASE_EVENT_NAME: "pull_request",
          RELEASE_HEAD_REPOSITORY: "contributor/factory",
          VERIFY_CHECKPOINT_ARTIFACT_LINK: "1",
        },
      );
      assert.equal(result.code, 1, result.output);
      assert.match(
        result.output,
        /forked pull request: the artifact link did not resolve\. The read-only workflow token could not verify the uploaded artifact\./,
        `${mode} fork access failure must explain the safe recovery path`,
      );
      assert.doesNotMatch(
        result.output,
        /https:\/\/github\.com\/example\/factory\/actions\/runs\/123456789\/artifacts\/987654321|test-token/,
        `${mode} fork access failure must not expose the URL or token`,
      );
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
      await rm(fakeBinDir, { recursive: true, force: true });
    }
  }

  for (const mode of ["standard", "full"] as const) {
    const evidenceDir = await mkdtemp(
      join(tmpdir(), `release-summary-${mode}-fork-artifact-missing-`),
    );
    try {
      await writeFile(
        join(evidenceDir, "release-check-checkpoint.md"),
        "# Release Check Checkpoint — INCOMPLETE / NO-GO\n",
        "utf8",
      );
      const result = await runStoppedSummary(
        evidenceDir,
        join(evidenceDir, "step-summary.md"),
        mode,
        "",
        {
          CHECKPOINT_ARTIFACT_NAME: `release-evidence-${mode}-123456789`,
          RELEASE_BASE_REPOSITORY: "example/factory",
          RELEASE_EVENT_NAME: "pull_request",
          RELEASE_HEAD_REPOSITORY: "contributor/factory",
          VERIFY_CHECKPOINT_ARTIFACT_LINK: "1",
        },
      );
      assert.equal(result.code, 1, result.output);
      assert.match(
        result.output,
        /forked pull request: no artifact link was provided by the upload step\./,
        `${mode} fork upload without a URL must fail with recovery guidance`,
      );
      assert.doesNotMatch(
        result.output,
        /test-token|https?:\/\//,
        `${mode} missing fork artifact failure must not expose sensitive values`,
      );
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  }

  console.log(
    "Stopped release artifact link verification passed (same-repository and forked pull requests; read-only success and denied access).",
  );
}

async function runStoppedSummaryScenario(): Promise<void> {
  const artifactUrl =
    "https://github.com/example/factory/actions/runs/123456789/artifacts/987654321";
  const artifactScenarios = [
    { name: "uploaded", artifactUrl },
    { name: "upload-failed", artifactUrl: "" },
  ] as const;

  for (const mode of ["standard", "full"] as const) {
    for (const artifactScenario of artifactScenarios) {
      const evidenceDir = await mkdtemp(
        join(tmpdir(), `release-summary-${mode}-${artifactScenario.name}-`),
      );
      const summaryPath = join(evidenceDir, "step-summary.md");
      try {
        await writeFile(
          join(evidenceDir, "release-check-checkpoint.md"),
          "# Release Check Checkpoint — INCOMPLETE / NO-GO\n",
          "utf8",
        );
        const result = await runStoppedSummary(
          evidenceDir,
          summaryPath,
          mode,
          artifactScenario.artifactUrl,
        );
        assert.equal(result.code, 0, result.output);
        assert.equal(
          result.output,
          "",
          "summary capture must not emit release evidence",
        );

        const artifactLine = artifactScenario.artifactUrl
          ? `[Download the stopped-check checkpoint artifact](${artifactScenario.artifactUrl})`
          : "The checkpoint artifact was not uploaded successfully.";
        const resumeCommand =
          mode === "full"
            ? "pnpm run release:check:full -- --resume"
            : "pnpm run release:check -- --resume";
        const regenerateCommand =
          mode === "full"
            ? "pnpm run release:check:full"
            : "pnpm run release:check";
        const expected = [
          "## Release check stopped — NO-GO",
          "",
          mode === "full"
            ? "The full release check stopped before all gates completed."
            : "The release check stopped before all gates completed.",
          "",
          artifactLine,
          "",
          "**This checkpoint is not retained release evidence and cannot support a GO decision.**",
          "",
          "Resume the incomplete check with:",
          "```text",
          resumeCommand,
          "```",
          "",
          "Or regenerate the retained report from a fresh run with:",
          "```text",
          regenerateCommand,
          "```",
          "",
        ].join("\n");
        const summary = await readFile(summaryPath, "utf8");
        assert.equal(
          summary,
          expected,
          `${mode}/${artifactScenario.name} stopped summary must remain an exact, auditable contract`,
        );
        if (artifactScenario.artifactUrl === "") {
          assert.match(
            summary,
            /The checkpoint artifact was not uploaded successfully\./,
            `${mode} must explain when the checkpoint artifact upload fails`,
          );
        }
        assert.match(summary, /not retained release evidence/);
        assert.ok(
          summary.includes(resumeCommand),
          `${mode} summary must include the matching resume command`,
        );
        assert.ok(
          summary.includes(regenerateCommand),
          `${mode} summary must include the matching regenerate command`,
        );
        assert.match(summary, /NO-GO/);
        assert.doesNotMatch(summary, /^Decision: GO$/m);
      } finally {
        await rm(evidenceDir, { recursive: true, force: true });
      }
    }
  }

  console.log(
    "Stopped release summary contract passed (standard/full; artifact link and upload-failure; non-retained verification only).",
  );
}

async function runParallelStageScenario(): Promise<void> {
  const evidenceDir = await mkdtemp(join(tmpdir(), "release-resume-parallel-"));
  const markerDir = await mkdtemp(
    join(tmpdir(), "release-resume-parallel-marker-"),
  );
  const firstMarker = join(markerDir, "first.json");
  const secondMarker = join(markerDir, "second.json");
  const afterMarker = join(markerDir, "after");
  const delayedGate = [
    "const fs = require('node:fs');",
    "const marker = process.env.RELEASE_PARALLEL_MARKER;",
    "const delay = Number(process.env.RELEASE_PARALLEL_DELAY);",
    "const start = Date.now();",
    "setTimeout(() => {",
    "  fs.writeFileSync(marker, JSON.stringify({ start, end: Date.now() }));",
    "  process.exit(0);",
    "}, delay);",
  ].join("");
  const afterGate = [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.RELEASE_PARALLEL_MARKER, String(Date.now()));",
  ].join("");
  const steps: FixtureStep[] = [
    {
      label: "parallel slow gate",
      command: process.execPath,
      args: ["-e", delayedGate],
      env: {
        RELEASE_PARALLEL_MARKER: firstMarker,
        RELEASE_PARALLEL_DELAY: "1000",
      },
      stage: "parallel-fixtures",
    },
    {
      label: "parallel fast gate",
      command: process.execPath,
      args: ["-e", delayedGate],
      env: {
        RELEASE_PARALLEL_MARKER: secondMarker,
        RELEASE_PARALLEL_DELAY: "40",
      },
      stage: "parallel-fixtures",
    },
    {
      label: "barrier gate",
      command: process.execPath,
      args: ["-e", afterGate],
      env: { RELEASE_PARALLEL_MARKER: afterMarker },
      stage: "after-parallel",
    },
  ];

  try {
    for (const file of [
      "clean-start/clean-start-evidence.json",
      "clean-start/browser-result.json",
      "clean-start/preview-home.png",
      "clean-start/startup-api.log",
      "clean-start/startup-web.log",
      "clean-start/startup-mockup.log",
    ]) {
      const path = join(evidenceDir, file);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "fixture evidence\n", { encoding: "utf8" });
    }
    const result = await runReleaseCheck(evidenceDir, steps, [], {
      RELEASE_CHECK_MAX_CONCURRENCY: "2",
    });
    assert.equal(result.code, 0, result.output);
    const first = JSON.parse(await readFile(firstMarker, "utf8")) as {
      start: number;
      end: number;
    };
    const second = JSON.parse(await readFile(secondMarker, "utf8")) as {
      start: number;
      end: number;
    };
    const barrierStarted = Number(await readFile(afterMarker, "utf8"));
    assert.ok(
      first.start < second.end && second.start < first.end,
      "parallel fixture gates should overlap",
    );
    assert.ok(
      barrierStarted >= Math.max(first.end, second.end),
      "the next stage must wait for every parallel gate",
    );

    const report = await readFile(
      join(evidenceDir, "release-check-report.md"),
      "utf8",
    );
    assert.ok(
      report.indexOf("| parallel slow gate | PASS |") <
        report.indexOf("| parallel fast gate | PASS |"),
      "the report must use declared step order, not completion order",
    );
    assert.match(report, /^Total wall-clock: \d+s$/m);
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
    await rm(markerDir, { recursive: true, force: true });
  }
}

async function getCurrentRevision(): Promise<string> {
  return new Promise((resolveRevision, reject) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: rootDir }, (error, stdout) =>
      error ? reject(error) : resolveRevision(stdout.trim()),
    );
  });
}

async function runRejectedCheckpointScenario(options: {
  name: string;
  args: string[];
  revision: string;
  mode: "standard" | "full";
}): Promise<void> {
  const evidenceDir = await mkdtemp(
    join(tmpdir(), `release-resume-rejected-${options.name}-`),
  );
  const markerDir = await mkdtemp(
    join(tmpdir(), `release-resume-rejected-${options.name}-marker-`),
  );
  const marker = join(markerDir, "gate-started");
  const steps: FixtureStep[] = [
    {
      label: "fixture gate must not start",
      command: process.execPath,
      args: [
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started\\n');`,
      ],
    },
  ];

  try {
    await writeFile(
      join(evidenceDir, "release-check-state.json"),
      `${JSON.stringify(
        {
          revision: options.revision,
          mode: options.mode,
          results: [
            {
              label: "fixture previous gate",
              passed: false,
              status: "FAIL",
              elapsedMs: 1,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const rejected = await runReleaseCheck(evidenceDir, steps, options.args);
    assert.equal(rejected.code, 1, rejected.output);
    assert.match(
      rejected.output,
      /Checkpoint revision or release mode is stale\. Rerun without --resume to create a fresh checkpoint\./,
      `${options.name} should explain why the checkpoint was rejected`,
    );
    assert.doesNotMatch(
      rejected.output,
      /uncaught|at readCheckpoint|Cannot resume release check:/i,
      `${options.name} should report a concise recovery message`,
    );
    await assert.rejects(
      readFile(marker, "utf8"),
      `${options.name} must reject the checkpoint before starting any gate`,
    );
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
    await rm(markerDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  const evidenceDir = await mkdtemp(join(tmpdir(), "release-resume-"));
  const markerDir = await mkdtemp(join(tmpdir(), "release-resume-marker-"));
  const marker = join(markerDir, "gate-two-started");
  const gateTwoScript = [
    "const fs = require('node:fs');",
    "const marker = process.env.RELEASE_RESUME_MARKER;",
    "if (!marker) process.exit(2);",
    "if (!fs.existsSync(marker)) {",
    "  fs.writeFileSync(marker, 'started\\n');",
    "  console.log('fixture gate two attempt');",
    "  setTimeout(() => {}, 10_000);",
    "} else {",
    "  console.log('fixture gate two resumed');",
    "  process.exit(0);",
    "}",
  ].join("");
  const steps: FixtureStep[] = [
    {
      label: "fixture gate one",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    },
    {
      label: "fixture gate two",
      command: process.execPath,
      args: ["-e", gateTwoScript],
      timeoutMs: 500,
      env: { RELEASE_RESUME_MARKER: marker },
    },
    {
      label: "fixture gate three",
      command: process.execPath,
      args: [
        "-e",
        "console.log('fixture gate three resumed'); process.exit(0)",
      ],
    },
  ];

  try {
    for (const file of [
      "clean-start/clean-start-evidence.json",
      "clean-start/browser-result.json",
      "clean-start/preview-home.png",
      "clean-start/startup-api.log",
      "clean-start/startup-web.log",
      "clean-start/startup-mockup.log",
    ]) {
      const path = join(evidenceDir, file);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "fixture evidence\n", { encoding: "utf8" });
    }
    const priorRetainedReport =
      "# Prior retained release report\nDecision: GO\n";
    await writeFile(
      join(evidenceDir, "release-check-report.md"),
      priorRetainedReport,
      "utf8",
    );

    const interrupted = await runReleaseCheck(evidenceDir, steps);
    assert.equal(interrupted.code, 1, interrupted.output);
    assert.match(
      interrupted.output,
      /fixture gate two exceeded its 0 minute timeout/,
    );

    const checkpointPath = join(evidenceDir, "release-check-state.json");
    const firstCheckpoint = JSON.parse(
      await readFile(checkpointPath, "utf8"),
    ) as {
      revision: string;
      mode: string;
      results: Array<{ label: string; passed: boolean; status: string }>;
    };
    assert.equal(firstCheckpoint.mode, "standard");
    assert.equal(firstCheckpoint.results.length, 2);
    assert.deepEqual(
      firstCheckpoint.results.map(({ label, passed, status }) => [
        label,
        passed,
        status,
      ]),
      [
        ["fixture gate one", true, "PASS"],
        ["fixture gate two", false, "INFRASTRUCTURE TIMEOUT"],
      ],
      "the interrupted run must checkpoint the failed gate, not omit it",
    );
    assert.equal(await readFile(marker, "utf8"), "started\n");
    assert.equal(
      await readFile(join(evidenceDir, "release-check-report.md"), "utf8"),
      priorRetainedReport,
      "an interrupted run must not overwrite the prior retained report",
    );
    const checkpointReport = await readFile(
      join(evidenceDir, "release-check-checkpoint.md"),
      "utf8",
    );
    assert.match(
      checkpointReport,
      /^# Release Check Checkpoint — INCOMPLETE \/ NO-GO$/m,
    );
    assert.match(checkpointReport, /^Report status: INCOMPLETE CHECKPOINT$/m);
    assert.match(
      checkpointReport,
      /Gates not reached: fixture gate three \(NOT REACHED\)/,
    );
    assert.match(
      checkpointReport,
      /^Resume: pnpm run release:check -- --resume$/m,
      "the standard checkpoint must publish its matching resume command",
    );
    assert.match(
      checkpointReport,
      /^Regenerate: pnpm run release:check$/m,
      "the standard checkpoint must publish its matching regenerate command",
    );
    assert.match(
      interrupted.output,
      /Release checkpoint \(INCOMPLETE \/ NO-GO; not retained evidence\):/,
      "the console must distinguish a checkpoint from retained evidence",
    );

    const resumed = await runReleaseCheck(evidenceDir, steps, ["--resume"]);
    assert.equal(resumed.code, 0, resumed.output);
    assert.match(resumed.output, /Resuming after 1 completed gate\(s\)\./);
    assert.doesNotMatch(
      resumed.output,
      /Resuming after 2 completed gate\(s\)\./,
      "resume must not treat the failed gate as completed",
    );

    const report = await readFile(
      join(evidenceDir, "release-check-report.md"),
      "utf8",
    );
    for (const label of [
      "fixture gate one",
      "fixture gate two",
      "fixture gate three",
    ]) {
      assert.match(report, new RegExp(`\\| ${label} \\| PASS \\|`));
    }
    assert.equal(
      (report.match(/\| fixture gate two \| PASS \|/g) ?? []).length,
      1,
      "the final report must contain one successful result for the rerun gate",
    );
    const log = await readFile(join(evidenceDir, "release-check.log"), "utf8");
    assert.match(log, /fixture gate two attempt/);
    assert.match(log, /fixture gate two resumed/);
    assert.ok(
      log.indexOf("fixture gate two attempt") <
        log.indexOf("fixture gate two resumed"),
      "the durable log must retain the failed attempt before later gates",
    );
    assert.ok(
      log.indexOf("fixture gate two resumed") <
        log.indexOf("fixture gate three resumed"),
      "the resumed failed gate must run before subsequent gates",
    );
    assert.equal(
      await readFile(checkpointPath, "utf8"),
      "",
      "only a fully successful resumed run may clear its checkpoint",
    );
    await assert.rejects(
      readFile(join(evidenceDir, "release-check-checkpoint.md"), "utf8"),
      "a successful resumed run must remove its stale checkpoint report",
    );
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
    await rm(markerDir, { recursive: true, force: true });
  }

  console.log(
    "Release resume integration test passed (checkpoint, rerun, log, report).",
  );
}

async function runParallelResumeScenario(): Promise<void> {
  const evidenceDir = await mkdtemp(
    join(tmpdir(), "release-resume-parallel-retry-"),
  );
  const markerDir = await mkdtemp(
    join(tmpdir(), "release-resume-parallel-retry-marker-"),
  );
  const passedMarker = join(markerDir, "passed");
  const retryMarker = join(markerDir, "retry");
  const afterMarker = join(markerDir, "after");
  const onceGate = [
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.env.RELEASE_PARALLEL_MARKER, 'started\\n');",
  ].join("");
  const timeoutThenPassGate = [
    "const fs = require('node:fs');",
    "const marker = process.env.RELEASE_PARALLEL_MARKER;",
    "if (!fs.existsSync(marker)) {",
    "  fs.writeFileSync(marker, 'timed-out\\n');",
    "  setTimeout(() => {}, 10_000);",
    "} else {",
    "  fs.appendFileSync(marker, 'resumed\\n');",
    "  process.exit(0);",
    "}",
  ].join("");
  const afterGate = [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.RELEASE_PARALLEL_MARKER, 'started\\n');",
  ].join("");
  const steps: FixtureStep[] = [
    {
      label: "parallel passed gate",
      command: process.execPath,
      args: ["-e", onceGate],
      env: { RELEASE_PARALLEL_MARKER: passedMarker },
      stage: "parallel-resume-fixtures",
    },
    {
      label: "parallel retry gate",
      command: process.execPath,
      args: ["-e", timeoutThenPassGate],
      timeoutMs: 250,
      env: { RELEASE_PARALLEL_MARKER: retryMarker },
      stage: "parallel-resume-fixtures",
    },
    {
      label: "parallel resume barrier",
      command: process.execPath,
      args: ["-e", afterGate],
      env: { RELEASE_PARALLEL_MARKER: afterMarker },
      stage: "after-parallel-resume",
    },
  ];

  try {
    for (const file of [
      "clean-start/clean-start-evidence.json",
      "clean-start/browser-result.json",
      "clean-start/preview-home.png",
      "clean-start/startup-api.log",
      "clean-start/startup-web.log",
      "clean-start/startup-mockup.log",
    ]) {
      const path = join(evidenceDir, file);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "fixture evidence\n", { encoding: "utf8" });
    }
    const interrupted = await runReleaseCheck(evidenceDir, steps, [], {
      RELEASE_CHECK_MAX_CONCURRENCY: "2",
    });
    assert.equal(interrupted.code, 1, interrupted.output);
    const checkpoint = JSON.parse(
      await readFile(join(evidenceDir, "release-check-state.json"), "utf8"),
    ) as { results: Array<{ label: string; passed: boolean; status: string }> };
    assert.deepEqual(
      checkpoint.results.map(({ label, passed, status }) => [
        label,
        passed,
        status,
      ]),
      [
        ["parallel passed gate", true, "PASS"],
        ["parallel retry gate", false, "INFRASTRUCTURE TIMEOUT"],
      ],
      "a partially completed parallel stage must checkpoint each child in step order",
    );
    assert.equal(await readFile(passedMarker, "utf8"), "started\n");

    const resumed = await runReleaseCheck(evidenceDir, steps, ["--resume"], {
      RELEASE_CHECK_MAX_CONCURRENCY: "2",
    });
    assert.equal(resumed.code, 0, resumed.output);
    assert.match(resumed.output, /Resuming after 1 completed gate\(s\)\./);
    assert.equal(
      await readFile(passedMarker, "utf8"),
      "started\n",
      "resume must not rerun a passed child from a partially completed group",
    );
    assert.equal(
      await readFile(retryMarker, "utf8"),
      "timed-out\nresumed\n",
      "resume must rerun the failed child before the next stage",
    );
    assert.equal(await readFile(afterMarker, "utf8"), "started\n");
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
    await rm(markerDir, { recursive: true, force: true });
  }
}

async function runOnboardingGuardStopScenario(): Promise<void> {
  const evidenceDir = await mkdtemp(join(tmpdir(), "release-onboarding-"));
  const fixtureDir = await mkdtemp(join(tmpdir(), "release-onboarding-specs-"));
  const browserMarker = join(fixtureDir, "browser-evidence-started");
  const browserEvidenceGate = [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.RELEASE_BROWSER_EVIDENCE_MARKER, 'started\\n');",
  ].join("");
  const steps: FixtureStep[] = [
    {
      label: "onboarding bypass guard",
      command: process.execPath,
      args: [onboardingGuard],
      env: { ONBOARDING_GUARD_E2E_DIRECTORY: fixtureDir },
      stage: "browser-guard",
    },
    {
      label: "browser evidence gate",
      command: process.execPath,
      args: ["-e", browserEvidenceGate],
      env: { RELEASE_BROWSER_EVIDENCE_MARKER: browserMarker },
      stage: "browser-evidence",
    },
  ];

  try {
    await writeFile(
      join(fixtureDir, "bypasses-onboarding.spec.ts"),
      "page.locator('#accessCode');\n",
      "utf8",
    );

    const result = await runReleaseCheck(evidenceDir, steps);
    assert.equal(result.code, 1, result.output);
    assert.match(
      result.output,
      /bypasses-onboarding\.spec\.ts: browser sign-up must use signUpAndHandleOnboarding from onboarding\.ts/,
      "the failed onboarding guard must retain its actionable message",
    );
    assert.match(
      result.output,
      /browser-guard has a failed gate; later stages were not started\./,
      "the runner must stop after the onboarding guard stage",
    );
    assert.deepEqual(
      await readFile(
        join(evidenceDir, "release-check-state.json"),
        "utf8",
      ).then((contents) => {
        const checkpoint = JSON.parse(contents) as {
          results: Array<{ label: string; passed: boolean; status: string }>;
        };
        return checkpoint.results.map(({ label, passed, status }) => ({
          label,
          passed,
          status,
        }));
      }),
      [
        {
          label: "onboarding bypass guard",
          passed: false,
          status: "FAIL",
        },
      ],
      "the runner must checkpoint the failed onboarding gate",
    );
    await assert.rejects(
      readFile(browserMarker, "utf8"),
      "the later browser evidence gate must not start",
    );
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }

  console.log(
    "Release onboarding guard scenario passed (actionable failure stops browser evidence).",
  );
}

async function runApiShardConcurrencyScenario(): Promise<void> {
  const evidenceDir = await mkdtemp(join(tmpdir(), "release-resume-api-cap-"));
  const markerDir = await mkdtemp(
    join(tmpdir(), "release-resume-api-cap-marker-"),
  );
  const eventsPath = join(markerDir, "events");
  const gateScript = [
    "const fs = require('node:fs');",
    "const eventsPath = process.env.RELEASE_API_EVENTS;",
    "fs.appendFileSync(eventsPath, 'start\\n');",
    "setTimeout(() => {",
    "  fs.appendFileSync(eventsPath, 'end\\n');",
    "  process.exit(0);",
    "}, Number(process.env.RELEASE_API_DELAY));",
  ].join("");
  const steps: FixtureStep[] = Array.from({ length: 4 }, (_, index) => ({
    label: `API fixture shard ${index + 1}`,
    command: process.execPath,
    args: ["-e", gateScript],
    env: {
      RELEASE_API_EVENTS: eventsPath,
      RELEASE_API_DELAY: "500",
    },
    group: "api-test-shards",
    stage: "api-cap-fixtures",
  }));

  try {
    for (const file of [
      "clean-start/clean-start-evidence.json",
      "clean-start/browser-result.json",
      "clean-start/preview-home.png",
      "clean-start/startup-api.log",
      "clean-start/startup-web.log",
      "clean-start/startup-mockup.log",
    ]) {
      const path = join(evidenceDir, file);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "fixture evidence\n", { encoding: "utf8" });
    }
    const result = await runReleaseCheck(evidenceDir, steps, [], {
      RELEASE_CHECK_MAX_CONCURRENCY: "4",
    });
    assert.equal(result.code, 0, result.output);
    let active = 0;
    let observedPeak = 0;
    for (const event of (await readFile(eventsPath, "utf8"))
      .trim()
      .split("\n")) {
      active += event === "start" ? 1 : -1;
      observedPeak = Math.max(observedPeak, active);
    }
    assert.equal(
      observedPeak,
      2,
      "API fixture shards must never exceed the documented two-child database cap",
    );
    assert.match(
      result.output,
      /Stage api-cap-fixtures: 4 gates \(max 4 concurrent; API\/database max 2\)/,
      "the release runner should report the API-specific cap",
    );
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
    await rm(markerDir, { recursive: true, force: true });
  }
}

async function runFullModeScenario(): Promise<void> {
  const evidenceDir = await mkdtemp(join(tmpdir(), "release-resume-full-"));
  const markerDir = await mkdtemp(
    join(tmpdir(), "release-resume-full-marker-"),
  );
  const marker = join(markerDir, "full-browser-started");
  const revision = await getCurrentRevision();
  const browserReport = [
    "# Full Browser Release Run",
    "",
    `Revision: ${revision}`,
    "Result: PASS",
    "Expected cases: 113",
    "Enumerated cases: 113",
    "Completed cases: 113",
    "Passed cases: 113",
    "Skipped cases: 0",
    "Failed cases: 0",
    "Not-run cases: 0",
    "Coverage: COMPLETE",
    "Duration: 1ms",
    "## Per-file duration",
    "",
    "| File | Cases | Completed | Passed | Skipped | Failed | Not run | Duration |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    "| `e2e/example.spec.ts` | 113 | 113 | 113 | 0 | 0 | 0 | 1ms |",
    "",
  ].join("\n");
  const fullBrowserScript = [
    "const fs = require('node:fs');",
    "const marker = process.env.RELEASE_RESUME_MARKER;",
    "if (!marker) process.exit(2);",
    "if (!fs.existsSync(marker)) {",
    "  fs.writeFileSync(marker, 'started\\n');",
    "  console.log('fixture full browser attempt');",
    "  setTimeout(() => {}, 10_000);",
    "} else {",
    "  console.log('fixture full browser resumed');",
    "  process.exit(0);",
    "}",
  ].join("");
  const steps: FixtureStep[] = [
    {
      label: "fixture gate one",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    },
    {
      label: "full browser E2E suite",
      command: process.execPath,
      args: ["-e", fullBrowserScript],
      timeoutMs: 500,
      env: { RELEASE_RESUME_MARKER: marker },
    },
    {
      label: "fixture gate three",
      command: process.execPath,
      args: [
        "-e",
        "console.log('fixture gate three resumed'); process.exit(0)",
      ],
    },
  ];

  try {
    for (const file of [
      "clean-start/clean-start-evidence.json",
      "clean-start/browser-result.json",
      "clean-start/preview-home.png",
      "clean-start/startup-api.log",
      "clean-start/startup-web.log",
      "clean-start/startup-mockup.log",
      "browser-full/FINAL-REPORT.md",
    ]) {
      const path = join(evidenceDir, file);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        file === "browser-full/FINAL-REPORT.md"
          ? browserReport
          : "fixture evidence\n",
        { encoding: "utf8" },
      );
    }
    const priorRetainedReport =
      "# Prior retained full release report\nDecision: GO\n";
    await writeFile(
      join(evidenceDir, "release-check-report.md"),
      priorRetainedReport,
      "utf8",
    );

    const interrupted = await runReleaseCheck(evidenceDir, steps, ["--full"]);
    assert.equal(interrupted.code, 1, interrupted.output);
    assert.match(
      interrupted.output,
      /full browser E2E suite exceeded its 0 minute timeout/,
    );

    const checkpointPath = join(evidenceDir, "release-check-state.json");
    const firstCheckpoint = JSON.parse(
      await readFile(checkpointPath, "utf8"),
    ) as {
      revision: string;
      mode: string;
      results: Array<{ label: string; passed: boolean; status: string }>;
    };
    assert.equal(firstCheckpoint.mode, "full");
    assert.equal(firstCheckpoint.results.length, 2);
    assert.deepEqual(
      firstCheckpoint.results.map(({ label, passed, status }) => [
        label,
        passed,
        status,
      ]),
      [
        ["fixture gate one", true, "PASS"],
        ["full browser E2E suite", false, "INFRASTRUCTURE TIMEOUT"],
      ],
      "full mode must checkpoint the interrupted browser gate as failed",
    );
    assert.equal(await readFile(marker, "utf8"), "started\n");

    const interruptedReport = await readFile(
      join(evidenceDir, "release-check-report.md"),
      "utf8",
    );
    assert.equal(
      interruptedReport,
      priorRetainedReport,
      "an interrupted full run must leave the prior retained report untouched",
    );
    const interruptedCheckpointReport = await readFile(
      join(evidenceDir, "release-check-checkpoint.md"),
      "utf8",
    );
    assert.match(interruptedCheckpointReport, /^Mode: full$/m);
    assert.match(
      interruptedCheckpointReport,
      /^# Release Check Checkpoint — INCOMPLETE \/ NO-GO$/m,
    );
    assert.match(
      interruptedCheckpointReport,
      /^Report status: INCOMPLETE CHECKPOINT$/m,
    );
    assert.match(
      interruptedCheckpointReport,
      /\| full browser E2E suite \| INFRASTRUCTURE TIMEOUT \|/,
    );
    assert.match(
      interruptedCheckpointReport,
      /^Resume: pnpm run release:check:full -- --resume$/m,
      "the full checkpoint must publish its matching resume command",
    );
    assert.match(
      interruptedCheckpointReport,
      /^Regenerate: pnpm run release:check:full$/m,
      "the full checkpoint must publish its matching regenerate command",
    );
    assert.doesNotMatch(
      interruptedCheckpointReport,
      /^Decision: GO$/m,
      "an interrupted full browser gate must not produce a passing report",
    );

    const resumed = await runReleaseCheck(evidenceDir, steps, [
      "--full",
      "--resume",
    ]);
    assert.equal(resumed.code, 0, resumed.output);
    assert.match(resumed.output, /Resuming after 1 completed gate\(s\)\./);
    assert.doesNotMatch(
      resumed.output,
      /Resuming after 2 completed gate\(s\)\./,
      "resume must rerun the failed full browser gate",
    );

    const report = await readFile(
      join(evidenceDir, "release-check-report.md"),
      "utf8",
    );
    assert.match(report, /^Revision: \S+$/m);
    assert.equal(
      report.match(/^Revision:\s*(\S+)\s*$/m)?.[1],
      firstCheckpoint.revision,
      "resume must keep the checkpoint revision",
    );
    assert.match(report, /^Mode: full$/m);
    assert.match(report, /^Decision: GO$/m);
    for (const label of [
      "fixture gate one",
      "full browser E2E suite",
      "fixture gate three",
    ]) {
      assert.match(report, new RegExp(`\\| ${label} \\| PASS \\|`));
    }
    assert.equal(
      (report.match(/\| full browser E2E suite \| PASS \|/g) ?? []).length,
      1,
      "the full report must contain one successful result for the rerun browser gate",
    );
    const log = await readFile(join(evidenceDir, "release-check.log"), "utf8");
    assert.match(log, /fixture full browser attempt/);
    assert.match(log, /fixture full browser resumed/);
    assert.ok(
      log.indexOf("fixture full browser attempt") <
        log.indexOf("fixture full browser resumed"),
      "the full browser rerun must follow its interrupted attempt",
    );
    assert.ok(
      log.indexOf("fixture full browser resumed") <
        log.indexOf("fixture gate three resumed"),
      "the resumed full browser gate must run before subsequent gates",
    );
    assert.equal(
      await readFile(checkpointPath, "utf8"),
      "",
      "full mode may clear its checkpoint only after every gate passes",
    );
    await assert.rejects(
      readFile(join(evidenceDir, "release-check-checkpoint.md"), "utf8"),
      "full resume must remove its stale checkpoint report",
    );
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
    await rm(markerDir, { recursive: true, force: true });
  }
}

async function runStaleCheckpointScenarios(): Promise<void> {
  const revision = await getCurrentRevision();
  await runRejectedCheckpointScenario({
    name: "revision",
    args: ["--resume"],
    revision: `${revision}-stale`,
    mode: "standard",
  });
  await runRejectedCheckpointScenario({
    name: "standard-to-full",
    args: ["--full", "--resume"],
    revision,
    mode: "standard",
  });
  await runRejectedCheckpointScenario({
    name: "full-to-standard",
    args: ["--resume"],
    revision,
    mode: "full",
  });
  console.log(
    "Release resume stale-checkpoint scenarios passed (revision and mode).",
  );
}

async function runDamagedCheckpointScenarios(): Promise<void> {
  for (const scenario of ["truncated", "unreadable"]) {
    const evidenceDir = await mkdtemp(
      join(tmpdir(), `release-resume-damaged-${scenario}-`),
    );
    const checkpointPath = join(evidenceDir, "release-check-state.json");
    const steps: FixtureStep[] = [
      {
        label: "fixture gate must not start",
        command: process.execPath,
        args: ["-e", "throw new Error('gate should not run');"],
      },
    ];

    try {
      if (scenario === "truncated") {
        await writeFile(checkpointPath, '{"revision":"truncated"', "utf8");
      } else {
        await mkdir(checkpointPath);
      }

      const rejected = await runReleaseCheck(evidenceDir, steps, ["--resume"]);
      assert.equal(rejected.code, 1, rejected.output);
      assert.match(
        rejected.output,
        /Release checkpoint is malformed or unreadable\. Rerun without --resume to create a fresh checkpoint\./,
        `${scenario} checkpoint should explain how to recover`,
      );
      assert.doesNotMatch(
        rejected.output,
        /uncaught|at readCheckpoint|Cannot resume release check:|Unexpected end of JSON input|EISDIR/i,
        `${scenario} checkpoint should not expose parser or filesystem details`,
      );
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  }
  console.log("Release resume damaged-checkpoint scenarios passed.");
}

if (process.env.RELEASE_STOPPED_SUMMARY_ONLY === "1") {
  await runStoppedArtifactLinkVerificationScenario();
  await runStoppedSummaryScenario();
} else {
  await run();
  await runOnboardingGuardStopScenario();
  await runParallelStageScenario();
  await runApiShardConcurrencyScenario();
  await runParallelResumeScenario();
  await runFullModeScenario();
  await runStaleCheckpointScenarios();
  await runDamagedCheckpointScenarios();
}
