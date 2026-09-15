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
import { cpus, totalmem, tmpdir } from "node:os";
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

type EditorServiceEvidence = {
  command: "pnpm run check:editor-typescript";
  sdkPath: string | null;
  sdkVersion: string | null;
  outcome: "PASS" | "FAIL";
  exitCode: number;
};

export const TYPESCRIPT_7_RESOURCE_BUDGETS = {
  maxElapsedRatio: 1.25,
  maxPeakRssRatio: 1.25,
  maxCandidateElapsedMs: 60_000,
  maxCandidatePeakRssKiB: 1_048_576,
  minimumRevisions: 3,
  requiredModes: ["cold", "warm"] as const,
  approvedForPromotion: true,
} as const;
export const TYPESCRIPT_7_HISTORY_LIMIT = 5;

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
const promotionAttempt = process.env.TYPESCRIPT_7_PROMOTION === "1";

export function editorServiceEvidenceFromResult(result: {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}): EditorServiceEvidence {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return {
    command: "pnpm run check:editor-typescript",
    sdkPath:
      output.match(/workspace service process\(es\).*?SDK\s+([^,\s]+)/)?.[0]
        ? "node_modules/typescript/lib"
        : null,
    sdkVersion:
      output.match(/workspace service process\(es\), SDK\s+([^,\s]+)/)?.[1] ??
      null,
    outcome: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status ?? 1,
  };
}

export type Typescript7RunnerFingerprint = {
  image: string;
  hardwareClass: string;
  logicalCpuCount: number;
  memoryGiB: number;
};

function boundedRunnerLabel(value: string | undefined): string {
  const normalized = value?.trim().replace(/[^A-Za-z0-9._@+-]/g, "-").slice(0, 80);
  return normalized || "unknown";
}

export function typescript7RunnerFingerprint(): Typescript7RunnerFingerprint {
  const processors = cpus();
  const logicalCpuCount = processors.length;
  const memoryGiB = Math.max(1, Math.round(totalmem() / 1024 ** 3));
  const cpuModel = processors[0]?.model.trim().replace(/\s+/g, " ") ?? "unknown";
  const image = boundedRunnerLabel(
    process.env.ImageOS && process.env.ImageVersion
      ? `${process.env.ImageOS}@${process.env.ImageVersion}`
      : process.env.TYPESCRIPT_7_RUNNER_IMAGE ?? process.env.ImageOS,
  );
  const hardwareClass = createHash("sha256")
    .update(
      JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        cpuModel,
        logicalCpuCount,
        memoryGiB,
      }),
    )
    .digest("hex");
  return { image, hardwareClass, logicalCpuCount, memoryGiB };
}

export function typescript7ResourceRegressions(
  value: unknown,
): string[] | null {
  if (!Array.isArray(value) || value.length !== 14) return null;
  const expected = new Set(
    TYPESCRIPT_7_RESOURCE_BUDGETS.requiredModes.flatMap((mode) =>
      comparedChecks.map((check) => `${mode}:${check}`),
    ),
  );
  const failures: string[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const item = entry as Record<string, unknown>;
    const key = `${item.mode}:${item.check}`;
    const elapsed = item.elapsedMs as Record<string, unknown> | undefined;
    const memory = item.peakRssKiB as Record<string, unknown> | undefined;
    if (
      !expected.delete(key) ||
      typeof elapsed?.candidate !== "number" ||
      typeof elapsed.ratio !== "number" ||
      typeof memory?.candidate !== "number" ||
      typeof memory.ratio !== "number"
    ) {
      return null;
    }
    if (
      elapsed.ratio > TYPESCRIPT_7_RESOURCE_BUDGETS.maxElapsedRatio ||
      elapsed.candidate > TYPESCRIPT_7_RESOURCE_BUDGETS.maxCandidateElapsedMs
    ) {
      failures.push(`${key}:elapsed`);
    }
    if (
      memory.ratio > TYPESCRIPT_7_RESOURCE_BUDGETS.maxPeakRssRatio ||
      memory.candidate >
        TYPESCRIPT_7_RESOURCE_BUDGETS.maxCandidatePeakRssKiB
    ) {
      failures.push(`${key}:peak-rss`);
    }
  }
  return expected.size === 0 ? failures : null;
}

export function selectTypescript7HistoricalReports(
  history: readonly unknown[],
  currentRevision: string,
  currentHardwareClass: string,
): Array<Record<string, unknown>> {
  return analyzeTypescript7HistoricalReports(
    history,
    currentRevision,
    currentHardwareClass,
  ).reports;
}

