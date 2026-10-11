#!/usr/bin/env node

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = join(rootDir, "api-load-workload");
const metricsPath = join(evidenceDir, "metrics.json");
const resultPath = join(evidenceDir, "api-load-workload-result.json");
const ADMIN_DATABASE = "api_load_test_admin";
const ADMIN_PASSWORD = "api-load-ci";
const DATABASE_PREFIX = "api_load_test_";
const TOTAL_TIMEOUT_MS = 6 * 60_000;
const SCHEMA_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 3 * 60_000;
const CLEANUP_RESERVE_MS = 30_000;
const MAX_CLIENTS = 4;
const MAX_ROUNDS = 4;
const MAX_CONCURRENT_REQUESTS = 12;
const MAX_SYNC_WRITE_ATTEMPTS = MAX_CLIENTS * MAX_ROUNDS * 2 * MAX_CLIENTS;
const MAX_TOTAL_REQUESTS =
  MAX_SYNC_WRITE_ATTEMPTS
  + MAX_ROUNDS * 2
  + 3
  + MAX_CLIENTS * MAX_ROUNDS * 2
  + MAX_CLIENTS * MAX_ROUNDS;

let activeChild;
let receivedSignal;

function isolatedChildEnvironment(databaseUrl, metricsFile) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|SIGNING_KEYS|CREDENTIAL|API_KEY|PRODUCTION|WEBHOOK|(?:SIGNUP|ACCESS|RECOVERY)_?CODE)|^PROD_|^GIT_URL$/iu.test(key)) {
      delete environment[key];
    }
  }
  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    AUTH_TOKEN_SECRET: "api-load-workload-test-only",
    E2E_TEST_DB: "1",
    E2E_APPROVED_DESTRUCTIVE_MODE: "1",
    API_LOAD_TEST_DISPOSABLE_DB: "1",
    API_LOAD_TEST_RUNNER: "1",
    API_LOAD_TEST_METRICS_PATH: metricsFile,
  };
}

export function validateApiLoadEnvironment(environment = process.env) {
  if (
    environment.NODE_ENV !== "test"
    || environment.API_LOAD_TEST_DISPOSABLE_DB !== "1"
    || environment.REPLIT_DEPLOYMENT === "1"
    || /^(production|prod)$/iu.test(environment.APP_ENV ?? "")
  ) {
    throw new Error("The API load lane requires its explicit isolated-test acknowledgement.");
  }

  const rawUrl = environment.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error("The API load lane requires its disposable loopback PostgreSQL service.");
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("The API load lane database URL is invalid.");
  }

  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol)
    || databaseUrl.hostname !== "127.0.0.1"
    || databaseUrl.port !== "5432"
    || databaseUrl.username !== "postgres"
    || databaseUrl.password !== ADMIN_PASSWORD
    || decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "")) !== ADMIN_DATABASE
    || databaseUrl.search !== ""
    || databaseUrl.hash !== ""
  ) {
    throw new Error("The API load lane accepts only its named loopback disposable database.");
  }

  if (environment.GITHUB_ACTIONS === "true" && !/^[a-f0-9]{40,64}$/iu.test(environment.GITHUB_SHA ?? "")) {
    throw new Error("The API load lane requires a valid workflow revision.");
  }

  return databaseUrl;
}

function sourceRevision() {
  const fromWorkflow = process.env.GITHUB_SHA?.trim();
  if (fromWorkflow && /^[a-f0-9]{40,64}$/iu.test(fromWorkflow)) {
    return fromWorkflow.toLowerCase();
  }
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[a-f0-9]{40,64}$/iu.test(revision) ? revision.toLowerCase() : "unknown";
  } catch {
    return "unknown";
  }
}

