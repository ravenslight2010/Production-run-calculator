import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildRuntimeToolCache, restoreRuntimeToolCache } from "./runtime-tool-cache.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-tools-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, "artifacts/api-server"), { recursive: true });
  await fs.writeFile(path.join(directory, ".nvmrc"), process.versions.node);
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({
    packageManager: "pnpm@12.8.1", engines: { node: ">=24" },
  }));
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "--version") return { stdout: "0.36.0\n" };
    if (args[0] === "pack") {
      await fs.access(path.join(options.env.COREPACK_HOME, "v1/pnpm/12.8.1", process.platform === "win32" ? "pnpm-native.exe" : "pnpm-native"));
      await fs.writeFile(args.at(-1), "SYNTHETIC-CACHE-ARCHIVE");
      return { stdout: "" };
    }
    if (args[0] === "pnpm") {
      await fs.writeFile(path.join(options.env.COREPACK_HOME, "v1/pnpm/12.8.1", process.platform === "win32" ? "pnpm-native.exe" : "pnpm-native"), "SYNTHETIC-VERIFIED-NATIVE", { mode: 0o755 });
      return { stdout: "12.8.1\n" };
    }
    if (args[0] === "install") {
      const entry = path.join(options.env.COREPACK_HOME, "v1/pnpm/12.8.1");
      await fs.mkdir(entry, { recursive: true });
      await fs.writeFile(path.join(entry, "package.json"), '{"name":"pnpm","version":"12.8.1"}');
      if (args.includes("--cache-only")) {
        await fs.writeFile(path.join(entry, process.platform === "win32" ? "pnpm-native.exe" : "pnpm-native"), "SYNTHETIC-VERIFIED-NATIVE", { mode: 0o755 });
      }
      return { stdout: "" };
    }
    throw new Error("Unexpected command");
  };
  const options = { root: directory, runner, corepackPath: "/synthetic-trusted/corepack" };
  return { root: directory, calls, options, output: path.join(directory, "artifacts/api-server/dist/runtime-tools") };
}

test("build binds a pinned archive; restore is cache-only with a private credential-free environment", async (t) => {
  const f = await fixture(t);
  const metadata = await buildRuntimeToolCache(f.options);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.calls.find((call) => call.args[0] === "pack").args.slice(0, 2), ["pack", "pnpm@12.8.1"]);
  const restored = await restoreRuntimeToolCache(f.options);
  t.after(() => fs.rm(restored.home, { recursive: true, force: true }));
  const install = f.calls.find((call) => call.args.includes("--cache-only"));
  assert.deepEqual(install.args.slice(0, 3), ["install", "--global", "--cache-only"]);
  assert.equal(install.options.env.COREPACK_ENABLE_NETWORK, "0");
  assert.equal(install.options.env.COREPACK_INTEGRITY_KEYS, undefined);
  assert.equal(install.options.env.SESSION_SECRET, undefined);
  assert.equal(path.dirname(install.args.at(-1)), restored.home);
  assert.ok(f.calls.every((call) => call.options.cwd === call.options.env.HOME));
  assert.equal(path.dirname(restored.corepackHome), restored.home);
  assert.equal((await fs.stat(restored.home)).mode & 0o777, 0o700);
});

test("rejects a changed archive before any runtime tool executes", async (t) => {
  const f = await fixture(t);
  await buildRuntimeToolCache(f.options);
  await fs.appendFile(path.join(f.output, "pnpm-cache.tgz"), "ALTERED");
  f.calls.length = 0;
  await assert.rejects(restoreRuntimeToolCache(f.options), /integrity/);
  assert.equal(f.calls.length, 0);
});

test("rejects stale pin, producer, platform and source-node metadata", async (t) => {
  const f = await fixture(t);
  const original = await buildRuntimeToolCache(f.options);
  for (const changed of [{ pnpm: "10.0.0" }, { producer: "unknown" }, { platform: "unknown" }, { buildNode: "0.0.0" }]) {
    await fs.writeFile(path.join(f.output, "manifest.json"), JSON.stringify({ ...original, ...changed }));
    const count = f.calls.length;
    await assert.rejects(restoreRuntimeToolCache(f.options), /do not match/);
    assert.equal(f.calls.length, count);
  }
});

test("does not fall back to downloads when the cache or metadata is missing", async (t) => {
  const f = await fixture(t);
  await assert.rejects(restoreRuntimeToolCache(f.options));
  assert.equal(f.calls.length, 0);
});

test("rejects a different runtime Corepack without invoking cache installation", async (t) => {
  const f = await fixture(t);
  await buildRuntimeToolCache(f.options);
  f.calls.length = 0;
  await assert.rejects(restoreRuntimeToolCache({
    ...f.options, runner: async (...args) => { f.calls.push(args); return { stdout: "0.0.0\n" }; },
  }), /Corepack differs/);
  assert.equal(f.calls.length, 1);
});

test("rejects symlinked archives", async (t) => {
  const f = await fixture(t);
  await buildRuntimeToolCache(f.options);
  const archive = path.join(f.output, "pnpm-cache.tgz");
  await fs.rename(archive, `${archive}.original`);
  await fs.symlink(`${archive}.original`, archive);
  await assert.rejects(restoreRuntimeToolCache(f.options), /unsafe/);
});

test("rejects a restored package with the wrong declared version and cleans its private cache", async (t) => {
  const f = await fixture(t);
  await buildRuntimeToolCache(f.options);
  let privateHome;
  const runner = async (command, args, options) => {
    const result = await f.options.runner(command, args, options);
    if (args[0] === "install") {
      privateHome = options.env.HOME;
      await fs.writeFile(path.join(options.env.COREPACK_HOME, "v1/pnpm/12.8.1/package.json"), '{"name":"pnpm","version":"0.0.0"}');
    }
    return result;
  };
  await assert.rejects(restoreRuntimeToolCache({ ...f.options, runner }), /version does not match/);
  await assert.rejects(fs.access(privateHome));
});

test("a failed signed-package build never seals metadata or reports raw child output", async (t) => {
  const f = await fixture(t);
  let privateHome;
  const runner = async (command, args, options) => {
    privateHome = options.env.HOME;
    if (args[0] === "pack") throw new Error("SYNTHETIC-DONT-REPORT");
    return f.options.runner(command, args, options);
  };
  await assert.rejects(buildRuntimeToolCache({ ...f.options, runner }), (error) =>
    /packaging\/restoration failed/.test(error.message) && !error.message.includes("SYNTHETIC-DONT-REPORT"));
  await assert.rejects(fs.access(path.join(f.output, "manifest.json")));
  await assert.rejects(fs.access(privateHome));
});

test("refuses to seal a dispatcher-only cache even if its version probe returns the expected pin", async (t) => {
  const f = await fixture(t);
  const runner = async (command, args, options) => {
    if (args[0] === "pnpm") return { stdout: "12.8.1\n" };
    return f.options.runner(command, args, options);
  };
  await assert.rejects(buildRuntimeToolCache({ ...f.options, runner }));
  assert.equal(f.calls.some((call) => call.args[0] === "pack"), false);
  await assert.rejects(fs.access(path.join(f.output, "manifest.json")));
});
