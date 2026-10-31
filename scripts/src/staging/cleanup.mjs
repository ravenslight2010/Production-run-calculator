import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, stageEnvironment } from "./identity.mjs";
import { validateBuildInfo } from "../build-source-identity.mjs";

// Recovery after a tool/OS forcibly kills the runner. Never accepts a database
// URL, database name, PID, or arbitrary data-directory override.
export async function cleanupOwnedStage(requestedDirectory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const parent = path.join(root, ".local/isolated-staging");
  const directory = path.resolve(root, requestedDirectory);
  assert.equal(path.dirname(directory), parent);
  assert.match(path.basename(directory), /^run-[A-Za-z0-9]{6}$/);
  assert.equal(await realpath(directory), directory);
  assert.equal((await stat(directory)).mode & 0o077, 0);
  const owner = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8"));
  const identity = JSON.parse(await readFile(path.join(directory, "identity.json"), "utf8"));
  assert.equal(identity.kind, "isolated-local-staging");
  assert.match(identity.runId, /^[a-f0-9]{32}$/);
  assert.deepEqual(owner, { kind: identity.kind, runId: identity.runId });
  assert.equal(identity.directory, directory);
  assert.equal(identity.dataDirectory, path.join(directory, "pg"));
  assert.equal(identity.database, `stage_${identity.runId}`);
  const build = validateBuildInfo(JSON.parse(await readFile(path.join(directory, "api/build-info.json"), "utf8")));
  assert.deepEqual(build, identity.build);
  assert.equal(build.buildMode, "development");
  assert.equal(digest(await readFile(path.join(directory, "api/index.mjs"))), identity.apiSha256);
  const env = stageEnvironment(process.env);
  const bin = path.dirname(execFileSync("which", ["postgres"], { env, encoding: "utf8" }).trim());
  const control = execFileSync(path.join(bin, "pg_controldata"), [identity.dataDirectory], { env, encoding: "utf8" });
  assert.equal(control.match(/Database system identifier:\s+(\d+)/)?.[1], identity.systemIdentifier);
  const reportPath = path.join(parent, "reports", `${identity.runId}.json`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.runId, identity.runId);
  const alive = (pid) => {
    assert(Number.isInteger(pid) && pid > 1);
    try {
      process.kill(pid, 0);
      // Orphans can remain as zombies until PID 1 reaps them. They execute no
      // code, own no connections, and cannot be terminated again.
      const state = readFileSync(`/proc/${pid}/stat`, "utf8");
      return state.slice(state.lastIndexOf(")") + 2, state.lastIndexOf(")") + 3) !== "Z";
    } catch (error) {
      if (error.code === "ESRCH" || error.code === "ENOENT") return false;
      throw error;
    }
  };
  assert(!alive(identity.runnerPid), "Runner is alive; send SIGTERM to that runner instead.");
  if (alive(identity.appPid)) {
    const args = (await readFile(`/proc/${identity.appPid}/cmdline`, "utf8")).split("\0");
    assert(args.includes(path.join(directory, "api/index.mjs")), "App PID identity is ambiguous.");
    process.kill(identity.appPid, "SIGTERM");
    for (let i = 0; i < 80 && alive(identity.appPid); i++) {
      if (i === 50) process.kill(identity.appPid, "SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(!alive(identity.appPid), "Owned app did not stop; directory retained.");
  }
  const status = () => spawnSync(path.join(bin, "pg_ctl"),
    ["-D", identity.dataDirectory, "status"], { env, stdio: "ignore", timeout: 5000 }).status;
  const code = status();
  if (code === 0) {
    const pid = Number((await readFile(path.join(identity.dataDirectory, "postmaster.pid"), "utf8")).split("\n")[0]);
    assert(alive(pid));
    const args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
    assert(args.includes(identity.dataDirectory), "PostgreSQL PID identity is ambiguous.");
    execFileSync(path.join(bin, "pg_ctl"), ["-D", identity.dataDirectory, "-m", "immediate", "-w", "stop"],
      { env, stdio: "ignore", timeout: 15000 });
  } else assert.equal(code, 3);
  assert.equal(status(), 3);
  await rm(directory, { recursive: true });
  report.results.push({ check: "forced-stop-owned-resource-recovery", role: "stage-runner", status: "PASS" });
  report.cleanupRecoveryAt = new Date().toISOString();
  // A forced stop is not a passing normal exit or a completed audit.
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 3, "Supply exactly one private stage run-directory.");
    assert(!process.env.REPLIT_DEPLOYMENT_ID && !/^(1|true|yes)$/i.test(process.env.REPLIT_DEPLOYMENT ?? ""));
    await cleanupOwnedStage(process.argv[2]);
    console.log("Verified orphaned staging app/cluster/fixtures removed; no shared target was used.");
  } catch {
    console.error("Staging recovery refused ambiguous ownership or could not finish. No alternate target was used.");
    process.exitCode = 1;
  }
}
