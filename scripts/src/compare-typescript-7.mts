import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diagnosticsEqualForPairs,
  releaseRevisionGitArgs,
} from "./typescript-7-evidence.mts";

type CommandEvidence = {
  name: string;
  exitCode: number;
  elapsedMs: number;
  peakRssKiB: number | null;
  diagnostics: string[];
};

const comparedChecks = [
  "build",
  "scripts",
  "api-server",
  "run-calculator",
  "mockup-sandbox",
  "ai-evaluation",
  "corpus-harness",
] as const;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const supportedRunners = [{ platform: "linux", arch: "x64" }] as const;

export function normalizeDiagnostics(
  output: string,
  checkout: string,
): string[] {
  const normalizedRoot = `${checkout.replaceAll("\\", "/")}/`;
  return output
    .replaceAll("\\", "/")
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll(normalizedRoot, ""))
    .filter((line) => /\berror TS\d+:/.test(line))
    .sort();
}

async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function declarationManifest(checkout: string) {
  const lib = resolve(checkout, "lib");
  const files = (await filesUnder(lib))
    .filter((path) => path.endsWith(".d.ts") && path.includes("/dist/"))
    .sort();
  return Promise.all(
    files.map(async (path) => ({
      path: relative(checkout, path).replaceAll("\\", "/"),
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
}

async function processTreeRssKiB(rootPid: number): Promise<number | null> {
  try {
    const procEntries = (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry));
    const processes = await Promise.all(
      procEntries.map(async (entry) => {
        try {
          const status = await readFile(`/proc/${entry}/status`, "utf8");
          return {
            pid: Number(entry),
            parent: Number(status.match(/^PPid:\s+(\d+)/m)?.[1]),
            rss: Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]),
          };
        } catch {
          return undefined;
        }
      }),
    );
    const descendants = new Set([rootPid]);
    let added = true;
    while (added) {
      added = false;
      for (const process of processes) {
        if (
          process &&
          descendants.has(process.parent) &&
          !descendants.has(process.pid)
        ) {
          descendants.add(process.pid);
          added = true;
        }
      }
    }
    return processes.reduce(
      (total, process) =>
        process && descendants.has(process.pid) && Number.isFinite(process.rss)
          ? total + process.rss
          : total,
      0,
    );
  } catch {
    return null;
  }
}

async function run(
  name: string,
  command: string,
  args: string[],
  checkout: string,
): Promise<CommandEvidence> {
  const started = performance.now();
  const child = spawn(command, args, {
    cwd: checkout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  let peakRssKiB: number | null = null;
  const sample = async () => {
    const rss = await processTreeRssKiB(child.pid ?? -1);
    if (rss !== null) peakRssKiB = Math.max(peakRssKiB ?? 0, rss);
  };
  await sample();
  const sampler = setInterval(() => void sample(), 20);
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
  clearInterval(sampler);
  await sample();
  const elapsedMs = Math.round(performance.now() - started);
  const output = `${Buffer.concat(stdout).toString("utf8")}\n${Buffer.concat(stderr).toString("utf8")}`;
  return {
    name,
    exitCode,
    elapsedMs,
    peakRssKiB,
    diagnostics: normalizeDiagnostics(output, checkout),
  };
}

async function gitStatus(): Promise<string> {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

function sourceRevision(): string {
  const result = spawnSync("git", releaseRevisionGitArgs, {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function main(): Promise<void> {
  const evidencePath = resolve(
    process.env.TYPESCRIPT_7_EVIDENCE_PATH ??
      resolve(rootDir, "release-evidence/typescript-7-comparison.json"),
  );
  const beforeStatus = await gitStatus();
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "typescript-7-release-"));
  const checkout = resolve(temporaryRoot, "repository");
  const commands: CommandEvidence[] = [];
  let report: Record<string, unknown>;

  try {
    await mkdir(checkout);
    for (const name of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "tsconfig.base.json",
      "lib",
      "artifacts",
      "scripts",
    ]) {
      await cp(resolve(rootDir, name), resolve(checkout, name), {
        recursive: true,
        filter: (source) =>
          !source.includes("/node_modules") &&
          !source.includes("/dist") &&
          !source.includes("/test-results") &&
          !source.includes("/playwright-report"),
      });
    }
    const frozenInstall = await run(
      "frozen-install",
      "pnpm",
      ["install", "--frozen-lockfile", "--ignore-scripts"],
      checkout,
    );
    commands.push(frozenInstall);
    if (frozenInstall.exitCode !== 0) {
      throw new Error("Disposable frozen pnpm install failed.");
    }

    const ts6 = resolve(checkout, "node_modules/typescript/bin/tsc");
    const ts7 = resolve(checkout, "node_modules/typescript-native/bin/tsc");
    const version = (compiler: string) =>
      spawnSync(process.execPath, [compiler, "--version"], {
        cwd: checkout,
        encoding: "utf8",
      }).stdout.trim();
    const platformSupported = supportedRunners.some(
      (runner) =>
        runner.platform === process.platform && runner.arch === process.arch,
    );

    const buildArgs = ["--build", "--force", "--pretty", "false"];
    commands.push(await run("typescript-6-build", process.execPath, [ts6, ...buildArgs], checkout));
    const baselineDeclarations = await declarationManifest(checkout);
    const clean = await run(
      "typescript-6-clean",
      process.execPath,
      [ts6, "--build", "--clean"],
      checkout,
    );
    commands.push(clean);
    if (clean.exitCode !== 0 || (await declarationManifest(checkout)).length !== 0) {
      throw new Error(
        "TypeScript 6 clean did not remove disposable declaration outputs.",
      );
    }
    commands.push(await run("typescript-7-build", process.execPath, [ts7, ...buildArgs], checkout));
    const candidateDeclarations = await declarationManifest(checkout);

    const projects = [
      ["scripts", "scripts/tsconfig.json"],
      ["api-server", "artifacts/api-server/tsconfig.json"],
      ["run-calculator", "artifacts/run-calculator/tsconfig.json"],
      ["mockup-sandbox", "artifacts/mockup-sandbox/tsconfig.json"],
      ["ai-evaluation", "lib/ai-evaluation/tsconfig.json"],
      ["corpus-harness", "lib/corpus-harness/tsconfig.json"],
    ] as const;
    for (const [name, project] of projects) {
      commands.push(
        await run(`typescript-6-${name}`, process.execPath, [ts6, "-p", project, "--noEmit", "--pretty", "false"], checkout),
        await run(`typescript-7-${name}`, process.execPath, [ts7, "-p", project, "--noEmit", "--pretty", "false"], checkout),
      );
    }

    const baselineByPath = new Map(
      baselineDeclarations.map((entry) => [entry.path, entry.sha256]),
    );
    const candidateByPath = new Map(
      candidateDeclarations.map((entry) => [entry.path, entry.sha256]),
    );
    const declarationPaths = [...new Set([
      ...baselineByPath.keys(),
      ...candidateByPath.keys(),
    ])].sort();
    const changedDeclarations = declarationPaths.filter(
      (path) => baselineByPath.get(path) !== candidateByPath.get(path),
    );
    const diagnosticsEqual = diagnosticsEqualForPairs(
      commands,
      comparedChecks,
    );
    const performanceComparison = comparedChecks.map((check) => {
      const baseline = commands.find(
        (command) => command.name === `typescript-6-${check}`,
      );
      const candidate = commands.find(
        (command) => command.name === `typescript-7-${check}`,
      );
      if (!baseline || !candidate) {
        throw new Error(`Missing TypeScript 6/7 measurement pair for ${check}.`);
      }
      return {
        check,
        elapsedMs: {
          baseline: baseline.elapsedMs,
          candidate: candidate.elapsedMs,
          delta: candidate.elapsedMs - baseline.elapsedMs,
          ratio:
            baseline.elapsedMs === 0
              ? null
              : candidate.elapsedMs / baseline.elapsedMs,
        },
        peakRssKiB: {
          baseline: baseline.peakRssKiB,
          candidate: candidate.peakRssKiB,
          delta:
            baseline.peakRssKiB === null || candidate.peakRssKiB === null
              ? null
              : candidate.peakRssKiB - baseline.peakRssKiB,
          ratio:
            baseline.peakRssKiB === null ||
            candidate.peakRssKiB === null ||
            baseline.peakRssKiB === 0
              ? null
              : candidate.peakRssKiB / baseline.peakRssKiB,
        },
      };
    });
    const advisoryPassed =
      platformSupported &&
      commands.every((command) => command.exitCode === 0) &&
      commands.every(
        (command) =>
          command.peakRssKiB !== null && command.peakRssKiB > 0,
      ) &&
      diagnosticsEqual &&
      changedDeclarations.length === 0;

    report = {
      schemaVersion: 1,
      sourceRevision: sourceRevision(),
      status: advisoryPassed ? "PASS" : "ADVISORY_DRIFT",
      authoritativeCompiler: version(ts6),
      candidateCompiler: version(ts7),
      runner: {
        platform: process.platform,
        arch: process.arch,
        supported: platformSupported,
        supportedRunners,
      },
      commands,
      performanceComparison,
      diagnosticsEqual,
      declarations: {
        baseline: baselineDeclarations,
        candidate: candidateDeclarations,
        changedPaths: changedDeclarations,
      },
      acceptanceGatesMet: advisoryPassed,
      advisory: true,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const afterStatus = await gitStatus();
  const authoritativeOutputsChanged = afterStatus !== beforeStatus;
  if (authoritativeOutputsChanged) {
    throw new Error(
      "TypeScript 7 comparison changed the authoritative working tree.",
    );
  }
  report = {
    ...report,
    authoritativeOutputsChanged,
    containment: {
      beforeStatusSha256: createHash("sha256").update(beforeStatus).digest("hex"),
      afterStatusSha256: createHash("sha256").update(afterStatus).digest("hex"),
    },
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `${report.status} TypeScript 7 comparison retained at ${relative(rootDir, evidencePath)} (advisory only).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();