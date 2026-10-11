import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GNU_TIME = "/usr/bin/time";
const EXPECTED_PACKAGE_MANAGER = "12.8.1";
const RUNTIMES = [
  { key: "node24", expectedVersion: "v24.21.0", label: "Node 24 baseline" },
  { key: "node26", expectedVersion: "v26.10.0", label: "Node 26 candidate" },
];
const CHECK_TIMEOUT_MS = {
  install: 15 * 60_000,
  typecheck: 18 * 60_000,
  unitTests: 12 * 60_000,
  databaseCreate: 2 * 60_000,
  databaseSchema: 3 * 60_000,
  apiIntegration: 12 * 60_000,
  productionBuild: 24 * 60_000,
};

export function parsePeakRssKiB(stderrTail) {
  const match = stderrTail.match(/NODE_ADVISORY_PEAK_RSS_KIB=(\d+)(?:\s|$)/u);
  return match ? Number(match[1]) : null;
}

export function checkOutcome({ exitCode, timedOut, spawnError }) {
  if (spawnError) return "INFRASTRUCTURE_ERROR";
  if (timedOut) return "TIMEOUT";
  return exitCode === 0 ? "PASS" : "FAIL";
}

export function compareCheckMeasurements(baselineChecks, candidateChecks) {
  const candidateById = new Map(candidateChecks.map((check) => [check.id, check]));
  return baselineChecks.map((baseline) => {
    const candidate = candidateById.get(baseline.id);
    if (!candidate) throw new Error(`Node 26 comparison is missing check ${baseline.id}.`);
    return {
      id: baseline.id,
      baselineOutcome: baseline.outcome,
      candidateOutcome: candidate.outcome,
      elapsedDeltaMs:
        Number.isFinite(baseline.elapsedMs) && Number.isFinite(candidate.elapsedMs)
          ? candidate.elapsedMs - baseline.elapsedMs
          : null,
      peakRssDeltaKiB:
        Number.isFinite(baseline.peakRssKiB) && Number.isFinite(candidate.peakRssKiB)
          ? candidate.peakRssKiB - baseline.peakRssKiB
          : null,
    };
  });
}

export function cleanWorktreeEnvironment(environment) {
  // The advisory check does not use the large LFS ZIP archives; keep linked
  // worktree checkouts from trying to download them again.
  return { ...environment, GIT_LFS_SKIP_SMUDGE: "1" };
}

function runCaptured(command, args, { cwd = ROOT, env = process.env, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("A version probe exceeded its time limit."));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4096) stdout += chunk.slice(0, 4096 - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("A version probe failed."));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error("Unable to verify the source checkout.");
  return result.stdout.trim();
}

function validateInputs(environment) {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("The advisory comparison supports only the Linux x64 runner.");
  }
  if (!existsSync(GNU_TIME)) {
    throw new Error("GNU /usr/bin/time is required for bounded resource measurements.");
  }
  const outputDir = path.resolve(environment.NODE_COMPATIBILITY_OUTPUT_DIR ?? "");
  const relativeOutput = path.relative(ROOT, outputDir);
  if (!environment.NODE_COMPATIBILITY_OUTPUT_DIR || !relativeOutput.startsWith("..")) {
    throw new Error("The advisory report directory must be outside the repository.");
  }
  if (!/^[a-f0-9]{40}$/u.test(environment.GITHUB_SHA ?? "")) {
    throw new Error("GITHUB_SHA must identify the exact 40-character source revision.");
  }
  if (
    !/^\d+$/u.test(environment.GITHUB_RUN_ID ?? "") ||
    !/^\d+$/u.test(environment.GITHUB_RUN_ATTEMPT ?? "")
  ) {
    throw new Error("The GitHub Actions run ID and attempt are required for evidence provenance.");
  }
  if (!environment.RUNNER_TEMP || !environment.PNPM_BIN) {
    throw new Error("The hosted runner temp directory and pnpm binary are required.");
  }
  if (!environment.NODE24_BIN || !environment.NODE26_BIN) {
    throw new Error("Both exact Node runtime binaries are required.");
  }
  if (!environment.NODE_COMPATIBILITY_ADMIN_DATABASE_URL) {
    throw new Error("The disposable PostgreSQL service URL is required.");
  }
  const currentRevision = gitOutput(["rev-parse", "HEAD"]);
  if (currentRevision !== environment.GITHUB_SHA) {
    throw new Error("The checked-out source revision differs from GITHUB_SHA.");
  }
  if (gitOutput(["status", "--porcelain", "--untracked-files=all"]) !== "") {
    throw new Error("The advisory comparison requires a clean checkout.");
  }
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (packageJson.packageManager !== `pnpm@${EXPECTED_PACKAGE_MANAGER}`) {
    throw new Error("The advisory comparison requires the repository-pinned pnpm version.");
  }
  return { outputDir, packageJson };
}

