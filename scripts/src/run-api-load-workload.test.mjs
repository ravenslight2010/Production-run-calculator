import assert from "node:assert/strict";
import test from "node:test";
import { validateApiLoadEnvironment } from "./run-api-load-workload.mjs";

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
