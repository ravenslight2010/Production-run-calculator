import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("published V2 starts its supervised API and worker on one external web port", () => {
  const config = readFileSync(resolve(repositoryRoot, ".replit"), "utf8");
  assert.match(config, /^run = \["bash", "scripts\/start-v2\.sh"\]$/m);
  assert.doesNotMatch(config, /run = \["bash", "scripts\/deny-v2-publish\.sh"\]/);
  assert.deepEqual(
    [...config.matchAll(/^\s*externalPort\s*=\s*(\d+)\s*$/gm)].map((match) => match[1]),
    ["80"],
  );
});

test("the retired publish guard still fails closed when called directly", () => {
  const result = spawnSync("bash", [
    resolve(repositoryRoot, "scripts/deny-v2-publish.sh"),
  ], { encoding: "utf8" });

  assert.equal(result.status, 78);
  assert.match(result.stderr, /private development pilot/i);
  assert.match(result.stderr, /production database access/i);
});