function parseMetrics(value) {
  const allowed = new Set([
    "schemaVersion",
    "clients",
    "rounds",
    "syncWrites",
    "syncWriteAttempts",
    "syncSnapshotReads",
    "syncFallbacks",
    "consumeRequests",
    "adjustmentRequests",
    "verificationRequests",
    "totalRequests",
    "peakConcurrentRequests",
    "syncElapsedMs",
    "inventoryElapsedMs",
    "durationMs",
    "assertionFailures",
  ]);
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || value.schemaVersion !== 1
    || value.clients !== MAX_CLIENTS
    || value.rounds !== MAX_ROUNDS
    || value.syncWrites !== MAX_CLIENTS * MAX_ROUNDS * 2
    || !Number.isInteger(value.syncWriteAttempts)
    || value.syncWriteAttempts < value.syncWrites
    || value.syncWriteAttempts > MAX_SYNC_WRITE_ATTEMPTS
    || value.syncFallbacks !== value.syncWriteAttempts - value.syncWrites
    || value.syncSnapshotReads !== MAX_ROUNDS * 2
    || value.consumeRequests !== MAX_CLIENTS * MAX_ROUNDS * 2
    || value.adjustmentRequests !== MAX_CLIENTS * MAX_ROUNDS
    || value.verificationRequests !== 3
    || value.totalRequests !== value.syncWriteAttempts + value.syncSnapshotReads + value.consumeRequests + value.adjustmentRequests + value.verificationRequests
    || value.totalRequests > MAX_TOTAL_REQUESTS
    || !Number.isInteger(value.peakConcurrentRequests)
    || value.peakConcurrentRequests < 1
    || value.peakConcurrentRequests > MAX_CONCURRENT_REQUESTS
    || value.assertionFailures !== 0
    || ["syncElapsedMs", "inventoryElapsedMs", "durationMs"].some(
      (key) => !Number.isFinite(value[key]) || value[key] < 0 || value[key] > TEST_TIMEOUT_MS,
    )
  ) {
    return null;
  }
  return value;
}

function elapsedSince(startedAt) {
  return Math.max(0, Math.min(TOTAL_TIMEOUT_MS, Date.now() - startedAt));
}

async function writeResult({ startedAt, revision, status, failureKind, metrics }) {
  const result = {
    schemaVersion: 1,
    laneId: "api-load-workload",
    workflow: ".github/workflows/api-load-workload.yml",
    command: "pnpm --filter @workspace/api-server run test:load:isolated",
    sourceRevision: revision,
    createdAt: new Date().toISOString(),
    environment: "disposable-postgresql",
    dataClass: "synthetic-test-fixtures",
    status,
    failureKind,
    elapsedMs: elapsedSince(startedAt),
    limits: {
      clients: MAX_CLIENTS,
      rounds: MAX_ROUNDS,
      syncWriteAttemptsPerWrite: MAX_CLIENTS,
      concurrentRequests: MAX_CONCURRENT_REQUESTS,
      totalRequests: MAX_TOTAL_REQUESTS,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
    },
    observed: metrics
      ? {
          clients: metrics.clients,
          rounds: metrics.rounds,
          syncWrites: metrics.syncWrites,
          syncWriteAttempts: metrics.syncWriteAttempts,
          syncSnapshotReads: metrics.syncSnapshotReads,
          syncFallbacks: metrics.syncFallbacks,
          consumeRequests: metrics.consumeRequests,
          adjustmentRequests: metrics.adjustmentRequests,
          verificationRequests: metrics.verificationRequests,
          totalRequests: metrics.totalRequests,
          peakConcurrentRequests: metrics.peakConcurrentRequests,
          syncElapsedMs: Math.round(metrics.syncElapsedMs),
          inventoryElapsedMs: Math.round(metrics.inventoryElapsedMs),
          workloadElapsedMs: Math.round(metrics.durationMs),
          assertionFailures: metrics.assertionFailures,
        }
      : null,
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return result;
}

function runSchemaPush(databaseUrl, remainingMs) {
  const timeout = Math.max(1, Math.min(SCHEMA_TIMEOUT_MS, remainingMs - CLEANUP_RESERVE_MS));
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/db", "run", "push-force"],
    {
      cwd: rootDir,
      env: isolatedChildEnvironment(databaseUrl, metricsPath),
      encoding: "utf8",
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
    return "TIMEOUT";
  }
  return result.status === 0 ? "PASS" : "FAIL";
}

function runWorkload(databaseUrl, metricsFile, timeoutMs) {
  return new Promise((resolveResult) => {
    const child = spawn(
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.api-load.config.ts",
        "load-tests/api-load.test.ts",
      ],
      {
        cwd: rootDir,
        env: isolatedChildEnvironment(databaseUrl, metricsFile),
        stdio: "ignore",
        detached: process.platform !== "win32",
      },
    );
    activeChild = child;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChild = undefined;
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      resolveResult(result);
    };
    const forwardSignal = (signal) => {
      receivedSignal = signal;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    };
    const onInterrupt = () => forwardSignal("SIGINT");
    const onTerminate = () => forwardSignal("SIGTERM");
    const timer = setTimeout(() => {
      const killGroup = (signal) => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          child.kill(signal);
        }
      };
      killGroup("SIGTERM");
      const forceTimer = setTimeout(() => killGroup("SIGKILL"), 5_000);
      forceTimer.unref();
    }, Math.max(1, timeoutMs));
    timer.unref();
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    child.once("error", () =>
      finish({ status: "INFRASTRUCTURE_ERROR", failureKind: "infrastructure" }),
    );
    child.once("close", (code, signal) => {
      if (receivedSignal) {
        finish({ status: "CANCELLED", failureKind: "interrupted" });
      } else if (signal === "SIGTERM" || signal === "SIGKILL") {
        finish({ status: "TIMEOUT", failureKind: "timeout" });
      } else if (code === 0) {
        finish({ status: "PASS", failureKind: "none" });
      } else {
        finish({ status: "FAIL", failureKind: "workload_assertion" });
      }
    });
  });
}