async function probeVersion(binary, args, environment) {
  const result = await runCaptured(binary, args, {
    cwd: ROOT,
    env: environment,
    timeoutMs: 10_000,
  });
  return result.stdout;
}

function createRuntimeEnvironment(baseEnvironment, runtime, runtimeWorkspace, databaseName) {
  const runtimePath = path.dirname(runtime.binary);
  const env = {
    ...baseEnvironment,
    PATH: `${runtimePath}${path.delimiter}${baseEnvironment.PATH ?? ""}`,
    DATABASE_URL: new URL(
      `/${databaseName}`,
      baseEnvironment.NODE_COMPATIBILITY_ADMIN_DATABASE_URL,
    ).toString(),
    NODE_COMPATIBILITY_DATABASE_NAME: databaseName,
    NODE_ENV: "test",
    E2E_TEST_DB: "1",
    E2E_APPROVED_DESTRUCTIVE_MODE: "1",
  };
  env.NODE_COMPATIBILITY_WORKSPACE = runtimeWorkspace;
  return env;
}

function readFileTail(filePath, byteLimit = 16 * 1024) {
  const size = statSync(filePath).size;
  const length = Math.min(size, byteLimit);
  const descriptor = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

async function runMeasuredCheck({
  id,
  displayCommand,
  command,
  args,
  cwd,
  env,
  timeoutMs,
  logDirectory,
}) {
  const stdoutPath = path.join(logDirectory, `${id}.stdout`);
  const stderrPath = path.join(logDirectory, `${id}.stderr`);
  const stdoutFd = openSync(stdoutPath, "w", 0o600);
  const stderrFd = openSync(stderrPath, "w", 0o600);
  const startedAt = performance.now();
  let timedOut = false;
  let spawnError;
  let child;
  let killTimer;
  const timer = setTimeout(() => {
    if (!child || child.pid === undefined) return;
    timedOut = true;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    killTimer = setTimeout(() => {
      if (child?.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 5_000);
    killTimer.unref();
  }, timeoutMs);
  timer.unref();

  let exitCode = null;
  try {
    child = spawn(
      GNU_TIME,
      ["-f", "NODE_ADVISORY_PEAK_RSS_KIB=%M", "--", command, ...args],
      {
        cwd,
        env,
        detached: true,
        stdio: ["ignore", stdoutFd, stderrFd],
      },
    );
    await new Promise((resolve, reject) => {
      let settled = false;
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        spawnError = error.code ?? "SPAWN_ERROR";
        reject(error);
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        exitCode = code;
        resolve();
      });
    });
  } catch {
    if (!spawnError) spawnError = "COMMAND_FAILED_TO_START";
  } finally {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  let peakRssKiB = null;
  try {
    peakRssKiB = parsePeakRssKiB(readFileTail(stderrPath));
  } finally {
    rmSync(stdoutPath, { force: true });
    rmSync(stderrPath, { force: true });
  }
  const outcome = checkOutcome({ exitCode, timedOut, spawnError });
  const evidence = {
    id,
    command: displayCommand,
    outcome,
    exitCode,
    timedOut,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    peakRssKiB,
    failureCode:
      spawnError ??
      (timedOut ? "TIMEOUT" : exitCode === 0 ? null : `EXIT_CODE_${exitCode ?? "UNKNOWN"}`),
    skipReason: null,
  };
  console.log(
    `${evidence.outcome.padEnd(20)} ${evidence.id.padEnd(24)} ` +
      `${evidence.elapsedMs} ms, peak RSS ${evidence.peakRssKiB ?? "unavailable"} KiB`,
  );
  return evidence;
}

async function addDisposableDatabase(runtime, pnpmBinary, env, workspace, logDirectory) {
  const databaseName = `node_compatibility_${runtime.key}`;
  if (!/^node_compatibility_node(?:24|26)$/u.test(databaseName)) {
    throw new Error("The generated disposable database name is invalid.");
  }
  const setupCode = [
    'const { Client } = require("pg");',
    "(async () => {",
    "  const client = new Client({ connectionString: process.env.NODE_COMPATIBILITY_ADMIN_DATABASE_URL });",
    "  try {",
    "    await client.connect();",
    '    await client.query(`CREATE DATABASE "${process.env.NODE_COMPATIBILITY_DATABASE_NAME}"`);',
    "  } finally {",
    "    await client.end();",
    "  }",
    "})().catch((error) => {",
    '  console.error(error && typeof error.code === "string" ? error.code : "DATABASE_CREATE_FAILED");',
    "  process.exitCode = 1;",
    "});",
  ].join(" ");
  const dbEnvironment = {
    ...env,
    NODE_COMPATIBILITY_DATABASE_NAME: databaseName,
  };
  return runMeasuredCheck({
    id: "database-create",
    displayCommand: "pnpm --filter @workspace/api-server exec node -e <create disposable test database>",
    command: pnpmBinary,
    args: ["--filter", "@workspace/api-server", "exec", "node", "-e", setupCode],
    cwd: workspace,
    env: dbEnvironment,
    timeoutMs: CHECK_TIMEOUT_MS.databaseCreate,
    logDirectory,
  });
}

async function runRuntime(runtime, environment, tempRoot, baseEnvironment) {
  const binary = environment[runtime.key === "node24" ? "NODE24_BIN" : "NODE26_BIN"];
  const version = await probeVersion(binary, ["--version"], baseEnvironment);
  if (version !== runtime.expectedVersion) {
    throw new Error(`${runtime.label} resolved to ${version}; expected ${runtime.expectedVersion}.`);
  }
  const packageManagerVersion = await probeVersion(
    environment.PNPM_BIN,
    ["--version"],
    { ...baseEnvironment, PATH: `${path.dirname(binary)}${path.delimiter}${baseEnvironment.PATH}` },
  );
  if (packageManagerVersion !== EXPECTED_PACKAGE_MANAGER) {
    throw new Error(`pnpm resolved to ${packageManagerVersion}; expected ${EXPECTED_PACKAGE_MANAGER}.`);
  }

  const workspace = path.join(tempRoot, `${runtime.key}-workspace`);
  const store = path.join(tempRoot, `${runtime.key}-pnpm-store`);
  const logDirectory = path.join(tempRoot, `${runtime.key}-logs`);
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const worktree = spawnSync("git", ["worktree", "add", "--detach", workspace, environment.GITHUB_SHA], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    env: cleanWorktreeEnvironment(environment),
    timeout: 30_000,
  });
  if (worktree.status !== 0) throw new Error(`Unable to prepare the ${runtime.label} clean worktree.`);

  const dbName = `node_compatibility_${runtime.key}`;
  const runtimeRecord = {
    label: runtime.label,
    nodeVersion: version.slice(1),
    packageManagerVersion,
    checks: [],
  };
  const env = createRuntimeEnvironment(
    {
      ...baseEnvironment,
      PATH: `${path.dirname(binary)}${path.delimiter}${baseEnvironment.PATH ?? ""}`,
    },
    { ...runtime, binary },
    workspace,
    dbName,
  );
  const run = async (check) => {
    const evidence = await runMeasuredCheck({
      ...check,
      cwd: workspace,
      env: check.env ? { ...env, ...check.env } : env,
      logDirectory,
    });
    runtimeRecord.checks.push(evidence);
    return evidence;
  };

  try {
    const install = await run({
      id: "install",
      displayCommand: "pnpm install --frozen-lockfile --store-dir <isolated-temp-store>",
      command: environment.PNPM_BIN,
      args: ["install", "--frozen-lockfile", "--store-dir", store],
      timeoutMs: CHECK_TIMEOUT_MS.install,
    });
    if (install.outcome !== "PASS") {
      runtimeRecord.checks.push(
        ...[
          ["typecheck", "pnpm run typecheck"],
          ["run-calculator-budget", "pnpm --filter @workspace/run-calculator run test:budget"],
          ["database-create", "create isolated PostgreSQL database"],
          ["database-schema", "pnpm --filter @workspace/db run push-force"],
          ["api-integration-shard-1", "pnpm --filter @workspace/api-server run test:release:integration:1"],
          ["production-build", "pnpm run build"],
        ].map(([id, command]) => skippedCheck(id, command, "frozen install did not pass")),
      );
      return runtimeRecord;
    }

    await run({
      id: "typecheck",
      displayCommand: "pnpm run typecheck",
      command: environment.PNPM_BIN,
      args: ["run", "typecheck"],
      timeoutMs: CHECK_TIMEOUT_MS.typecheck,
    });
    await run({
      id: "run-calculator-budget",
      displayCommand: "pnpm --filter @workspace/run-calculator run test:budget",
      command: environment.PNPM_BIN,
      args: ["--filter", "@workspace/run-calculator", "run", "test:budget"],
      timeoutMs: CHECK_TIMEOUT_MS.unitTests,
    });
    const database = await addDisposableDatabase(
      runtime,
      environment.PNPM_BIN,
      env,
      workspace,
      logDirectory,
    );
    runtimeRecord.checks.push(database);
    if (database.outcome !== "PASS") {
      runtimeRecord.checks.push(
        skippedCheck("database-schema", "pnpm --filter @workspace/db run push-force", "database creation did not pass"),
        skippedCheck("api-integration-shard-1", "pnpm --filter @workspace/api-server run test:release:integration:1", "database creation did not pass"),
      );
    } else {
      const schema = await run({
        id: "database-schema",
        displayCommand: "pnpm --filter @workspace/db run push-force",
        command: environment.PNPM_BIN,
        args: ["--filter", "@workspace/db", "run", "push-force"],
        timeoutMs: CHECK_TIMEOUT_MS.databaseSchema,
      });
      if (schema.outcome === "PASS") {
        await run({
          id: "api-integration-shard-1",
          displayCommand: "pnpm --filter @workspace/api-server run test:release:integration:1",
          command: environment.PNPM_BIN,
          args: ["--filter", "@workspace/api-server", "run", "test:release:integration:1"],
          timeoutMs: CHECK_TIMEOUT_MS.apiIntegration,
        });
      } else {
        runtimeRecord.checks.push(
          skippedCheck("api-integration-shard-1", "pnpm --filter @workspace/api-server run test:release:integration:1", "database schema check did not pass"),
        );
      }
    }
    // The root build includes package builds and build-identity finalization.
    // Typechecking is measured separately above, so the duplicate typecheck
    // phase inside the root build is intentionally retained for fidelity.
    await run({
      id: "production-build",
      displayCommand: "pnpm run build",
      command: environment.PNPM_BIN,
      args: ["run", "build"],
      timeoutMs: CHECK_TIMEOUT_MS.productionBuild,
      env: {
        ...env,
        NODE_ENV: "production",
        PORT: "3000",
        BASE_PATH: "/",
        VITE_APP_VERSION: `node-advisory-${environment.GITHUB_SHA.slice(0, 12)}`,
      },
    });
    return runtimeRecord;
  } finally {
    rmSync(logDirectory, { recursive: true, force: true });
    const removed = spawnSync("git", ["worktree", "remove", "--force", workspace], {
      cwd: ROOT,
      stdio: "ignore",
      timeout: 30_000,
    });
    if (removed.status !== 0) {
      throw new Error(`Unable to remove the disposable ${runtime.label} worktree.`);
    }
  }
}

function skippedCheck(id, command, reason) {
  return {
    id,
    command,
    outcome: "SKIPPED",
    exitCode: null,
    timedOut: false,
    elapsedMs: null,
    peakRssKiB: null,
    failureCode: null,
    skipReason: reason,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Node 24 vs. Node 26 advisory comparison",
    "",
    `- Result: **${report.status}** (advisory only; not release evidence)`,
    `- Captured: ${report.capturedAt}`,
    `- Workflow run: ${report.workflow.runId} (attempt ${report.workflow.runAttempt})`,
    `- Source revision: \`${report.sourceRevision}\``,
    `- Lockfile SHA-256: \`${report.lockfileSha256}\``,
    `- Runner: ${report.runner.label} (${report.runner.os}, ${report.runner.arch})`,
    `- Node: ${report.runtimes.map((runtime) => `${runtime.nodeVersion} (${runtime.label})`).join(" vs. ")}`,
    `- pnpm: ${report.packageManager.version}`,
    "",
    "| Runtime | Check | Outcome | Exit | Elapsed | Peak RSS |",
    "|---|---|---:|---:|---:|---:|",
  ];
  for (const runtime of report.runtimes) {
    for (const check of runtime.checks) {
      const elapsed = check.elapsedMs === null ? "—" : `${check.elapsedMs} ms`;
      const memory = check.peakRssKiB === null ? "—" : `${check.peakRssKiB} KiB`;
      const exit = check.exitCode === null ? "—" : String(check.exitCode);
      lines.push(`| Node ${runtime.nodeVersion} | ${check.id} | ${check.outcome} | ${exit} | ${elapsed} | ${memory} |`);
    }
  }
  lines.push(
    "",
    "| Check | Node 24 outcome | Node 26 outcome | Elapsed delta (26−24) | Peak RSS delta (26−24) |",
    "|---|---:|---:|---:|---:|",
  );
  for (const comparison of report.comparison) {
    const elapsed =
      comparison.elapsedDeltaMs === null ? "—" : `${comparison.elapsedDeltaMs} ms`;
    const memory =
      comparison.peakRssDeltaKiB === null ? "—" : `${comparison.peakRssDeltaKiB} KiB`;
    lines.push(
      `| ${comparison.id} | ${comparison.baselineOutcome} | ${comparison.candidateOutcome} | ${elapsed} | ${memory} |`,
    );
  }
  lines.push(
    "",
    "GNU `time` reported maximum resident set size for each top-level check command. " +
      "It is a comparative process metric, not a cgroup-wide peak-memory measurement. " +
      "Command output was kept in temporary runner files and deleted; no test payloads or " +
      "database records are included in this report.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function appendGitHubSummary(report, markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: "a", mode: 0o600 });
  }
  const nonPassing = report.runtimes.flatMap((runtime) =>
    runtime.checks
      .filter((check) => check.outcome !== "PASS")
      .map((check) => `${runtime.nodeVersion}:${check.id}:${check.outcome}`),
  );
  if (nonPassing.length > 0) {
    console.log(
      `::warning::Advisory-only checks were non-passing: ${nonPassing.join(", ")}. ` +
        "The Node 24 release baseline and its required checks are unchanged.",
    );
  }
}

async function main(environment = process.env) {
  const { outputDir } = validateInputs(environment);
  const [node24Binary, node26Binary] = await Promise.all([
    probeVersion(environment.NODE24_BIN, ["--version"], environment),
    probeVersion(environment.NODE26_BIN, ["--version"], environment),
  ]);
  const pnpmVersion = await probeVersion(environment.PNPM_BIN, ["--version"], {
    ...environment,
    PATH: `${path.dirname(environment.NODE24_BIN)}${path.delimiter}${environment.PATH ?? ""}`,
  });
  if (node24Binary !== RUNTIMES[0].expectedVersion || node26Binary !== RUNTIMES[1].expectedVersion) {
    throw new Error("The runtime binaries do not match the approved exact comparison versions.");
  }
  if (pnpmVersion !== EXPECTED_PACKAGE_MANAGER) {
    throw new Error("The pnpm binary does not match the repository-pinned package manager.");
  }

  const lockfileSha256 = createHash("sha256")
    .update(readFileSync(path.join(ROOT, "pnpm-lock.yaml")))
    .digest("hex");
  const tempRoot = mkdtempSync(path.join(environment.RUNNER_TEMP, "node-compatibility-advisory-"));
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const baseEnvironment = {
    ...environment,
    PNPM_BIN: environment.PNPM_BIN,
  };
  let runtimes;
  try {
    runtimes = [];
    for (const runtime of RUNTIMES) {
      runtimes.push(await runRuntime(runtime, environment, tempRoot, baseEnvironment));
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const report = {
    schemaVersion: 1,
    advisoryOnly: true,
    authoritativeReleaseEvidence: false,
    capturedAt: new Date().toISOString(),
    workflow: {
      name: environment.GITHUB_WORKFLOW ?? "Node Compatibility Advisory",
      runId: environment.GITHUB_RUN_ID,
      runAttempt: environment.GITHUB_RUN_ATTEMPT,
    },
    sourceRevision: environment.GITHUB_SHA,
    lockfileSha256,
    runner: {
      label: environment.NODE_COMPATIBILITY_RUNNER_LABEL ?? "hosted runner (label unavailable)",
      os: `${os.type()} ${os.release()}`,
      arch: process.arch,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      measurement: "GNU /usr/bin/time maximum resident set size for the top-level command",
    },
    packageManager: {
      name: "pnpm",
      version: pnpmVersion,
    },
    comparisonMode: "sequential; two clean git worktrees; isolated pnpm stores; one hosted runner",
    runtimes,
    comparison: compareCheckMeasurements(runtimes[0].checks, runtimes[1].checks),
  };
  report.status = runtimes.every((runtime) =>
    runtime.checks.every((check) => check.outcome === "PASS"),
  )
    ? "PASS"
    : "ADVISORY_FAILURE";

  const jsonPath = path.join(outputDir, "comparison.json");
  const markdownPath = path.join(outputDir, "comparison.md");
  const markdown = renderMarkdown(report);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(markdownPath, markdown, { mode: 0o600 });
  appendGitHubSummary(report, markdown);
  console.log(`Advisory evidence written outside the repository: ${path.basename(jsonPath)}, ${path.basename(markdownPath)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Node advisory comparison failed.");
    process.exitCode = 1;
  });
}
