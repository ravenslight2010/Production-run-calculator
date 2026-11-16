import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const MAIN_PATH = fileURLToPath(new URL("./main.mjs", import.meta.url));

function runWithEnv(overrides) {
  return spawnSync(process.execPath, [MAIN_PATH], {
    encoding: "utf8",
    env: {
      ...process.env,
      V2_DATABASE_URL: "",
      DATABASE_URL: "postgresql://v1.invalid/legacy",
      ...overrides,
    },
    timeout: 5000,
  });
}

test("V2 refuses to fall back to V1 DATABASE_URL when its own database URL is absent", () => {
  const result = runWithEnv({ V2_DATABASE_URL: "" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /V2_DATABASE_URL_REQUIRED/);
  assert.doesNotMatch(result.stdout, /v1\.invalid/);
  assert.equal(result.stderr, "");
});

test("V2 rejects a non-PostgreSQL database URL before opening a connection", () => {
  const result = runWithEnv({ V2_DATABASE_URL: "https://example.invalid/db" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /V2_DATABASE_URL_PROTOCOL/);
  assert.doesNotMatch(result.stdout, /example\.invalid/);
});