export function analyzeTypescript7HistoricalReports(
  history: readonly unknown[],
  currentRevision: string,
  currentHardwareClass: string,
): {
  reports: Array<Record<string, unknown>>;
  incompatibleRunnerClassSamples: number;
} {
  const revisions = new Set([currentRevision]);
  const reports: Array<Record<string, unknown>> = [];
  let incompatibleRunnerClassSamples = 0;
  for (const item of history) {
    if (
      item === null ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      (item as Record<string, unknown>).schemaVersion !== 3
    ) {
      continue;
    }
    const report = item as Record<string, unknown>;
    const runner = report.runner as Record<string, unknown> | undefined;
    const revision = report.sourceRevision;
    if (
      typeof revision !== "string" ||
      !/^[a-f0-9]{40}$/.test(revision) ||
      revisions.has(revision) ||
      typescript7ResourceRegressions(report.performanceComparison) === null
    ) {
      continue;
    }
    if (runner?.hardwareClass !== currentHardwareClass) {
      incompatibleRunnerClassSamples = Math.min(
        TYPESCRIPT_7_HISTORY_LIMIT,
        incompatibleRunnerClassSamples + 1,
      );
      continue;
    }
    revisions.add(revision);
    reports.push(report);
    if (reports.length >= TYPESCRIPT_7_HISTORY_LIMIT) break;
  }
  return { reports, incompatibleRunnerClassSamples };
}

