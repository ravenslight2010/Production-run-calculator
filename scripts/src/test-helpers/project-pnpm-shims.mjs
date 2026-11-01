import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function createFixture(t, root, version, mode) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "project-shim-race-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const workspace = path.join(parent, "workspace");
  const bin = path.join(workspace, "bin");
  const shims = path.join(workspace, ".config/npm/node_global/bin");
  const coordination = path.join(parent, "coordination");
  for (const dir of [bin, shims, coordination, path.join(parent, "home"),
    path.join(workspace, "scripts/src")]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"),
    JSON.stringify({ packageManager: `pnpm@${version}` }));
  fs.writeFileSync(path.join(workspace, "pnpm-workspace.yaml"), "packages: []\n");
  for (const name of ["configure-project-pnpm.sh", "run-project-pnpm.sh"]) {
    fs.copyFileSync(path.join(root, "scripts/src", name),
      path.join(workspace, "scripts/src", name));
  }
  const previousShim = "#!/usr/bin/env bash\nprintf 'old-system-manager\\n'\n";
  fs.writeFileSync(path.join(shims, "pnpm"), previousShim, { mode: 0o755 });
  // A broken generated shim must never escape to the host's real installer.
  fs.writeFileSync(path.join(bin, "pnpm"), `#!${process.execPath}
process.stderr.write("Fixture blocked fallback to an old system manager\\n");
process.exit(95);
`, { mode: 0o755 });
  const driver = path.join(bin, "manager-driver.cjs");
  fs.writeFileSync(driver, `#!${process.execPath}
if (process.env.COREPACK_ENABLE_STRICT !== "1" ||
    process.env.COREPACK_ENABLE_PROJECT_SPEC !== "1" ||
    process.env.COREPACK_DEFAULT_TO_LATEST !== "0") process.exit(93);
process.stdout.write(${JSON.stringify(version + "\n")});
`, { mode: 0o755 });
  // Reproduce Corepack's read/unlink/create sequence, including relative links.
  // The barrier forces both old shared-directory installers to observe the
  // previous shim before either removes it; private staging needs no lock.
  fs.writeFileSync(path.join(bin, "corepack"), `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] !== "enable" || args[1] !== "--install-directory" ||
    args[3] !== "pnpm") process.exit(94);
if (process.env.SHIM_TEST_MODE === "enable-failure") process.exit(42);
const destination = path.join(args[2], "pnpm");
const existed = fs.existsSync(destination);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (process.env.SHIM_TEST_MODE === "concurrent") {
  fs.writeFileSync(path.join(process.env.SHIM_COORDINATION, "entered-" + process.pid), "");
  const deadline = Date.now() + 5000;
  while (fs.readdirSync(process.env.SHIM_COORDINATION).length < 2) {
    if (Date.now() > deadline) throw new Error("Fixture barrier timed out");
    pause(10);
  }
}
if (existed) fs.unlinkSync(destination);
pause(75);
const target = process.env.SHIM_TEST_MODE === "dangling-link"
  ? path.join(args[2], "missing-driver") : process.env.SHIM_DRIVER;
fs.symlinkSync(path.relative(args[2], target), destination);
fs.symlinkSync(path.relative(args[2], target), path.join(args[2], "pnpx"));
`, { mode: 0o755 });
  return {
    workspace, shims, previousShim, driver,
    environment: {
      ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),
      HOME: path.join(parent, "home"),
      XDG_DATA_HOME: path.join(parent, "xdg-data"),
      XDG_CACHE_HOME: path.join(parent, "xdg-cache"),
      PNPM_HOME: path.join(parent, "pnpm-home"),
      COREPACK_HOME: path.join(parent, "corepack-cache"),
      COREPACK_ENABLE_NETWORK: "0",
      COREPACK_NPM_REGISTRY: "https://registry.npmjs.org",
      SHIM_TEST_MODE: mode,
      SHIM_COORDINATION: coordination,
      SHIM_DRIVER: driver,
      PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
    },
  };
}

function runFixture(fixture, args = ["--version"]) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["scripts/src/run-project-pnpm.sh", ...args], {
      cwd: fixture.workspace,
      env: fixture.environment,
      timeout: 10_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

export function registerProjectPnpmShimTests(root, version) {
  test("retained startup requires its regular source lockfile before bootstrap",
    async t => {
      for (const mode of ["missing", "symlink", "regular"]) {
        await t.test(mode, async subtest => {
          const fixture = createFixture(subtest, root, version, "lockfile-guard");
          const marker = path.join(fixture.workspace, "restore-called");
          fs.writeFileSync(path.join(fixture.workspace, "scripts/src/runtime-tool-cache.mjs"),
            `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(marker)}, "called");
process.exit(97);
`);
          const lockfile = path.join(fixture.workspace, "pnpm-lock.yaml");
          if (mode === "symlink") {
            const target = path.join(path.dirname(fixture.workspace), "source-lock.yaml");
            fs.writeFileSync(target, "---\nlockfileVersion: '9.0'\n");
            fs.symlinkSync(target, lockfile);
          } else if (mode === "regular") {
            fs.writeFileSync(lockfile, "---\nlockfileVersion: '9.0'\n");
          }
          const result = await runFixture(fixture,
            ["--use-retained-startup-tools", "--version"]);
          if (mode === "regular") {
            // This tests delegation, not archive verification: the verifier
            // stub deliberately stops before any manager/app can start.
            assert.equal(result.code, 97, result.stderr);
            assert.equal(fs.readFileSync(marker, "utf8"), "called");
          } else {
            assert.equal(result.code, 1, result.stderr);
            assert.match(result.stderr, /Retained startup requires a regular root pnpm-lock\.yaml/);
            assert.equal(fs.existsSync(marker), false);
          }
        });
      }
    });

  test("concurrent project launchers publish usable pnpm and pnpx shims atomically",
    { timeout: 15_000 }, async t => {
      const fixture = createFixture(t, root, version, "concurrent");
      const results = await Promise.all([runFixture(fixture), runFixture(fixture)]);
      for (const result of results) {
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.stdout.trim(), version);
      }
      for (const name of ["pnpm", "pnpx"]) {
        assert.equal(fs.realpathSync(path.join(fixture.shims, name)), fixture.driver);
      }
      assert.deepEqual(fs.readdirSync(fixture.shims).sort(), ["pnpm", "pnpx"]);
    });

  test("failed project shim preparation preserves the previous launcher and fails closed",
    async t => {
      for (const mode of ["enable-failure", "dangling-link"]) {
        await t.test(mode, async subtest => {
          const fixture = createFixture(subtest, root, version, mode);
          const result = await runFixture(fixture);
          assert.notEqual(result.code, 0);
          assert.match(result.stderr, /Cannot prepare the Corepack pnpm shim/);
          assert.doesNotMatch(result.stdout, /old-system-manager/);
          assert.equal(fs.readFileSync(path.join(fixture.shims, "pnpm"), "utf8"),
            fixture.previousShim);
          assert.deepEqual(fs.readdirSync(fixture.shims), ["pnpm"]);
        });
      }
    });
}
