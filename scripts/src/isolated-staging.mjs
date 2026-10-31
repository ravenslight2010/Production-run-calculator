import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { appendFileSync, openSync, closeSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createInterface } from "node:readline";
import { fingerprintSource } from "./build-source-files.mjs";
import { validateBuildInfo, writeRecord } from "./build-source-identity.mjs";
import { assertStageIdentity, assertStageApp, digest, stageEnvironment } from "./staging/identity.mjs";
import { seed, auditInventory } from "./staging/inventory-audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mode = process.argv[2] ?? "check";
assert(["check", "serve"].includes(mode) && process.argv.length <= 3,
  "Usage: node scripts/src/isolated-staging.mjs [check|serve]; target overrides are forbidden.");
assert(!process.env.REPLIT_DEPLOYMENT_ID && !/^(1|true|yes)$/i.test(process.env.REPLIT_DEPLOYMENT ?? ""),
  "Refusing to run inside a published deployment.");
const env = stageEnvironment(process.env);
const runId = randomBytes(16).toString("hex");
const databasePassword = randomBytes(32).toString("hex");
const parent = path.join(root, ".local/isolated-staging");
await mkdir(parent, { recursive: true, mode: 0o700 });
assert.equal(await realpath(parent), parent, "Staging root cannot be a symlink.");
const directory = await mkdtemp(path.join(parent, "run-"));
const log = openSync(path.join(directory, "private-runtime.log"), "a", 0o600);
const record = { kind: "isolated-local-staging", runId, database: `stage_${runId}`,
  host: "127.0.0.1", dataDirectory: path.join(directory, "pg"), directory };
await writeFile(path.join(directory, "owner.json"), JSON.stringify({ kind: record.kind, runId }), { mode: 0o600 });
const report = { schemaVersion: 1, target: "isolated-local-staging", runId,
  startedAt: new Date().toISOString(), status: "NOT REACHED", results: [],
  publishedProduction: "NOT REACHED: independent published-target acceptance remains unverified.",
  verificationScope: "Real local API/database; not browser offline, physical device, or published runtime proof." };
const reportPath = path.join(parent, "reports", `${runId}.json`);
const saveReport = () => writeRecord(reportPath, report);
let app;
let activeCommand;
let interrupted = false;
let pgInitialized = false;
let phase = "initialization";
const abort = () => {
  interrupted = true;
  if (activeCommand?.pid) process.kill(-activeCommand.pid, "SIGTERM");
};
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