export function typescript7TrendHistorySummary(
  distinctRevisionCount: number,
  incompatibleRunnerClassSamples: number,
): string {
  const priorRevisionCount = distinctRevisionCount - 1;
  if (priorRevisionCount === 0 && incompatibleRunnerClassSamples > 0) {
    return `TypeScript 7 trend history reset for this runner class: ${incompatibleRunnerClassSamples} incompatible prior sample(s) excluded (count capped at ${TYPESCRIPT_7_HISTORY_LIMIT}).`;
  }
  if (priorRevisionCount === 0) {
    return "TypeScript 7 trend history is missing: no valid prior samples were available.";
  }
  return `TypeScript 7 trend history includes ${priorRevisionCount} compatible prior revision(s); ${incompatibleRunnerClassSamples} incompatible runner-class sample(s) excluded (count capped at ${TYPESCRIPT_7_HISTORY_LIMIT}).`;
}

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
  let editorService: EditorServiceEvidence | null = null;

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
    commands.push(await run("typescript-6-build-cold", process.execPath, [ts6, ...buildArgs], checkout));
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
    commands.push(await run("typescript-7-build-cold", process.execPath, [ts7, ...buildArgs], checkout));
    const candidateDeclarations = await declarationManifest(checkout);

    const projects = [
      ["scripts", "scripts/tsconfig.json"],
      ["api-server", "artifacts/api-server/tsconfig.json"],
      ["run-calculator", "artifacts/run-calculator/tsconfig.json"],
      ["mockup-sandbox", "artifacts/mockup-sandbox/tsconfig.json"],
      ["ai-evaluation", "lib/ai-evaluation/tsconfig.json"],
      ["corpus-harness", "lib/corpus-harness/tsconfig.json"],
    ] as const;
    for (const mode of TYPESCRIPT_7_RESOURCE_BUDGETS.requiredModes) {
      if (mode === "warm") {
        commands.push(
          await run("typescript-6-build-warm", process.execPath, [ts6, ...buildArgs], checkout),
          await run("typescript-7-build-warm", process.execPath, [ts7, ...buildArgs], checkout),
        );
      }
      for (const [name, project] of projects) {
        commands.push(
          await run(`typescript-6-${name}-${mode}`, process.execPath, [ts6, "-p", project, "--noEmit", "--pretty", "false"], checkout),
          await run(`typescript-7-${name}-${mode}`, process.execPath, [ts7, "-p", project, "--noEmit", "--pretty", "false"], checkout),
        );
      }
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
    const diagnosticsEqual = TYPESCRIPT_7_RESOURCE_BUDGETS.requiredModes.every(
      (mode) =>
        diagnosticsEqualForPairs(
          commands.map((command) => ({
            ...command,
            name: command.name.replace(`-${mode}`, ""),
          })),
          comparedChecks,
        ),
    );
    const performanceComparison = TYPESCRIPT_7_RESOURCE_BUDGETS.requiredModes.flatMap((mode) => comparedChecks.map((check) => {
      const baseline = commands.find(
        (command) => command.name === `typescript-6-${check}-${mode}`,
      );
      const candidate = commands.find(
        (command) => command.name === `typescript-7-${check}-${mode}`,
      );
      if (!baseline || !candidate) {
        throw new Error(`Missing TypeScript 6/7 measurement pair for ${check}.`);
      }
      return {
        check,
        mode,
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
    }));
    const resourceRegressions =
      typescript7ResourceRegressions(performanceComparison) ??
      ["current:malformed-resource-measurements"];
    const historyPath = process.env.TYPESCRIPT_7_HISTORY_JSON;
    const runnerFingerprint = typescript7RunnerFingerprint();
    let historicalReports: unknown[] = [];
    if (historyPath) {
      try {
        const parsed: unknown = JSON.parse(await readFile(historyPath, "utf8"));
        if (Array.isArray(parsed)) historicalReports = parsed;
      } catch (error) {
        console.warn(`Ignoring unreadable TypeScript 7 history: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const historyAnalysis = analyzeTypescript7HistoricalReports(
      historicalReports,
      sourceRevision(),
      runnerFingerprint.hardwareClass,
    );
    const historicalRevisions = historyAnalysis.reports;
    const revisionSamples = [
      ...historicalRevisions.map((item) => ({
        sourceRevision: item.sourceRevision,
        performanceComparison: item.performanceComparison,
      })),
      {
        sourceRevision: sourceRevision(),
        performanceComparison,
      },
    ];
    const distinctRevisionCount = new Set(
      revisionSamples.map((sample) => sample.sourceRevision),
    ).size;
    const regressedRevisions = [
      ...historicalRevisions
        .filter(
          (item) =>
            (typescript7ResourceRegressions(item.performanceComparison)?.length ??
              0) > 0,
        )
        .map((item) => item.sourceRevision as string),
      ...(resourceRegressions.length > 0 ? [sourceRevision()] : []),
    ];
    const repeatedEvidenceMet =
      distinctRevisionCount >= TYPESCRIPT_7_RESOURCE_BUDGETS.minimumRevisions;
    const resourceBudgetsMet = regressedRevisions.length === 0;
    const advisoryPassed =
      platformSupported &&
      commands.every((command) => command.exitCode === 0) &&
      commands.every(
        (command) =>
          command.peakRssKiB !== null && command.peakRssKiB > 0,
      ) &&
      diagnosticsEqual &&
      changedDeclarations.length === 0;
    const promotionAssessment = {
      eligible:
        TYPESCRIPT_7_RESOURCE_BUDGETS.approvedForPromotion &&
        repeatedEvidenceMet &&
        resourceBudgetsMet &&
        advisoryPassed,
      thresholdApprovalRequired:
        !TYPESCRIPT_7_RESOURCE_BUDGETS.approvedForPromotion,
      repeatedEvidenceMet,
      resourceBudgetsMet,
      resourceRegressions,
    };

    if (promotionAttempt) {
      const editorResult = spawnSync("pnpm", ["run", "check:editor-typescript"], {
        cwd: rootDir,
        encoding: "utf8",
      });
      editorService = editorServiceEvidenceFromResult(editorResult);
      if (editorResult.stdout) process.stdout.write(editorResult.stdout);
      if (editorResult.stderr) process.stderr.write(editorResult.stderr);
    }
    const promotionGatesMet =
      !promotionAttempt ||
      (editorService?.outcome === "PASS" &&
        promotionAssessment.eligible === true);

    report = {
      schemaVersion: 3,
      sourceRevision: sourceRevision(),
      status:
        advisoryPassed && promotionGatesMet
          ? "PASS"
          : promotionAttempt
            ? "PROMOTION_BLOCKED"
            : "ADVISORY_DRIFT",
      authoritativeCompiler: version(ts6),
      candidateCompiler: version(ts7),
      runner: {
        platform: process.platform,
        arch: process.arch,
        supported: platformSupported,
        supportedRunners,
        ...runnerFingerprint,
      },
      commands,
      performanceComparison,
      resourceBudgets: TYPESCRIPT_7_RESOURCE_BUDGETS,
      trend: {
        historyLimit: TYPESCRIPT_7_HISTORY_LIMIT,
        incompatibleRunnerClassSamples:
          historyAnalysis.incompatibleRunnerClassSamples,
        distinctRevisionCount,
        regressedRevisions,
        revisionSamples,
      },
      promotionAssessment,
      promotionAttempt,
      editorService,
      diagnosticsEqual,
      declarations: {
        baseline: baselineDeclarations,
        candidate: candidateDeclarations,
        changedPaths: changedDeclarations,
      },
      acceptanceGatesMet: advisoryPassed && promotionGatesMet,
      advisory: !promotionAttempt,
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
  const retainedEvidenceCheck = spawnSync(
    "bash",
    [
      resolve(rootDir, "docs/evidence/reproduce-typescript-7-comparison.sh"),
      "--check-retained-summary",
      evidencePath,
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
    },
  );
  if (retainedEvidenceCheck.status !== 0) {
    throw new Error(
      "TypeScript 7 retained migration evidence check failed.\n" +
        retainedEvidenceCheck.stderr.trim(),
    );
  }
  console.log(
    `${report.status} TypeScript 7 comparison retained at ${relative(rootDir, evidencePath)} (${promotionAttempt ? "promotion attempt" : "advisory only"}).`,
  );
  const trend = report.trend as Record<string, unknown>;
  console.log(
    typescript7TrendHistorySummary(
      Number(trend.distinctRevisionCount),
      Number(trend.incompatibleRunnerClassSamples),
    ),
  );
  if (
    promotionAttempt &&
    (report.acceptanceGatesMet !== true ||
      (report.editorService as EditorServiceEvidence | null)?.outcome !== "PASS")
  ) {
    throw new Error(
      "TypeScript 7 promotion blocked: editor TypeScript service proof or compiler acceptance gate failed.",
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();