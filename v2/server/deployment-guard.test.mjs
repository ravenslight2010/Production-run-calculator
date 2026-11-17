import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("V2 deployment command refuses publication before production gates pass", () => {
  const result = spawnSync("bash", [
    resolve(repositoryRoot, "scripts/deny-v2-publish.sh"),
  ], { encoding: "utf8" });

  assert.equal(result.status, 78);
  assert.match(result.stderr, /private development pilot/i);
  assert.match(result.stderr, /production database access/i);
});
