import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanupOwnedStage } from "./cleanup.mjs";

for (const directory of ["/", "/tmp", ".", "artifacts/api-server",
  ".local/isolated-staging/production", ".local/isolated-staging/run-unknown"]) {
  test(`orphan cleanup refuses unowned target ${directory}`, async () => {
    await assert.rejects(cleanupOwnedStage(directory));
  });
}
test("published runtimes cannot invoke the staging runner", () => {
  const runner = fileURLToPath(new URL("../isolated-staging.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [runner, "check"], {
    env: { PATH: process.env.PATH, REPLIT_DEPLOYMENT_ID: "published-runtime" }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to run inside a published deployment/);
});
test("runner refuses supplied target arguments before setup", () => {
  const runner = fileURLToPath(new URL("../isolated-staging.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [runner, "check", "postgresql://production"], {
    env: { PATH: process.env.PATH }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /target overrides are forbidden/);
});
