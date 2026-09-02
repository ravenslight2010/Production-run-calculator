import assert from "node:assert/strict";
import {
  formatConcurrencyStressMarkdown,
  runConcurrencyStress,
  validateStressEnvironment,
  type StressRunStep,
} from "./release-concurrency-stress.mts";
import {
  API_SHARD_TIMEOUT_MS,
  RELEASE_CHECK_API_SHARD_STEPS,
  releaseGateLabelsForMode,
} from "./release-check.mts";

const steps = [
  { label: "shard one", args: [] },
  { label: "shard two", args: [] },
  { label: "shard three", args: [] },
  { label: "shard four", args: [] },
];

async function run(): Promise<void> {
  assert.equal(RELEASE_CHECK_API_SHARD_STEPS.length, 6);
  assert.ok(
    RELEASE_CHECK_API_SHARD_STEPS.every(
      (step) =>
        step.group === "api-test-shards" &&
        step.timeoutMs === API_SHARD_TIMEOUT_MS,
    ),
    "the disposable lane must reuse the exact bounded API release shard definitions",
  );
  assert.ok(
    releaseGateLabelsForMode("standard").every(
      (label) => !label.includes("concurrency stress"),
    ),
    "the disposable lane must not alter the production release gate inventory",
  );

  let active = 0;
  let peak = 0;
  const healthyRunner: StressRunStep = async (_step, options) => {
    active += 1;
    peak = Math.max(peak, active);
    options?.onOutput?.("vitest setup complete\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { exitCode: 0, elapsedMs: 20, status: "PASS", output: "" };
  };
  const healthy = await runConcurrencyStress(steps, {
    concurrencyCap: 2,
    runStepFn: healthyRunner,
  });
  assert.equal(healthy.safe, true);
  assert.equal(healthy.peakActiveShards, 2);
  assert.equal(peak, 2);
  assert.equal(healthy.allShardsStarted, true);
  assert.equal(healthy.timeoutFailures, 0);
  assert.equal(healthy.lockFailures, 0);
  assert.match(
    formatConcurrencyStressMarkdown(healthy, "tmp/stress"),
    /Setup time: \d+ms/,
  );
  assert.match(
    formatConcurrencyStressMarkdown(healthy, "tmp/stress"),
    /Peak active shards: 2/,
  );
  assert.doesNotThrow(() =>
    validateStressEnvironment({
      DATABASE_URL: "postgresql://disposable.example/test",
      NODE_ENV: "test",
      RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB: "1",
    }),
  );
  assert.throws(
    () =>
      validateStressEnvironment({
        DATABASE_URL: "postgresql://unconfirmed.example/test",
        NODE_ENV: "test",
      }),
    /APPROVED_DISPOSABLE_DB=1/,
  );

  const unsafeRunner: StressRunStep = async (step, options) => {
    options?.onOutput?.("vitest setup complete\n");
    return step.label === "shard two"
      ? {
          exitCode: 124,
          elapsedMs: 5,
          status: "INFRASTRUCTURE TIMEOUT",
          output: "deadlock detected while waiting for lock",
        }
      : { exitCode: 0, elapsedMs: 5, status: "PASS", output: "" };
  };
  const unsafe = await runConcurrencyStress(steps.slice(0, 2), {
    concurrencyCap: 2,
    runStepFn: unsafeRunner,
  });
  assert.equal(unsafe.safe, false);
  assert.equal(unsafe.timeoutFailures, 1);
  assert.equal(unsafe.lockFailures, 1);
  assert.match(unsafe.unsafeReasons.join("\n"), /timeout|lock/i);

  console.log(
    "Release concurrency stress tests passed (cap, peak tracking, metrics, unsafe diagnostics).",
  );
}

await run();