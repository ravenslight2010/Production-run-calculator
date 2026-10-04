import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fingerprintSource } from "./build-source-files.mjs";
import {
  EXPECTED_RECORD_PATH, PROJECT_ROOT, readBoundedJson,
  sealBuildIdentity, sourceRecordDigest, validateBuildInfo,
} from "./build-source-identity.mjs";

// Keep child output in memory only. Never inherit DB/provider/auth credentials,
// deployment labels, NODE_OPTIONS, or pnpm configuration from the workspace.
function environment(extra = {}) {
  return {
    PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
    HOME: os.tmpdir(), NODE_ENV: "production", CI: "1",
    ...extra,
  };
}

async function command(root, executable, args, { timeout = 60_000, env = {}, signal } = {}) {
  signal?.throwIfAborted();
  const child = spawn(executable, args, {
    cwd: root, env: environment(env), stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  let timedOut = false;
  let exited = false;
  const kill = () => {
    if (!exited) {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  };
  child.once("exit", () => { exited = true; });
  signal?.addEventListener("abort", kill, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeout);
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (bytes) => {
      // Bounded, transient diagnostic buffer; deliberately not emitted.
      output = (output + bytes.toString()).slice(-64 * 1024);
    });
  }
  try {
    const [code] = await once(child, "exit");
    assert.equal(timedOut, false, "fixture command exceeded its budget");
    return { code, output };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", kill);
  }
}

function isolateSources(root) {
  // Only application-owned build inputs, not .env, .git, source evidence,
  // tests, or existing application dist outputs, enter this build workspace.
  for (const file of fingerprintSource(PROJECT_ROOT).files) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(PROJECT_ROOT, file), target);
    chmodSync(target, statSync(path.join(PROJECT_ROOT, file)).mode);
  }

  // Installed third-party tools are read-only links. Rebind workspace package
  // links to the isolated library sources so bundlers never read live sources.
  function linkDependencies(relative) {
    const original = path.join(PROJECT_ROOT, relative, "node_modules");
    if (!existsSync(original)) return;
    const destination = path.join(root, relative, "node_modules");
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(original)) {
      // pnpm 12's run preflight otherwise attempts an implicit install. Copy
      // the installed-state records, never link their writable originals.
      if ([".modules.yaml", ".pnpm-workspace-state-v1.json"].includes(entry)) {
        copyFileSync(path.join(original, entry), path.join(destination, entry));
        continue;
      }
      // Vite writes compiled configs and caches inside node_modules. Never
      // link installed writable caches into a supposedly disposable build.
      if (entry.startsWith(".") && ![".bin", ".pnpm"].includes(entry)) continue;
      if (entry === "@workspace") {
        mkdirSync(path.join(destination, entry));
        for (const name of readdirSync(path.join(original, entry))) {
          const resolved = realpathSync(path.join(original, entry, name));
          const library = path.relative(PROJECT_ROOT, resolved);
          assert(library.startsWith("lib/"), "workspace dependency must be an isolated library");
          assert(existsSync(path.join(root, library, "package.json")));
          symlinkSync(path.join(root, library), path.join(destination, entry, name));
        }
      } else {
        symlinkSync(path.join(original, entry), path.join(destination, entry));
      }
    }
  }
  linkDependencies("");
  linkDependencies("artifacts/api-server");
  linkDependencies("artifacts/run-calculator");
  linkDependencies("scripts");
  for (const name of readdirSync(path.join(root, "lib"))) {
    if (existsSync(path.join(root, "lib", name, "package.json"))) linkDependencies(`lib/${name}`);
  }
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function availablePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("real API/web producers, finalized PWA and bundled public getter share one sealed identity",
  { timeout: 240_000 }, async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "build-source-integration-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    isolateSources(root);
    const api = path.join(root, "artifacts/api-server");
    const web = path.join(root, "artifacts/run-calculator");
    const apiInfo = path.join(api, "dist/build-info.json");
    const webInfo = path.join(web, "dist/public/build-info.json");
    const run = (cwd, executable, args, options = {}) =>
      command(cwd, executable, args, { ...options, signal: t.signal });

    // Prepared before any build or HTTP response; never derived from runtime.
    const preparation = await run(root, process.execPath, ["scripts/src/prepare-publish-source.mjs"]);
    assert.equal(preparation.code, 0, "real source preparation must succeed with an isolated environment");
    const expectedFile = path.join(root, EXPECTED_RECORD_PATH);
    const prepared = readBoundedJson(expectedFile);
    const expectationBytes = readFileSync(expectedFile);
    assert.equal(prepared.gitBinding, "unavailable");

    const apiBuild = await run(api, process.execPath, ["build.mjs"]);
    assert.equal(apiBuild.code, 0, "real API build must succeed");
    assert(existsSync(path.join(api, "dist/index.mjs")));
    assert.equal(existsSync(apiInfo), false, "API alone cannot acquire a release stamp");
    assert.throws(() => sealBuildIdentity(root), /Both API and web/);

    // PORT is validated by the real Vite config after --start. This forces a
    // genuine counterpart build failure without changing prepared source.
    const failedWeb = await run(web, "pnpm", ["run", "build"], { env: { PORT: "invalid" } });
    assert.notEqual(failedWeb.code, 0);
    assert(failedWeb.output.includes("Invalid PORT value"), "failure must come from the real Vite config");
    assert.equal(existsSync(path.join(web, "dist/public/build-source-part.json")), false);
    assert.equal(existsSync(apiInfo), false);
    assert.equal(existsSync(webInfo), false);
    const failedFinalizer = await run(root, process.execPath, ["scripts/src/finalize-build-identity.mjs"]);
    assert.notEqual(failedFinalizer.code, 0, "failed counterpart cannot finalize");
    assert.equal(existsSync(apiInfo), false);

    const webBuild = await run(web, "pnpm", ["run", "build"], { timeout: 120_000 });
    assert.equal(webBuild.code, 0, "real web build and workbook-boundary check must succeed");
    const sealed = validateBuildInfo(readBoundedJson(apiInfo));
    assert.deepEqual(readBoundedJson(webInfo), sealed);
    for (const key of ["appBuildId", "sourcePolicy", "sourceFingerprintSha256", "gitRevision", "gitBinding"]) {
      assert.equal(sealed[key], prepared[key]);
    }
    assert.equal(sealed.buildMode, "release");
    for (const stageFile of [path.join(api, "dist/build-source-part.json"),
      path.join(web, "dist/public/build-source-part.json")]) {
      assert.equal(sourceRecordDigest(readBoundedJson(stageFile).record), sourceRecordDigest(prepared));
    }
    assert.deepEqual(readFileSync(expectedFile), expectationBytes);
    const publicDir = path.join(web, "dist/public");
    assert(existsSync(path.join(publicDir, "index.html")));
    const manifest = JSON.parse(readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8"));
    assert(manifest.icons.length > 0);
    for (const icon of manifest.icons) assert(existsSync(path.join(publicDir, icon.src)));
    const workerFile = path.join(publicDir, "service-worker.js");
    const worker = readFileSync(workerFile, "utf8");
    assert(!worker.includes("self.__WB_MANIFEST"), "Workbox injection must be finalized");
    assert(worker.includes("index.html"), "final worker must include the application precache");
    // Prove sealing covers the final worker, not just the pre-PWA Vite output.
    writeFileSync(workerFile, `${worker}\n/* fixture mutation */\n`);
    assert.throws(() => sealBuildIdentity(root), /Compiled output changed/);
    writeFileSync(workerFile, worker);
    assert.deepEqual(sealBuildIdentity(root), sealed);

    // Disposable DB dependency: a loopback TCP listener that rejects every
    // connection. No real database, credentials, auth, migrations or jobs.
    let databaseConnections = 0;
    const database = net.createServer((socket) => {
      databaseConnections += 1;
      socket.destroy();
    });
    const databasePort = await listen(database);
    t.after(() => new Promise((resolve) => database.close(resolve)));
    const apiPort = await availablePort();
    const runtime = spawn(process.execPath, ["dist/index.mjs"], {
      cwd: api, detached: true, stdio: ["ignore", "ignore", "ignore"],
      env: environment({
        PORT: String(apiPort), DATABASE_URL: `postgresql://fixture:fixture@127.0.0.1:${databasePort}/fixture`,
        SESSION_SECRET: "isolated-build-fixture-only-not-a-real-secret",
        GIT_SHA: "f".repeat(40), VITE_APP_VERSION: "fixture-runtime-label",
      }),
    });
    let runtimeExited = false;
    runtime.once("exit", () => { runtimeExited = true; });
    t.after(async () => {
      if (runtimeExited) return;
      const stopped = once(runtime, "exit");
      process.kill(-runtime.pid, "SIGTERM");
      const killTimer = setTimeout(() => {
        if (!runtimeExited) process.kill(-runtime.pid, "SIGKILL");
      }, 6000);
      try { await stopped; } finally { clearTimeout(killTimer); }
    });
    const url = `http://127.0.0.1:${apiPort}`;
    let degraded = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      assert.equal(runtimeExited, false, "bundled API must remain listening with failed database startup");
      try {
        const response = await fetch(`${url}/api/readyz`, { signal: AbortSignal.timeout(500) });
        const body = await response.json();
        if (response.status === 503 && body.startup?.errorCode === "database_schema_failed") {
          degraded = true;
          break;
        }
      } catch { /* local process may not have opened its port yet */ }
      await delay(100);
    }
    assert(degraded, "fixture must demonstrate failed DB startup before testing metadata");
    assert(databaseConnections > 0);
    const connectionsBeforeMetadata = databaseConnections;
    const response = await fetch(`${url}/api/build-info`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200, "bundled public getter must bypass authentication and readiness");
    assert(response.headers.get("cache-control")?.split(",").map((part) => part.trim()).includes("no-store"));
    assert.deepEqual(await response.json(), sealed);

    // Actual getter loads once, rather than relabeling an artifact after edits.
    const sealedBytes = readFileSync(apiInfo);
    writeFileSync(apiInfo, "{}\n");
    const second = await fetch(`${url}/api/build-info`, { signal: AbortSignal.timeout(2000) });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), sealed);
    writeFileSync(apiInfo, sealedBytes);

    const receiptFile = path.join(root, ".local/fixture-source-match.json");
    const cli = await run(root, "pnpm", ["run", "check:published-build", "--",
      "--url", url, "--expected-file", expectedFile, "--output", receiptFile]);
    assert.equal(cli.code, 0, "documented CLI must match independently prepared expectation");
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    assert.equal(receipt.status, "source-match");
    assert.equal(receipt.productionGo, false);
    assert.equal(receipt.authority, "application-source-comparison-only");
    assert.equal(receipt.expectedRecordSha256, sourceRecordDigest(prepared));
    assert.equal(receipt.appBuildId, prepared.appBuildId);
    assert.equal(receipt.sourceFingerprintSha256, prepared.sourceFingerprintSha256);
    assert.equal(receipt.gitRevision, null);
    assert.equal(receipt.gitBinding, "unavailable");
    assert.deepEqual(receipt.unresolvedIdentityRequirements,
      ["controlled-published-deployment-handoff"]);
    assert.equal(Date.parse(receipt.expiresAt) - Date.parse(receipt.capturedAt), 86_400_000);
    assert.deepEqual(readFileSync(expectedFile), expectationBytes);
    assert(!JSON.stringify(receipt).includes(url));
    assert.equal(databaseConnections, connectionsBeforeMetadata,
      "public metadata requests and CLI must not acquire a database connection");

    // Only these allowlisted fixture outcomes reach retained release logs.
    t.diagnostic(JSON.stringify({
      environment: "isolated-fixture", apiBuild: "pass", webBuild: "pass",
      finalizedPwa: "pass", missingCounterpart: "blocked", failedCounterpart: "blocked",
      bundledPublicGetter: "pass", metadataDatabaseConnections: 0,
      cliSourceMatch: "pass", productionGo: false,
    }));
  });