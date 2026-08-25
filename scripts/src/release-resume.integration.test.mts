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
};

const rootDir = resolve(new URL("../../", import.meta.url).pathname);
const releaseCheck = join(rootDir, "scripts", "src", "release-check.mts");

function runReleaseCheck(
  evidenceDir: string,
  steps: FixtureStep[],
  args: string[] = [],
): Promise<{ code: number; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "tsx", releaseCheck, ...args],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          RELEASE_EVIDENCE_DIR: evidenceDir,
          RELEASE_CHECK_FIXTURE_STEPS: JSON.stringify(steps),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
      args: ["-e", "console.log('fixture gate three resumed'); process.exit(0)"],
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

    const interrupted = await runReleaseCheck(evidenceDir, steps);
    assert.equal(interrupted.code, 1, interrupted.output);
    assert.match(interrupted.output, /fixture gate two exceeded its 0 minute timeout/);

    const checkpointPath = join(evidenceDir, "release-check-state.json");
    const firstCheckpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as {
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

    const resumed = await runReleaseCheck(evidenceDir, steps, ["--resume"]);
    assert.equal(resumed.code, 0, resumed.output);
    assert.match(resumed.output, /Resuming after 1 completed gate\(s\)\./);
    assert.doesNotMatch(
      resumed.output,
      /Resuming after 2 completed gate\(s\)\./,
      "resume must not treat the failed gate as completed",
    );

    const report = await readFile(join(evidenceDir, "release-check-report.md"), "utf8");
    for (const label of ["fixture gate one", "fixture gate two", "fixture gate three"]) {
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
  } finally {
    await rm(evidenceDir, { recursive: true, force: true });
    await rm(markerDir, { recursive: true, force: true });
  }

  console.log("Release resume integration test passed (checkpoint, rerun, log, report).");
}

async function runFullModeScenario(): Promise<void> {
  const evidenceDir = await mkdtemp(join(tmpdir(), "release-resume-full-"));
  const markerDir = await mkdtemp(join(tmpdir(), "release-resume-full-marker-"));
  const marker = join(markerDir, "full-browser-started");
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
      args: ["-e", "console.log('fixture gate three resumed'); process.exit(0)"],
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
      await writeFile(path, "fixture evidence\n", { encoding: "utf8" });
    }

    const interrupted = await runReleaseCheck(evidenceDir, steps, ["--full"]);
    assert.equal(interrupted.code, 1, interrupted.output);
    assert.match(
      interrupted.output,
      /full browser E2E suite exceeded its 0 minute timeout/,
    );

    const checkpointPath = join(evidenceDir, "release-check-state.json");
    const firstCheckpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as {
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
    assert.match(interruptedReport, /^Mode: full$/m);
    assert.match(interruptedReport, /^Decision: NO-GO$/m);
    assert.match(
      interruptedReport,
      /\| full browser E2E suite \| INFRASTRUCTURE TIMEOUT \|/,
    );
    assert.doesNotMatch(
      interruptedReport,
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

    const report = await readFile(join(evidenceDir, "release-check-report.md"), "utf8");
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

await run();
await runFullModeScenario();
await runStaleCheckpointScenarios();
await runDamagedCheckpointScenarios();