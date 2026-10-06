import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { validateApiLoadEnvironment } from "./run-api-load-workload.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runnerPath = join(rootDir, "scripts/src/run-api-load-workload.mjs");
const resultPath = join(rootDir, "api-load-workload/api-load-workload-result.json");
const adminDatabase = "api_load_test_admin";
const databasePrefix = "api_load_test_";

const safeEnvironment = {
  NODE_ENV: "test",
  API_LOAD_TEST_DISPOSABLE_DB: "1",
  DATABASE_URL: "postgresql://postgres:api-load-ci@127.0.0.1:5432/api_load_test_admin",
};

test("API load runner accepts only its explicitly named loopback disposable database", () => {
  const url = validateApiLoadEnvironment(safeEnvironment);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/api_load_test_admin");

  for (const change of [
    { NODE_ENV: "production" },
    { APP_ENV: "production" },
    { REPLIT_DEPLOYMENT: "1" },
    { API_LOAD_TEST_DISPOSABLE_DB: undefined },
    { DATABASE_URL: "postgresql://postgres:api-load-ci@127.0.0.1:5432/runcalc_dev" },
    { DATABASE_URL: "postgresql://postgres:api-load-ci@example.com:5432/api_load_test_admin" },
    { DATABASE_URL: "postgresql://postgres:api-load-ci@127.0.0.1:5432/api_load_test_admin?sslmode=require" },
  ]) {
    assert.throws(
      () => validateApiLoadEnvironment({ ...safeEnvironment, ...change }),
      /isolated-test acknowledgement|named loopback disposable database/u,
    );
  }
});

test("CI API load reports require a source revision", () => {
  assert.throws(
    () => validateApiLoadEnvironment({ ...safeEnvironment, GITHUB_ACTIONS: "true" }),
    /valid workflow revision/u,
  );
  assert.doesNotThrow(
    () => validateApiLoadEnvironment({
      ...safeEnvironment,
      GITHUB_ACTIONS: "true",
      GITHUB_SHA: "a".repeat(40),
    }),
  );
});

async function listChildDatabases(pool) {
  const result = await pool.query(
    "SELECT datname FROM pg_database WHERE left(datname, length($1)) = $1 ORDER BY datname",
    [databasePrefix],
  );
  return result.rows
    .map(({ datname }) => datname)
    .filter((name) => name !== adminDatabase);
}

test(
  "failed API load schema setup reports a sanitized failure and drops its child database",
  { skip: process.env.API_LOAD_WORKLOAD_FAILURE_TEST !== "1" },
  async () => {
    const adminUrl = validateApiLoadEnvironment(process.env);
    const adminPool = new pg.Pool({
      connectionString: adminUrl.toString(),
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "api-load-schema-failure-"));
    const binDirectory = join(temporaryDirectory, "bin");
    const fakePnpmPath = join(binDirectory, "pnpm");
    const markerPath = join(temporaryDirectory, "schema-command-called");

    try {
      assert.equal(
        (await listChildDatabases(adminPool)).length,
        0,
        "the disposable PostgreSQL service must start without leftover API load databases",
      );

      await mkdir(binDirectory);
      await writeFile(
        fakePnpmPath,
        "#!/bin/sh\nprintf 'called\\n' > \"$API_LOAD_SCHEMA_STUB_MARKER\"\nprintf 'unreported schema output\\n'\nprintf 'unreported schema error\\n' >&2\nexit 23\n",
        { encoding: "utf8", mode: 0o700 },
      );
      await chmod(fakePnpmPath, 0o700);

      const childEnvironment = {
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
        DATABASE_URL: adminUrl.toString(),
        NODE_ENV: "test",
        API_LOAD_TEST_DISPOSABLE_DB: "1",
        API_LOAD_SCHEMA_STUB_MARKER: markerPath,
        ...(process.env.GITHUB_ACTIONS === "true"
          ? {
              GITHUB_ACTIONS: "true",
              GITHUB_SHA: process.env.GITHUB_SHA,
            }
          : {}),
      };
      const runner = spawnSync(process.execPath, [runnerPath], {
        cwd: rootDir,
        env: childEnvironment,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      });

      assert.equal(runner.error, undefined, "the bounded API load runner should finish");
      assert.equal(runner.signal, null, "the bounded API load runner should not be interrupted");
      assert.equal(runner.status, 1, "the schema failure should produce a nonzero exit");
      assert.equal(
        await readFile(markerPath, "utf8"),
        "called\n",
        "the controlled schema failure must run after the runner creates its child database",
      );
      assert.match(
        runner.stdout,
        /^\[api load workload\] status=FAIL failureKind=schema_setup elapsedMs=\d+ revision=(?:[a-f0-9]{40,64}|unknown)\n$/u,
      );
      assert.equal(runner.stderr, "", "raw schema-command output must not reach runner stderr");

      const serializedResult = await readFile(resultPath, "utf8");
      const result = JSON.parse(serializedResult);
      assert.deepEqual(Object.keys(result).sort(), [
        "command",
        "createdAt",
        "dataClass",
        "elapsedMs",
        "environment",
        "failureKind",
        "laneId",
        "limits",
        "observed",
        "schemaVersion",
        "sourceRevision",
        "status",
        "workflow",
      ]);
      assert.equal(result.status, "FAIL");
      assert.equal(result.failureKind, "schema_setup");
      assert.equal(result.environment, "disposable-postgresql");
      assert.equal(result.dataClass, "synthetic-test-fixtures");
      assert.equal(result.observed, null);
      assert.doesNotMatch(serializedResult, /postgres(?:ql)?:\/\/|api_load_test_[a-f0-9]{16}/iu);
      assert.doesNotMatch(serializedResult, /unreported schema (?:output|error)/u);

      assert.equal(
        (await listChildDatabases(adminPool)).length,
        0,
        "the runner must remove every API load child database after schema setup fails",
      );
    } finally {
      await Promise.all([
        adminPool.end(),
        rm(temporaryDirectory, { recursive: true, force: true }),
      ]);
    }
  },
);
