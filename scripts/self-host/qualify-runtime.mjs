// Disposable Linux Docker qualification, not a customer installer/updater.
// No host DB/ports/volumes, production data, model pull or WAN at runtime.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PROJECT_ROOT } from "../src/build-source-identity.mjs";
import { createEnvironment } from "./config.mjs";
const prefix = `fresh-qualification-${randomUUID()}`;
const directory = mkdtempSync(path.join(tmpdir(), prefix));
const network = `${prefix}-lan`,
  db = `${prefix}-db`,
  api = `${prefix}-api`;
const envFile = path.join(directory, "fixture.env");
const images = Object.fromEntries(
  ["api", "web", "migrate"].map((role) => [role, `${prefix}:${role}`]),
);
let privateValues = [];
function docker(args, { quiet = true, tolerate = false } = {}) {
  const result = spawnSync("docker", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
    timeout: 20 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 && !tolerate) {
    // Only disposable-fixture diagnostics; redact all generated secret values.
    let detail = String(result.stderr ?? "");
    for (const value of privateValues)
      detail = detail.split(value).join("[redacted]");
    detail = detail
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[redacted-db-url]")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
    if (quiet) console.error(detail.slice(-2500).replace(/::/g, ": :"));
    throw new Error(`Docker qualification step failed: ${args[0]}`);
  }
  return result;
}
const execApi = (code) =>
  docker([
    "exec",
    api,
    "node",
    "--input-type=module",
    "-e",
    code,
  ]).stdout.trim();
