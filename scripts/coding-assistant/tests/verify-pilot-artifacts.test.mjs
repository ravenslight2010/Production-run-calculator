import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("verify-pilot passes static checks without --live", () => {
  const r = spawnSync(
    process.execPath,
    [path.join(root, "scripts/coding-assistant/verify-pilot.mjs"), "--fixture"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /Summary:.*fail/);
  assert.doesNotMatch(r.stdout + r.stderr, /^FAIL /m);
});
