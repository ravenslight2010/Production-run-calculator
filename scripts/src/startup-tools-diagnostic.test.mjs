import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { diagnoseStartupTools } from "./startup-tools-diagnostic.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "startup-diagnostic-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "workspace");
  const cache = path.join(directory, "private-cache");
  const bin = path.join(directory, "bin");
  fs.mkdirSync(root);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@12.8.1" }));
  fs.writeFileSync(path.join(root, ".nvmrc"), "24.21.0\n");
  const marker = path.join(directory, "SHOULD-NOT-EXECUTE");
  for (const name of ["node", "corepack", "pnpm", "npm", "npx"]) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nprintf executed > '${marker}'\nexit 1\n`, { mode: 0o700 });
  }
  const env = { PATH: bin, COREPACK_HOME: cache, SECRET_FIXTURE: "DO_NOT_PRINT_THIS" };
  const inspect = (extra = {}) => diagnoseStartupTools({ root, env, nodeVersion: "24.21.0", ...extra });
  return { root, cache, marker, env, inspect };
}

test("reports valid pin metadata without executing tools or certifying integrity", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.cache, "v1/pnpm/12.8.1"), { recursive: true });
  fs.writeFileSync(path.join(f.cache, "v1/pnpm/12.8.1/package.json"), JSON.stringify({ name: "pnpm", version: "12.8.1" }));
  const report = f.inspect();
  assert.equal(report.cache.state, "present-unverified");
  assert.equal(report.cache.integrity, "not-verified");
  assert.equal(report.packageManager.activeVersion, "not-executed");
  assert.equal(report.offlineStartupVerified, false);
  assert.equal(report.networkUsed, false);
  assert.equal(fs.existsSync(f.marker), false);
  assert.ok(!JSON.stringify(report).includes("DO_NOT_PRINT_THIS"));
});

test("reports absent, stale, oversized and malformed cache metadata without provisioning", (t) => {
  const f = fixture(t);
  assert.equal(f.inspect().cache.state, "missing-or-unreadable");
  const entry = path.join(f.cache, "v1/pnpm/12.8.1");
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, "package.json"), JSON.stringify({ name: "pnpm", version: "10.0.0" }));
  assert.equal(f.inspect().cache.state, "invalid-metadata");
  fs.writeFileSync(path.join(entry, "package.json"), " ".repeat(65_537));
  assert.equal(f.inspect().cache.state, "missing-or-unreadable");
  fs.writeFileSync(path.join(entry, "package.json"), "{");
  assert.equal(f.inspect().cache.state, "missing-or-unreadable");
  assert.equal(fs.existsSync(f.marker), false);
});

test("detects workspace cache paths and symlink escapes without printing configured paths", (t) => {
  const f = fixture(t);
  assert.equal(f.inspect({ env: { ...f.env, COREPACK_HOME: path.join(f.root, "cache") } }).cache.state, "unsafe-workspace-location");
  fs.mkdirSync(path.join(f.cache, "v1/pnpm"), { recursive: true });
  fs.symlinkSync(f.root, path.join(f.cache, "v1/pnpm/12.8.1"));
  assert.equal(f.inspect().cache.state, "unsafe-cache-target");
  assert.ok(!JSON.stringify(f.inspect()).includes(f.root));
});

test("reports missing tools, invalid pins and runtime mismatch without running fallback managers", (t) => {
  const f = fixture(t);
  const report = f.inspect({ nodeVersion: "24.22.1", env: { ...f.env, PATH: "" } });
  assert.equal(report.node.matchesPin, false);
  assert.equal(report.commands.pnpm.available, false);
  assert.ok(report.findings.length >= 3);
  fs.writeFileSync(path.join(f.root, "package.json"), "{}");
  fs.writeFileSync(path.join(f.root, ".nvmrc"), "not-a-version");
  assert.equal(f.inspect().node.expected, null);
  assert.equal(f.inspect().packageManager.expected, null);
  assert.equal(fs.existsSync(f.marker), false);
});