async function readWorkloadMetrics() {
  try {
    return parseMetrics(JSON.parse(await readFile(metricsPath, "utf8")));
  } catch {
    return null;
  }
}

async function main() {
  const startedAt = Date.now();
  const revision = sourceRevision();
  let status = "INFRASTRUCTURE_ERROR";
  let failureKind = "infrastructure";
  let adminPool;
  let databaseName;
  let databaseCreated = false;
  let metrics = null;
  let environmentValid = false;

  await mkdir(evidenceDir, { recursive: true });
  await Promise.all([
    rm(metricsPath, { force: true }),
    rm(resultPath, { force: true }),
  ]);
  const onInterrupt = () => { receivedSignal = "SIGINT"; };
  const onTerminate = () => { receivedSignal = "SIGTERM"; };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);

  try {
    const adminUrl = validateApiLoadEnvironment(process.env);
    environmentValid = true;
    adminPool = new pg.Pool({
      connectionString: adminUrl.toString(),
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 1_000,
      options: "-c statement_timeout=10000",
    });
    const suffix = randomBytes(8).toString("hex");
    databaseName = `${DATABASE_PREFIX}${suffix}`;
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;

    const workloadUrl = new URL(adminUrl);
    workloadUrl.pathname = `/${databaseName}`;
    if (receivedSignal) {
      status = "CANCELLED";
      failureKind = "interrupted";
    } else {
      const schemaStatus = runSchemaPush(
        workloadUrl.toString(),
        TOTAL_TIMEOUT_MS - elapsedSince(startedAt),
      );
      if (receivedSignal) {
        status = "CANCELLED";
        failureKind = "interrupted";
      } else if (schemaStatus === "TIMEOUT") {
        status = "TIMEOUT";
        failureKind = "timeout";
      } else if (schemaStatus !== "PASS") {
        status = "FAIL";
        failureKind = "schema_setup";
      } else {
        const remaining = TOTAL_TIMEOUT_MS - elapsedSince(startedAt) - CLEANUP_RESERVE_MS;
        if (remaining <= 0) {
          status = "TIMEOUT";
          failureKind = "timeout";
        } else {
          const testResult = await runWorkload(
            workloadUrl.toString(),
            metricsPath,
            Math.min(TEST_TIMEOUT_MS, remaining),
          );
          status = testResult.status;
          failureKind = testResult.failureKind;
          metrics = await readWorkloadMetrics();
        }
      }
    }
  } catch {
    status = environmentValid ? "INFRASTRUCTURE_ERROR" : "BLOCKED";
    failureKind = environmentValid ? "database_setup" : "environment";
  } finally {
    if (databaseCreated && adminPool) {
      try {
        await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      } catch {
        status = "INFRASTRUCTURE_ERROR";
        failureKind = "database_cleanup";
      }
    }
    if (adminPool) {
      try {
        await adminPool.end();
      } catch {
        status = "INFRASTRUCTURE_ERROR";
        failureKind = "database_cleanup";
      }
    }
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }

  if (receivedSignal) {
    status = "CANCELLED";
    failureKind = "interrupted";
  }
  if (status === "PASS" && !metrics) {
    status = "INFRASTRUCTURE_ERROR";
    failureKind = "missing_workload_summary";
  }
  const result = await writeResult({
    startedAt,
    revision,
    status,
    failureKind,
    metrics,
  });
  console.info(
    `[api load workload] status=${result.status} failureKind=${result.failureKind} elapsedMs=${result.elapsedMs} revision=${result.sourceRevision}`,
  );
  if (!["PASS"].includes(result.status)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async () => {
    process.exitCode = 1;
    console.error("[api load workload] status=INFRASTRUCTURE_ERROR failureKind=summary_write");
  });
}