const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));
async function ready() {
  for (let i = 0; i < 180; i++) {
    const result = docker(
      [
        "exec",
        api,
        "node",
        "-e",
        'fetch("http://127.0.0.1:5000/api/readyz").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))',
      ],
      { tolerate: true },
    );
    if (result.status === 0) return;
    await pause();
  }
  throw new Error("Fresh core did not become ready without AI/WAN");
}
try {
  assert.equal(
    process.argv.length,
    2,
    "No caller-selected images, DB or commands accepted",
  );
  // Pull only during explicit preparation; the runtime network below is internal.
  console.log("Preparing disposable fresh qualification images");
  docker(["pull", "postgres:16-alpine"], { quiet: false });
  for (const role of ["api", "web", "migrate"])
    docker(
      [
        "build",
        "-f",
        "Dockerfile.self-host",
        "--target",
        `self-host-${role}`,
        "-t",
        images[role],
        ".",
      ],
      { quiet: false },
    );
  const environment = createEnvironment({
    site: "qualification.test.lan",
    timeZone: "America/Chicago",
    manager: "qualification_manager",
  }).replace("@db:5432/", `@${db}:5432/`);
  privateValues = environment
    .split("\n")
    .filter((line) =>
      /^(?:POSTGRES_PASSWORD|DATABASE_URL|AUTH_TOKEN_SECRET|STAFF_SIGNUP_CODE|INITIAL_MANAGER_ACCESS_CODE)=/.test(
        line,
      ),
    )
    .map((line) => line.slice(line.indexOf("=") + 1))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  writeFileSync(envFile, environment, { mode: 0o600 });
  docker(["network", "create", "--internal", network]);
  docker([
    "run",
    "-d",
    "--name",
    db,
    "--network",
    network,
    "--env-file",
    envFile,
    "postgres:16-alpine",
  ]);
  let databaseReady = false;
  for (let i = 0; i < 60; i++) {
    if (
      docker(
        ["exec", db, "pg_isready", "-U", "runcalc_user", "-d", "runcalc"],
        { tolerate: true },
      ).status === 0
    ) {
      databaseReady = true;
      break;
    }
    await pause();
  }
  assert.ok(databaseReady, "Disposable DB readiness");
  docker([
    "run",
    "--rm",
    "--network",
    network,
    "--env-file",
    envFile,
    images.migrate,
  ]);
  docker([
    "run",
    "-d",
    "--name",
    api,
    "--network",
    network,
    "--env-file",
    envFile,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    images.api,
  ]);
  await ready();
  const probe = `
    import assert from 'node:assert/strict';
    const base='http://127.0.0.1:5000/api';
    const info=await fetch(base+'/build-info').then(r=>{assert.equal(r.status,200);return r.json()});
    assert.equal(info.buildMode,'self-host-fresh'); assert.equal(info.sourcePolicy,'self-host-fresh-source-v1');
    assert.equal(info.platformIdentitySource,'unavailable');
    for(const endpoint of ['capture','diagnostics']) for(const method of ['GET','POST','PUT','DELETE','OPTIONS','HEAD']) {
      const response=await fetch(base+'/profile-data/source-library-reconciliation/'+endpoint,{method});
      assert.equal(response.status,409);
      assert.ok(response.headers.get('cache-control')?.split(',').map(value=>value.trim()).includes('no-store'));
      if(method!=='HEAD') assert.deepEqual(await response.json(),{status:'not-applicable',buildProfile:'self-host-fresh',reason:'legacy-production-audit-not-packaged'});
    }
    const response=await fetch(base+'/auth/sign-up',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'qualification_manager',password:'Disposable-test-password-123',accessCode:process.env.INITIAL_MANAGER_ACCESS_CODE})});
    assert.equal(response.status,201); const session=await response.json();
    const headers={Authorization:'Bearer '+session.token};
    const workspaceResponse=await fetch(base+'/profile-data/health-workspace',{headers});
    assert.equal(workspaceResponse.status,200); const workspace=await workspaceResponse.json();
    assert.deepEqual(workspace.workspace.sourceReconciliation,{status:'not-applicable',buildProfile:'self-host-fresh',reason:'legacy-production-audit-not-packaged',findings:[]});
    // No historical uploaded assets, source checkout, report/approval files or maps in the runtime dist.
    const fs=await import('node:fs');
    for(const name of ['attached_assets','docs','scripts','.git','.env']) assert.equal(fs.existsSync('/app/'+name),false);
    const files=fs.readdirSync('/app/artifacts/api-server/dist',{recursive:true});
    assert.equal(files.some(name=>/approval|reconciliation.*json|\\.map$/.test(name)),false);
    console.log(JSON.stringify({appBuildId:info.appBuildId,sourceFingerprintSha256:info.sourceFingerprintSha256}));
  `;
  console.log(
    "Probing fresh readiness, identity, signup, workspace and package privacy",
  );
  const identity = JSON.parse(execApi(probe));
  const markerCount = () =>
    docker([
      "exec",
      db,
      "psql",
      "-U",
      "runcalc_user",
      "-d",
      "runcalc",
      "-Atc",
      "SELECT count(*) FROM data_heals;",
    ]).stdout.trim();
  assert.equal(
    markerCount(),
    "0",
    "Fresh startup must not claim legacy heal markers",
  );
  console.log("Testing cached offline API restart");
  docker(["restart", api]);
  await ready();
  const after = JSON.parse(
    execApi(
      'console.log(JSON.stringify(await fetch("http://127.0.0.1:5000/api/build-info").then(r=>r.json())))',
    ),
  );
  assert.equal(after.appBuildId, identity.appBuildId);
  assert.equal(after.sourceFingerprintSha256, identity.sourceFingerprintSha256);
  assert.equal(
    markerCount(),
    "0",
    "Cached offline restart must not manufacture legacy markers",
  );
  console.log(
    "PASS: fresh schema, core readiness without WAN/AI, manager signup/workspace, capture refusal, runtime privacy and cached API restart.",
  );
  console.log(
    "NOT ASSESSED: Windows Docker/WSL2, LAN CA/device trust, physical devices, imports, load, backup/restore or updater.",
  );
} catch (error) {
  // Never print raw Docker output, generated environment, DB URL or auth payload.
  console.error(
    error instanceof Error
      ? error.message.replace(/[^A-Za-z0-9_ .:/,()=-]/g, "_").slice(0, 300)
      : "Fresh qualification failed",
  );
  process.exitCode = 1;
} finally {
  for (const name of [api, db])
    docker(["rm", "-f", "-v", name], { tolerate: true });
  docker(["network", "rm", network], { tolerate: true });
  for (const image of Object.values(images))
    docker(["image", "rm", image], { tolerate: true });
  rmSync(directory, { recursive: true, force: true });
}
