import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  API_SHARD_TIMEOUT_MS,
  RELEASE_CHECK_API_CONCURRENCY,
  RELEASE_CHECK_API_SHARD_STEPS,
  runStep,
  type ReleaseStep,
  type StepStatus,
} from "./release-check.mts";

const rootDir = resolve(new URL("../../", import.meta.url).pathname);
const DEFAULT_TIMEOUT_FAILURE_RE =
  /(?:timed?\s*out|timeout|exceeded .* timeout|INFRASTRUCTURE TIMEOUT)/i;
const LOCK_FAILURE_RE =
  /(?:deadlock|lock timeout|could not obtain lock|duplicate[- ]marker|duplicate key|too many clients|remaining connection slots|connection pool exhausted)/i;

export type StressShardResult = {
  label: string;
  status: StepStatus;
  elapsedMs: number;
  timeoutFailure: boolean;
  lockFailure: boolean;
};

export type ConcurrencyStressReport = {
  schemaVersion: 1;
  documentedConcurrencyCap: number;
  shardCount: number;
  setupElapsedMs: number;
  setupStatus: StepStatus;
  allShardsStarted: boolean;
  peakActiveShards: number;
  timeoutFailures: number;
  lockFailures: number;
  totalElapsedMs: number;
  safe: boolean;
  unsafeReasons: string[];
  shards: StressShardResult[];
};

export type StressRunStep = (
  step: ReleaseStep,
  options?: {
    logPath?: string;
    onOutput?: (text: string) => void;
  },
) => Promise<{
  exitCode: number;
  elapsedMs: number;
  status: StepStatus;
  output?: string;
}>;

export function classifyStressFailure(
  status: StepStatus,
  output = "",
): Pick<StressShardResult, "timeoutFailure" | "lockFailure"> {
  const failed = status !== "PASS";
  return {
    timeoutFailure:
      status === "INFRASTRUCTURE TIMEOUT" ||
      (failed && DEFAULT_TIMEOUT_FAILURE_RE.test(output)),
    lockFailure: failed && LOCK_FAILURE_RE.test(output),
  };
}

export function formatConcurrencyStressMarkdown(
  report: ConcurrencyStressReport,
  outputDirectory: string,
): string {
  const status = report.safe ? "PASS" : "FAIL — concurrency cap unsafe";
  const reasons =
    report.unsafeReasons.length === 0
      ? "none"
      : report.unsafeReasons.map((reason) => `- ${reason}`).join("\n");
  return [
    "# API concurrency stress report",
    "",
    `Result: ${status}`,
    "Environment: disposable CI-style API/database shard run",
    `Documented concurrency cap: ${report.documentedConcurrencyCap}`,
    `Shard count: ${report.shardCount}`,
    `Setup time: ${report.setupElapsedMs}ms (${report.setupStatus})`,
    `All shards started: ${report.allShardsStarted ? "yes" : "no"}`,
    `Peak active shards: ${report.peakActiveShards}`,
    `Timeout/lock failures: ${report.timeoutFailures}/${report.lockFailures}`,
    `Total wall-clock: ${report.totalElapsedMs}ms`,
    `Output directory: ${outputDirectory}`,
    "",
    "## Safety decision",
    "",
    reasons,
    "",
    "## Shards",
    "",
    "| Shard | Result | Elapsed | Timeout | Lock/setup failure |",
    "| --- | --- | ---: | --- | --- |",
    ...report.shards.map(
      (shard) =>
        `| ${shard.label} | ${shard.status} | ${shard.elapsedMs}ms | ${
          shard.timeoutFailure ? "yes" : "no"
        } | ${shard.lockFailure ? "yes" : "no"} |`,
    ),
    "",
    "Setup time is the elapsed time for the same schema push used to prepare the disposable CI database. The shards then perform their normal per-fixture disposable Postgres create, schema push, and teardown work.",
    "",
  ].join("\n");
}

