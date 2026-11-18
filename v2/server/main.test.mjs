import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readRuntimeDatabaseRole, V2StartupError } from "./main.mjs";

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

test("runtime database identity reads and returns only the connected role", async () => {
  const calls = [];
  const role = await readRuntimeDatabaseRole({
    async query(query) {
      calls.push(query);
      return { rows: [{ runtime_role: "neondb_owner" }] };
    },
  });

  assert.equal(role, "neondb_owner");
  assert.deepEqual(calls, [{
    text: "SELECT current_user AS runtime_role",
    query_timeout: 3000,
  }]);
});

test("runtime database identity rejects missing or oversized role names safely", async () => {
  for (const runtimeRole of [null, "", "x".repeat(64)]) {
    await assert.rejects(
      readRuntimeDatabaseRole({
        async query() {
          return { rows: [{ runtime_role: runtimeRole }] };
        },
      }),
      (error) => {
        assert.ok(error instanceof V2StartupError);
        assert.equal(error.code, "V2_DATABASE_IDENTITY_UNAVAILABLE");
        assert.equal(error.message, "V2 could not verify its database identity.");
        return true;
      },
    );
  }
});
