import { mkdir, readFile, writeFile } from "node:fs/promises";
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
export const CONCURRENCY_REGRESSION_MIN_INCREASE_MS = 30_000;
export const CONCURRENCY_REGRESSION_MIN_INCREASE_PERCENT = 25;

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

export type ConcurrencyTimingMetric = {
  baselineMs: number;
  currentMs: number;
  increaseMs: number;
  increasePercent: number | null;
  meaningfulRegression: boolean;
};

export type ConcurrencyStressComparison = {
  schemaVersion: 1;
  status: "NO BASELINE" | "PASS" | "REGRESSION";
  baselineAvailable: boolean;
  baselineHealthy: boolean;
  note: string;
  minimumIncreaseMs: number;
  minimumIncreasePercent: number;
  setup: ConcurrencyTimingMetric | null;
  totalWallClock: ConcurrencyTimingMetric | null;
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

function timingMetric(
  baselineMs: number,
  currentMs: number,
): ConcurrencyTimingMetric {
  const increaseMs = currentMs - baselineMs;
  const increasePercent =
    baselineMs > 0 ? (increaseMs / baselineMs) * 100 : null;
  return {
    baselineMs,
    currentMs,
    increaseMs,
    increasePercent,
    meaningfulRegression:
      increaseMs >= CONCURRENCY_REGRESSION_MIN_INCREASE_MS &&
      (increasePercent === null ||
        increasePercent >= CONCURRENCY_REGRESSION_MIN_INCREASE_PERCENT),
  };
}

function isHealthyBaseline(
  report: ConcurrencyStressReport | undefined,
): report is ConcurrencyStressReport {
  return (
    report?.schemaVersion === 1 &&
    report.safe === true &&
    Number.isFinite(report.setupElapsedMs) &&
    Number.isFinite(report.totalElapsedMs)
  );
}

export function compareConcurrencyStressReports(
  current: ConcurrencyStressReport,
  baseline?: ConcurrencyStressReport,
): ConcurrencyStressComparison {
  if (!isHealthyBaseline(baseline)) {
    return {
      schemaVersion: 1,
      status: "NO BASELINE",
      baselineAvailable: baseline !== undefined,
      baselineHealthy: false,
      note:
        baseline === undefined
          ? "No prior healthy calibration was found."
          : "The available prior calibration was not healthy and was ignored.",
      minimumIncreaseMs: CONCURRENCY_REGRESSION_MIN_INCREASE_MS,
      minimumIncreasePercent: CONCURRENCY_REGRESSION_MIN_INCREASE_PERCENT,
      setup: null,
      totalWallClock: null,
    };
  }

  const setup = timingMetric(baseline.setupElapsedMs, current.setupElapsedMs);
  const totalWallClock = timingMetric(
    baseline.totalElapsedMs,
    current.totalElapsedMs,
  );
  return {
    schemaVersion: 1,
    status:
      setup.meaningfulRegression || totalWallClock.meaningfulRegression
        ? "REGRESSION"
        : "PASS",
    baselineAvailable: true,
    baselineHealthy: true,
    note: "Compared with the prior healthy calibration.",
    minimumIncreaseMs: CONCURRENCY_REGRESSION_MIN_INCREASE_MS,
    minimumIncreasePercent: CONCURRENCY_REGRESSION_MIN_INCREASE_PERCENT,
    setup,
    totalWallClock,
  };
}

function formatMetric(metric: ConcurrencyTimingMetric | null): string {
  if (!metric) return "not available";
  const increasePercent =
    metric.increasePercent === null
      ? "n/a"
      : `${metric.increasePercent.toFixed(1)}%`;
  return `${metric.currentMs}ms (baseline ${metric.baselineMs}ms; +${metric.increaseMs}ms, ${increasePercent})`;
}

export function formatConcurrencyComparisonMarkdown(
  comparison: ConcurrencyStressComparison,
): string {
  const status =
    comparison.status === "REGRESSION"
      ? "ALERT — meaningful regression detected"
      : comparison.status;
  const regressionMetrics = [
    comparison.setup?.meaningfulRegression ? "setup time" : null,
    comparison.totalWallClock?.meaningfulRegression
      ? "total wall-clock time"
      : null,
  ].filter((metric): metric is string => metric !== null);
  return [
    "# API concurrency calibration comparison",
    "",
    `Result: ${status}`,
    `Baseline: ${comparison.note}`,
    `Threshold: at least ${comparison.minimumIncreaseMs}ms and ${comparison.minimumIncreasePercent}% slower`,
    "",
    "| Metric | Current | Meaningful regression |",
    "| --- | --- | --- |",
    `| Setup time | ${formatMetric(comparison.setup)} | ${
      comparison.setup?.meaningfulRegression ? "yes" : "no"
    } |`,
    `| Total wall-clock time | ${formatMetric(comparison.totalWallClock)} | ${
      comparison.totalWallClock?.meaningfulRegression ? "yes" : "no"
    } |`,
    "",
    regressionMetrics.length > 0
      ? `ALERT: ${regressionMetrics.join(" and ")} exceeded the calibration threshold.`
      : comparison.status === "NO BASELINE"
        ? "No comparison was possible; retain this healthy run as the next baseline."
        : "No meaningful setup or total wall-clock regression detected.",
    "",
  ].join("\n");
}

async function writeConcurrencyComparison(
  outputDirectory: string,
  current: ConcurrencyStressReport,
): Promise<void> {
  const baselinePath = process.env.RELEASE_CONCURRENCY_BASELINE_JSON;
  let baseline: ConcurrencyStressReport | undefined;
  if (baselinePath) {
    try {
      baseline = JSON.parse(
        await readFile(baselinePath, "utf8"),
      ) as ConcurrencyStressReport;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not read calibration baseline: ${message}`);
    }
  }
  const comparison = compareConcurrencyStressReports(current, baseline);
  await writeFile(
    join(outputDirectory, "release-concurrency-comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "release-concurrency-comparison.md"),
    formatConcurrencyComparisonMarkdown(comparison),
    "utf8",
  );
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
  const concurrencyCap =
    options.concurrencyCap ?? RELEASE_CHECK_API_CONCURRENCY;
  if (!Number.isInteger(concurrencyCap) || concurrencyCap < 1) {
    throw new Error(
      `Concurrency cap must be a positive integer (received ${concurrencyCap}).`,
    );
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
      const shardOutputPath = join(
        outputDirectory,
        `${index + 1}-${safeLabel}.log`,
      );
      try {
        const result = await runStepFn(step, {
          logPath: shardOutputPath,
          onOutput: () => {
            if (!firstOutputAt.has(step.label))
              firstOutputAt.set(step.label, now());
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
      Array.from({ length: Math.min(concurrencyCap, steps.length) }, () =>
        runNext(),
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
    unsafeReasons.push(
      `disposable database setup returned ${setupResult.status}`,
    );
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
  await writeConcurrencyComparison(outputDirectory, report);
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
      "Set RELEASE_CONCURRENCY_BASELINE_JSON to compare setup and wall-clock time with a healthy prior report.",
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