export async function runConcurrencyStress(
  steps: readonly ReleaseStep[] = RELEASE_CHECK_API_SHARD_STEPS,
  options: {
    outputDirectory?: string;
    concurrencyCap?: number;
    setupStep?: ReleaseStep;
    runStepFn?: StressRunStep;
    now?: () => number;
  } = {},
): Promise<ConcurrencyStressReport> {
  const concurrencyCap = options.concurrencyCap ?? RELEASE_CHECK_API_CONCURRENCY;
  if (!Number.isInteger(concurrencyCap) || concurrencyCap < 1) {
    throw new Error(`Concurrency cap must be a positive integer (received ${concurrencyCap}).`);
  }
  const outputDirectory =
    options.outputDirectory ??
    process.env.RELEASE_CONCURRENCY_EVIDENCE_DIR ??
    join(rootDir, "tmp", `release-concurrency-${Date.now()}`);
  const runStepFn = options.runStepFn ?? runStep;
  const now = options.now ?? Date.now;
  await mkdir(outputDirectory, { recursive: true });

  const laneStartedAt = now();
  const setupStep = options.setupStep ?? {
    label: "CI disposable database schema setup",
    args: ["--filter", "@workspace/db", "run", "push-force"],
    timeoutMs: API_SHARD_TIMEOUT_MS,
  };
  const setupOutputPath = join(outputDirectory, "database-setup.log");
  let setupResult: Awaited<ReturnType<StressRunStep>>;
  try {
    setupResult = await runStepFn(setupStep, { logPath: setupOutputPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(setupOutputPath, `${message}\n`, "utf8");
    setupResult = {
      exitCode: 1,
      elapsedMs: 0,
      status: "INFRASTRUCTURE ERROR",
      output: message,
    };
  }
  const setupFailure = classifyStressFailure(
    setupResult.status,
    setupResult.output,
  );
  const firstOutputAt = new Map<string, number>();
  const results: StressShardResult[] = [];
  let nextIndex = 0;
  let activeShards = 0;
  let peakActiveShards = 0;

  const runNext = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      const step = steps[index];
      if (!step) return;
      activeShards += 1;
      peakActiveShards = Math.max(peakActiveShards, activeShards);
      const safeLabel = step.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const shardOutputPath = join(outputDirectory, `${index + 1}-${safeLabel}.log`);
      try {
        const result = await runStepFn(step, {
          logPath: shardOutputPath,
          onOutput: () => {
            if (!firstOutputAt.has(step.label)) firstOutputAt.set(step.label, now());
          },
        });
        const failure = classifyStressFailure(result.status, result.output);
        results.push({
          label: step.label,
          status: result.status,
          elapsedMs: result.elapsedMs,
          ...failure,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeFile(shardOutputPath, `${message}\n`, "utf8");
        results.push({
          label: step.label,
          status: "INFRASTRUCTURE ERROR",
          elapsedMs: 0,
          ...classifyStressFailure("INFRASTRUCTURE ERROR", message),
        });
      } finally {
        activeShards -= 1;
      }
    }
  };

  if (setupResult.status === "PASS") {
    await Promise.all(
      Array.from(
        { length: Math.min(concurrencyCap, steps.length) },
        () => runNext(),
      ),
    );
  } else {
    results.push(
      ...steps.map((step) => ({
        label: step.label,
        status: "NOT REACHED" as const,
        elapsedMs: 0,
        timeoutFailure: false,
        lockFailure: false,
      })),
    );
  }

  const setupElapsedMs = setupResult.elapsedMs;
  const orderedResults = steps.map(
    (step) => results.find((result) => result.label === step.label)!,
  );
  const timeoutFailures =
    Number(setupFailure.timeoutFailure) +
    orderedResults.filter((result) => result.timeoutFailure).length;
  const lockFailures =
    Number(setupFailure.lockFailure) +
    orderedResults.filter((result) => result.lockFailure).length;
  const totalElapsedMs = now() - laneStartedAt;
  const unsafeReasons: string[] = [];
  if (setupResult.status !== "PASS") {
    unsafeReasons.push(`disposable database setup returned ${setupResult.status}`);
  }
  if (peakActiveShards > concurrencyCap) {
    unsafeReasons.push(
      `observed peak active shards ${peakActiveShards} exceeded cap ${concurrencyCap}`,
    );
  }
  if (!orderedResults.every((result) => result.status === "PASS")) {
    unsafeReasons.push("one or more API shards did not pass");
  }
  if (timeoutFailures > 0) {
    unsafeReasons.push(`${timeoutFailures} timeout failure(s) were observed`);
  }
  if (lockFailures > 0) {
    unsafeReasons.push(`${lockFailures} lock/setup failure(s) were observed`);
  }
  if (firstOutputAt.size !== steps.length) {
    unsafeReasons.push(
      `only ${firstOutputAt.size}/${steps.length} shards reached child-process output`,
    );
  }

  const report: ConcurrencyStressReport = {
    schemaVersion: 1,
    documentedConcurrencyCap: concurrencyCap,
    shardCount: steps.length,
    setupElapsedMs,
    setupStatus: setupResult.status,
    allShardsStarted: firstOutputAt.size === steps.length,
    peakActiveShards,
    timeoutFailures,
    lockFailures,
    totalElapsedMs,
    safe: unsafeReasons.length === 0,
    unsafeReasons,
    shards: orderedResults,
  };
  await writeFile(
    join(outputDirectory, "release-concurrency-stress.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "release-concurrency-stress.md"),
    formatConcurrencyStressMarkdown(report, outputDirectory),
    "utf8",
  );
  return report;
}

export function validateStressEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Point it at a disposable CI-style Postgres database before running the concurrency stress lane.",
    );
  }
  if (env.RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB !== "1") {
    throw new Error(
      "Set RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB=1 to confirm DATABASE_URL points at a disposable Postgres service.",
    );
  }
  if (!env.CI && env.NODE_ENV !== "test" && env.E2E_TEST_DB !== "1") {
    throw new Error(
      "Concurrency stress is restricted to CI/test environments. Set NODE_ENV=test or E2E_TEST_DB=1 only after selecting a disposable database.",
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: pnpm run check:release-concurrency");
    console.log(
      `Runs the six API release shards at the documented concurrency cap of ${RELEASE_CHECK_API_CONCURRENCY}.`,
    );
    console.log(
      "Set RELEASE_CONCURRENCY_EVIDENCE_DIR to retain reports at a chosen path.",
    );
    console.log(
      "Requires RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB=1 and a CI/test environment.",
    );
    process.exit(0);
  }
  validateStressEnvironment();
  const report = await runConcurrencyStress();
  console.log(
    `API concurrency stress ${report.safe ? "passed" : "failed"}: cap=${report.documentedConcurrencyCap}, peak=${report.peakActiveShards}, setup=${report.setupElapsedMs}ms, timeouts=${report.timeoutFailures}, locks=${report.lockFailures}, wall=${report.totalElapsedMs}ms.`,
  );
  if (!report.safe) {
    console.error(
      `Concurrency cap unsafe: ${report.unsafeReasons.join("; ")}. Keep the production release cap at ${RELEASE_CHECK_API_CONCURRENCY} until the failure is understood.`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();