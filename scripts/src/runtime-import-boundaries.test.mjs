import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { IDENTITY_SEQUENCE_TARGETS } from "../../lib/db/migrations/identity-sequence-drift.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const { build } = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url))("esbuild");

// No DB, auth, provider credentials, production labels, or NODE_OPTIONS.
const environment = {
  PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
  HOME: os.tmpdir(),
  NODE_ENV: "production",
};

test("runtime serial targets retain the historical inventory plus reviewed schema additions", () => {
  const sql = readFileSync(path.join(root, "lib/db/migrations/0003_serial_to_identity.sql"), "utf8");
  const expected = [...sql.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/gu)]
    .map(([, tableName, columnName]) => ({ tableName, columnName }));
  assert.equal(expected.length, 37);
  expected.push({ tableName: "freezer_surplus_decision_corrections", columnName: "id" });
  expected.sort((a, b) => a.tableName.localeCompare(b.tableName));
  assert.deepEqual(IDENTITY_SEQUENCE_TARGETS, expected);
  assert(Object.isFrozen(IDENTITY_SEQUENCE_TARGETS));
  assert(IDENTITY_SEQUENCE_TARGETS.every(Object.isFrozen));
});

for (const entry of [
  "lib/db/migrations/identity-sequence-health.mjs",
  "lib/db/migrations/check-identity-sequence-drift.mjs",
  "scripts/src/verify-published-build.mjs",
]) {
  test(`bundling ${entry} does not execute CLI code or read migration assets`, async (t) => {
    const output = mkdtempSync(path.join(os.tmpdir(), "runtime-import-boundary-"));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    const outfile = path.join(output, "index.mjs");
    await build({
      entryPoints: [path.join(root, entry)],
      outfile,
      platform: "node",
      format: "esm",
      bundle: true,
      logLevel: "silent",
      banner: { js: 'import {createRequire} from "node:module"; globalThis.require=createRequire(import.meta.url);' },
    });
    const child = spawnSync(process.execPath, [outfile], {
      cwd: output,
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "", "an imported library must not emit CLI reports");
    assert.equal(child.stderr, "", "an imported library must not start CLI checks");
    assert(!readFileSync(outfile, "utf8").includes('new URL("./0003_serial_to_identity.sql"'));
  });
}

for (const [script, expectedCode, message] of [
  ["lib/db/migrations/check-identity-sequence-drift.mjs", 2, "DATABASE_URL must be set"],
  ["scripts/src/verify-published-build.mjs", 1, "An official published target is required"],
]) {
  test(`${script} still validates direct command-line invocation`, () => {
    const child = spawnSync(process.execPath, [path.join(root, script)], {
      cwd: os.tmpdir(),
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, expectedCode, child.stderr);
    assert(child.stderr.includes(message), child.stderr);
  });
}