async function command(bin, args, additions = {}, cwd = root, timeout = 300_000) {
  assert(!interrupted, "Staging run interrupted.");
  const child = spawn(bin, args, { cwd, env: { ...env, ...additions }, detached: true, stdio: ["ignore", log, log] });
  activeCommand = child;
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.pid) process.kill(-child.pid, "SIGKILL");
  }, timeout);
  try {
    const [code, signal] = await once(child, "exit");
    assert.equal(code, 0, `Staging command failed (${path.basename(bin)}, ${signal ?? code}); private log retained until cleanup.`);
  } finally {
    clearTimeout(timer);
    activeCommand = undefined;
  }
}
async function port() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const number = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return number;
}
async function query(sql, params = [], admin = false) {
  const client = new pg.Client({ host: record.host, port: record.port,
    user: "postgres", password: databasePassword,
    database: admin ? "postgres" : record.database, connectionTimeoutMillis: 2000 });
  await client.connect();
  try { return await client.query(sql, params); }
  finally { await client.end(); }
}
async function assertOwnership() {
  assert.equal(await realpath(directory), directory);
  assert.equal((await stat(directory)).mode & 0o077, 0);
  const owner = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8"));
  assert.deepEqual(owner, { kind: "isolated-local-staging", runId });
  assert.equal(record.directory, directory);
  assert.equal(record.dataDirectory, path.join(directory, "pg"));
  assert.equal(record.host, "127.0.0.1");
  assert.equal(record.database, `stage_${runId}`);
}
async function assertBuild() {
  assert.deepEqual(validateBuildInfo(JSON.parse(await readFile(path.join(directory, "api/build-info.json"), "utf8"))), record.build);
  assert.equal(digest(await readFile(path.join(directory, "api/index.mjs"))), record.apiSha256);
  assert.equal(digest(await readFile(path.join(directory, "artifacts/run-calculator/dist/public/index.html"))), record.webSha256);
}
async function clusterIdentity() {
  await assertOwnership();
  const { rows: [row] } = await query(`SELECT system_identifier::text AS "systemIdentifier",
    current_setting('data_directory') AS "dataDirectory", inet_server_port() AS port,
    current_user AS owner FROM pg_control_system()`, [], true);
  assert.equal(row.systemIdentifier, record.systemIdentifier);
  assert.equal(row.dataDirectory, record.dataDirectory);
  assert.equal(row.port, record.port);
  assert.equal(row.owner, "postgres");
}
async function preflight(served = true) {
  await clusterIdentity();
  await assertBuild();
  const { rows: [row] } = await query(`SELECT current_database() AS database,
    host(inet_server_addr()) AS host, inet_server_port() AS port, current_user AS owner,
    current_setting('data_directory') AS "dataDirectory",
    (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`);
  const dbOwner = JSON.parse((await query("SELECT shobj_description(oid,'pg_database') AS owner FROM pg_database WHERE datname=current_database()")).rows[0].owner);
  assertStageIdentity(record, { ...row, runId: dbOwner.runId });
  if (served) {
    assert(app?.pid && app.exitCode === null && app.signalCode === null, "Owned app process is not alive.");
    const response = await fetch(`${record.appUrl}/api/build-info`, { redirect: "error", signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assertStageApp(record, { ...await response.json(), runId: response.headers.get("x-isolated-staging-run") });
    const web = await fetch(record.appUrl, { redirect: "error", signal: AbortSignal.timeout(5000) });
    assert.equal(web.status, 200);
    assert.equal(web.headers.get("x-isolated-staging-run"), runId);
    assert.equal(digest(Buffer.from(await web.arrayBuffer())), record.webSha256);
  }
}
async function stopApp() {
  if (!app || app.exitCode !== null || app.signalCode !== null) return;
  const child = app;
  const ended = once(child, "exit");
  process.kill(-child.pid, "SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGKILL");
  }, 8000);
  try { await ended; } finally { clearTimeout(timer); }
  assert(child.exitCode !== null || child.signalCode !== null);
  app = undefined;
}
async function assertPortClosed(number) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: number });
    socket.setTimeout(2000);
    socket.once("connect", () => { socket.destroy(); reject(new Error("An owned staging port is still listening.")); });
    socket.once("timeout", () => { socket.destroy(); reject(new Error("Staging port closure is ambiguous.")); });
    socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolve() : reject(error));
  });
}
const secret = () => randomBytes(24).toString("base64url");
let credentials;
function newCredentials() {
  credentials = { managerCode: secret(), staffCode: secret(), sessionSecret: secret(),
    manager: { username: `stage_manager_${runId.slice(0, 8)}`, password: secret() },
    operator: { username: `stage_operator_${runId.slice(0, 8)}`, password: secret() } };
  stage.credentials = credentials;
}
async function startApp() {
  await preflight(false);
  app = spawn(process.execPath, ["--require", path.join(root, "scripts/src/staging/network.cjs"),
    path.join(directory, "api/index.mjs")], { cwd: directory, detached: true,
    env: { ...env, NODE_ENV: "production", APP_ENV: "isolated-staging",
      PORT: String(record.appPort), DATABASE_URL: record.databaseUrl, PGAPPNAME: `stage-${runId}`,
      DATABASE_POOL_MAX: "8", DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS: "1",
      STAGING_RUN_ID: runId, SESSION_SECRET: credentials.sessionSecret,
      STAFF_SIGNUP_CODE: credentials.staffCode,
      INITIAL_MANAGER_USERNAME: credentials.manager.username, INITIAL_MANAGER_ACCESS_CODE: credentials.managerCode },
    stdio: ["ignore", log, log] });
  app.on("error", () => { interrupted = true; });
  await writeFile(path.join(directory, "identity.json"), JSON.stringify({
    kind: record.kind, runId, directory, dataDirectory: record.dataDirectory,
    systemIdentifier: record.systemIdentifier, database: record.database,
    appPid: app.pid, runnerPid: process.pid, apiSha256: record.apiSha256,
    build: record.build,
  }), { mode: 0o600 });
  saveReport();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !interrupted) {
    assert(app.exitCode === null && app.signalCode === null, "Isolated app exited during startup.");
    try {
      const response = await fetch(`${record.appUrl}/api/readyz`, { redirect: "error", signal: AbortSignal.timeout(2000) });
      if (response.status === 200) {
        await preflight();
        return;
      }
    } catch (error) {
      // Connection refusal is expected only while our own process is starting.
      if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Isolated app did not become ready within its deadline.");
}
const stage = {
  credentials: null, query, preflight,
  record(check, role, status) {
    report.results.push({ check, role, status });
    saveReport();
  },
  async api(route, body, token, status, method = "POST") {
    await preflight();
    assert(route.startsWith("/") && !route.includes("://"));
    const response = await fetch(`${record.appUrl}/api${route}`, { method, redirect: "error",
      signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `Unexpected HTTP result for ${method} ${route}.`);
    return response.status === 204 ? null : response.json();
  },
  async restart() { await preflight(); await stopApp(); await startApp(); },
};
let bin;
async function createDatabase() {
  await clusterIdentity();
  await assertBuild();
  // Names are generated internally and validated, not supplied by CLI/env.
  assert.match(record.database, /^stage_[a-f0-9]{32}$/);
  await query(`CREATE DATABASE "${record.database}"`, [], true);
  await query(`COMMENT ON DATABASE "${record.database}" IS '${JSON.stringify({ runId })}'`, [], true);
  await preflight(false);
  await command("pnpm", ["--filter", "@workspace/db", "run", "push-force"], { DATABASE_URL: record.databaseUrl });
}
async function reset() {
  await preflight();
  await stopApp();
  await preflight(false);
  await query(`DROP DATABASE "${record.database}"`, [], true);
  await createDatabase();
  newCredentials();
  await startApp();
  const counts = await query("SELECT (SELECT count(*) FROM inventory_items)::int AS items, (SELECT count(*) FROM users)::int AS users");
  assert.deepEqual(counts.rows[0], { items: 0, users: 0 });
  stage.record("reset-empty-synthetic-database", "stage-runner", "PASS");
  await seed(stage);
  await writeAccess();
}
async function writeAccess() {
  await writeFile(path.join(directory, "access.json"), JSON.stringify({
    appUrl: record.appUrl, runId, manager: credentials.manager, operator: credentials.operator,
  }), { mode: 0o600 });
}
try {
  phase = "build";
  const source = fingerprintSource(root).sourceFingerprintSha256;
  await command("pnpm", ["--filter", "@workspace/api-server", "run", "build"]);
  await command("pnpm", ["--filter", "@workspace/run-calculator", "run", "build"]);
  assert.equal(fingerprintSource(root).sourceFingerprintSha256, source, "Source changed during staging build.");
  await mkdir(path.join(directory, "api"));
  // Only executable source outputs + identity are copied. No source reconciliation
  // reports, operational captures, databases, .env files or secrets are copied.
  for (const name of await readdir(path.join(root, "artifacts/api-server/dist"))) {
    if (/\.(mjs|js|map)$/.test(name) || name === "build-info.json")
      await cp(path.join(root, "artifacts/api-server/dist", name), path.join(directory, "api", name));
  }
  // Preserve external package resolution without copying dependencies, .env
  // files, reports or credentials. This link contains installed product code.
  await symlink(path.join(root, "artifacts/api-server/node_modules"), path.join(directory, "node_modules"), "dir");
  await cp(path.join(root, "artifacts/run-calculator/dist/public"), path.join(directory, "artifacts/run-calculator/dist/public"), { recursive: true });
  record.build = validateBuildInfo(JSON.parse(await readFile(path.join(directory, "api/build-info.json"), "utf8")));
  assert.equal(record.build.sourceFingerprintSha256, source);
  const webPart = JSON.parse(await readFile(path.join(root, "artifacts/run-calculator/dist/public/build-source-part.json"), "utf8"));
  assert.equal(webPart.record.sourceFingerprintSha256, source);
  record.webSha256 = digest(await readFile(path.join(directory, "artifacts/run-calculator/dist/public/index.html")));
  report.webBuild = { appBuildId: webPart.record.appBuildId,
    sourceFingerprintSha256: source, indexSha256: record.webSha256 };
  record.apiSha256 = digest(await readFile(path.join(directory, "api/index.mjs")));
  report.source = { gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, env, encoding: "utf8" }).trim(),
    gitBinding: record.build.gitBinding, sourceFingerprintSha256: source };
  report.build = record.build;
  phase = "cluster-setup";
  bin = path.dirname(execFileSync("which", ["postgres"], { env, encoding: "utf8" }).trim());
  record.port = await port();
  record.appPort = await port();
  assert.notEqual(record.port, record.appPort);
  record.appUrl = `http://127.0.0.1:${record.appPort}`;
  record.databaseUrl = `postgresql://postgres:${databasePassword}@127.0.0.1:${record.port}/${record.database}`;
  await assertOwnership();
  await assertBuild();
  const passwordFile = path.join(directory, "postgres-password");
  await writeFile(passwordFile, `${databasePassword}\n`, { mode: 0o600 });
  await command(path.join(bin, "initdb"), ["-D", record.dataDirectory, "-U", "postgres",
    "--auth-local=trust", "--auth-host=scram-sha-256", "--pwfile", passwordFile, "--no-locale"]);
  await rm(passwordFile);
  pgInitialized = true;
  const control = execFileSync(path.join(bin, "pg_controldata"), [record.dataDirectory], { env, encoding: "utf8" });
  record.systemIdentifier = control.match(/Database system identifier:\s+(\d+)/)?.[1];
  assert.match(record.systemIdentifier ?? "", /^\d{15,25}$/);
  await mkdir(path.join(directory, "socket"), { mode: 0o700 });
  await command(path.join(bin, "pg_ctl"), ["-D", record.dataDirectory, "-l", path.join(directory, "postgres.log"),
    "-o", `-F -p ${record.port} -h 127.0.0.1 -k ${directory}/socket`, "-w", "start"]);
  await createDatabase();
  newCredentials();
  phase = "app-start";
  await startApp();
  report.targetIdentity = { appUrl: record.appUrl, databaseName: record.database,
    systemIdentifier: record.systemIdentifier, appRunId: runId };
  stage.record("independent-app-and-cluster-preflight", "stage-runner", "PASS");
  phase = "seed";
  await seed(stage);
  await writeAccess();
  phase = "inventory-audit";
  await auditInventory(stage);
  phase = "reset";
  await reset();
  report.auditStatus = "PASS";
  saveReport();
  if (mode === "serve") {
    console.log(`Isolated staging ready at ${record.appUrl}`);
    console.log(`Stage-only access file: ${path.relative(root, directory)}/access.json (private; do not paste into chat).`);
    console.log(`Enter r to reset; Ctrl-C or SIGTERM to runner PID ${process.pid} cleans up this sandbox.`);
    const input = createInterface({ input: process.stdin });
    const stop = () => input.close();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    for await (const line of input) {
      if (line.trim() === "r") {
        phase = "interactive-reset";
        await reset();
        console.log("Synthetic staging reset completed.");
      }
    }
    if (!interrupted && !process.stdin.isTTY) {
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }
  }
} catch (error) {
  appendFileSync(log, `\nStaging failure (${phase}): ${error instanceof Error ? error.stack : "Non-error failure"}\n`);
  report.status = "FAIL";
  report.results.push({ check: phase, role: "stage-runner", status: "FAIL" });
  console.error(`Isolated staging failed during ${phase}; no alternate target was used.`);
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  try {
    await stopApp();
    await assertOwnership();
    if (pgInitialized) {
      // Never delete a cluster directory until pg_ctl confirms it is stopped.
      const control = execFileSync(path.join(bin, "pg_controldata"), [record.dataDirectory], { env, encoding: "utf8" });
      assert.equal(control.match(/Database system identifier:\s+(\d+)/)?.[1], record.systemIdentifier);
      const status = spawn(path.join(bin, "pg_ctl"), ["-D", record.dataDirectory, "status"], { env, stdio: ["ignore", log, log] });
      const [code] = await once(status, "exit");
      if (code === 0) {
        // Cleanup must run even after an interrupt; no API/data mutation follows.
        interrupted = false;
        await command(path.join(bin, "pg_ctl"), ["-D", record.dataDirectory, "-m", "immediate", "-w", "stop"]);
      } else assert.equal(code, 3, "Unknown PostgreSQL status; private directory retained.");
      const stopped = spawn(path.join(bin, "pg_ctl"), ["-D", record.dataDirectory, "status"], { env, stdio: ["ignore", log, log] });
      assert.equal((await once(stopped, "exit"))[0], 3);
    }
    if (record.appPort) await assertPortClosed(record.appPort);
    if (record.port) await assertPortClosed(record.port);
    if (report.status === "FAIL") {
      await mkdir(path.join(parent, "reports"), { mode: 0o700, recursive: true });
      await cp(path.join(directory, "private-runtime.log"), path.join(parent, "reports", `${runId}.private.log`));
    }
    closeSync(log);
    await rm(directory, { recursive: true });
    stage.record("owned-app-cluster-and-fixture-cleanup", "stage-runner", "PASS");
    if (report.status !== "FAIL") report.status = "PASS";
  } catch {
    report.status = "FAIL";
    stage.record("owned-app-cluster-and-fixture-cleanup", "stage-runner", "FAIL");
    console.error("Cleanup could not be proved; private runtime directory was preserved. Do not reuse it as staging.");
    process.exitCode = 1;
  }
  report.completedAt = new Date().toISOString();
  await mkdir(path.join(parent, "reports"), { mode: 0o700, recursive: true });
  saveReport();
  console.log(`Staging ${report.status}: ${path.relative(root, reportPath)}`);
}
