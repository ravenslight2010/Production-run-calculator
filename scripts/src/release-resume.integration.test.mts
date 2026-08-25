import assert from "node:assert/strict";
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

await run();