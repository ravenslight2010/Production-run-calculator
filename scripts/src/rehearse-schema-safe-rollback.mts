import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const rootDir = new URL("../../", import.meta.url).pathname;
let timeoutMs = 180_000;
const buildNetwork = process.env.ROLLBACK_REHEARSAL_BUILD_NETWORK
  ?? (process.platform === "linux" ? "host" : "default");
const suppliedDatabaseUrl = Object.hasOwn(process.env, "DATABASE_URL");
const currentRevision = gitOrUnavailable(["rev-parse", "HEAD"]);
const parentRevision = gitOrUnavailable(["rev-parse", "HEAD^"]);
const suffix = `${process.pid}-${Date.now()}`;
const resourcePrefix = `runcalc-rollback-${suffix}`;
const network = `${resourcePrefix}-net`;
const volume = `${resourcePrefix}-pgdata`;
const database = `${resourcePrefix}-db`;
const runtime = `${resourcePrefix}-runtime`;
const parentContext = mkdtempSync(join(tmpdir(), `${resourcePrefix}-parent-`));
const currentContext = mkdtempSync(join(tmpdir(), `${resourcePrefix}-current-`));
const schemaContext = mkdtempSync(join(tmpdir(), `${resourcePrefix}-schema-`));
const currentTag = `runcalc-rollback-api:${currentRevision.slice(0, 12)}-${suffix}`;
const parentTag = `runcalc-rollback-api:${parentRevision.slice(0, 12)}-${suffix}`;
const migrationTag = `runcalc-rollback-migrate:${currentRevision.slice(0, 12)}-${suffix}`;
const reportPath = process.env.ROLLBACK_REHEARSAL_REPORT ?? join(rootDir, "rollback-rehearsal-report.md");
const dbUser = "rollback";
const dbPassword = "rollback-disposable-password";
const dbName = "rollback";
let currentImageId = "not built";
let parentImageId = "not built";
let migrationImageId = "not built";
let migrationResult = "not run";
let currentChecks = "not run";
let rollbackChecks = "not run";
let beforeSchema = "not captured";
let currentSchema = "not captured";
let afterSchema = "not captured";
let schemaDifference = "";
let failure = "";
let cleaned = false;
let parentWorktreeAdded = false;
let currentWorktreeAdded = false;

function duration(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000) {
    throw new Error(`ROLLBACK_REHEARSAL_TIMEOUT_MS must be an integer >= 1000; received "${value}"`);
  }
  return parsed;
}

function command(commandName: string, args: string[], stdio: "inherit" | "pipe" | "ignore" = "pipe"): string {
  const value = execFileSync(commandName, args, { cwd: rootDir, encoding: "utf8", stdio });
  return typeof value === "string" ? value.trim() : "";
}
function docker(args: string[], stdio: "inherit" | "pipe" | "ignore" = "pipe"): string {
  return command("docker", args, stdio);
}
function git(args: string[]): string {
  return command("git", args);
}
function gitOrUnavailable(args: string[]): string {
  try { return git(args); } catch { return "unavailable"; }
}
function ignore(action: () => void): void {
  try { action(); } catch { /* Preserve the rehearsal result over cleanup errors. */ }
}
function cleanup(): string[] {
  if (cleaned) return [];
  cleaned = true;
  ignore(() => docker(["rm", "--force", runtime], "ignore"));
  ignore(() => docker(["rm", "--force", database], "ignore"));
  ignore(() => docker(["network", "rm", network], "ignore"));
  ignore(() => docker(["volume", "rm", "--force", volume], "ignore"));
  for (const tag of [currentTag, parentTag, migrationTag]) ignore(() => docker(["image", "rm", "--force", tag], "ignore"));
  if (parentWorktreeAdded) {
    ignore(() => git(["worktree", "remove", "--force", parentContext]));
  }
  if (currentWorktreeAdded) {
    ignore(() => git(["worktree", "remove", "--force", currentContext]));
  }
  ignore(() => rmSync(parentContext, { recursive: true, force: true }));
  ignore(() => rmSync(currentContext, { recursive: true, force: true }));
  ignore(() => rmSync(schemaContext, { recursive: true, force: true }));

  const remaining: string[] = [];
  try {
    docker(["info"], "ignore");
    if (docker(["ps", "--all", "--filter", `name=^/${runtime}$`, "--format", "{{.Names}}"])) remaining.push(`container ${runtime}`);
    if (docker(["ps", "--all", "--filter", `name=^/${database}$`, "--format", "{{.Names}}"])) remaining.push(`container ${database}`);
    for (const [kind, name, inspectArgs] of [
      ["network", network, ["network", "inspect", network]],
      ["volume", volume, ["volume", "inspect", volume]],
      ["image tag", currentTag, ["image", "inspect", currentTag]],
      ["image tag", parentTag, ["image", "inspect", parentTag]],
      ["image tag", migrationTag, ["image", "inspect", migrationTag]],
    ] as const) {
      try { docker([...inspectArgs], "ignore"); remaining.push(`${kind} ${name}`); } catch { /* Expected after cleanup. */ }
    }
  } catch {
    remaining.push("Docker unavailable during cleanup verification");
  }
  try {
    const worktrees = git(["worktree", "list", "--porcelain"]);
    if (worktrees.includes(parentContext)) remaining.push(`worktree ${parentContext}`);
    if (worktrees.includes(currentContext)) remaining.push(`worktree ${currentContext}`);
  } catch {
    remaining.push("Git worktrees unavailable during cleanup verification");
  }
  return remaining;
}
function report(): void {
  const status = failure ? "FAILED" : "PASSED";
  const markdown = `# Schema-Safe Application Rollback Rehearsal: ${status}

- Timestamp (UTC): ${new Date().toISOString()}
- Current revision: \`${currentRevision}\`
- Parent revision: \`${parentRevision}\`
- Current runtime: \`${currentTag}\` (${currentImageId})
- Parent runtime: \`${parentTag}\` (${parentImageId})
- Current migration: \`${migrationTag}\` (${migrationImageId})
- Migration result: ${migrationResult}
- Database volume retained across runtime replacement: \`${volume}\`
- Current checks (/, /api/healthz): ${currentChecks}
- Parent checks (/, /api/healthz): ${rollbackChecks}
- Public schema hash after migration: ${beforeSchema}
- Public schema hash after current runtime: ${currentSchema}
- Public schema hash after rollback: ${afterSchema}
- Forward-only schema statement: The schema was applied once by the current matching migration image and was not rolled back; replacing the runtime never runs a parent migration.
${schemaDifference ? `\n## Public Schema Difference\n\n\`\`\`diff\n${schemaDifference}\n\`\`\`\n` : ""}${failure ? `\n## Failure\n\n\`\`\`\n${failure}\n\`\`\`\n` : ""}`;
  writeFileSync(reportPath, markdown);
  console.log(`Rollback rehearsal evidence: ${reportPath}`);
}
async function availablePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Could not reserve host port"));
      else resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function waitFor(label: string, test: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "not ready";
  while (Date.now() < deadline) {
    try { if (await test()) return; last = "check returned false"; }
    catch (error) { last = error instanceof Error ? error.message : String(error); }
    await delay(500);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms: ${last}`);
}
function pgReady(): boolean {
  try {
    docker([
      "run", "--rm", "--network", network,
      "--env", `PGPASSWORD=${dbPassword}`,
      "postgres:16-alpine",
      "pg_isready", "-h", database, "-U", dbUser, "-d", dbName,
    ], "ignore");
    return true;
  } catch {
    return false;
  }
}
function schemaSnapshot(name: string): string {
  // Use a one-shot client container instead of docker exec. Some nested Docker
  // environments can start sibling containers but cannot setns into one that is
  // already running.
  const snapshot = docker([
    "run", "--rm", "--network", network,
    "--env", `PGPASSWORD=${dbPassword}`,
    "postgres:16-alpine",
    "sh", "-c",
    `set -eu; set -o pipefail; pg_dump --schema-only --schema=public -h ${database} -U ${dbUser} ${dbName} | sed '/^\\\\restrict /d;/^\\\\unrestrict /d'`,
  ]);
  writeFileSync(join(schemaContext, `${name}.sql`), `${snapshot}\n`);
  return snapshot;
}
function schemaFingerprint(snapshot: string): string {
  return execFileSync("sha256sum", [], {
    cwd: rootDir,
    input: snapshot,
    encoding: "utf8",
  }).split(/\s+/, 1)[0]!;
}
function captureSchemaDifference(beforeName: string, afterName: string): string {
  try {
    return execFileSync("diff", ["-u", `${beforeName}.sql`, `${afterName}.sql`], {
      cwd: schemaContext,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    const output = error as { stdout?: string };
    return output.stdout?.trim() || `Could not produce diff for ${beforeName} -> ${afterName}`;
  }
}
async function check(url: string, kind: "web" | "api"): Promise<void> {
  await waitFor(url, async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const body = await response.text();
    if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    if (kind === "web") return Boolean(response.headers.get("content-type")?.includes("text/html")
      && body.includes("<title>Production Run Calculator</title>") && body.includes('<div id="root"></div>')
      && /\/assets\/[^"]+\.js/.test(body) && !body.includes("@vite/client"));
    const payload = JSON.parse(body) as { status?: string; checks?: Record<string, string> };
    return payload.status === "ok" && payload.checks?.process === "ok" && payload.checks?.database === "ok" && payload.checks?.dependencies === "ok";
  });
}
function runRuntime(image: string, port: number): void {
  docker(["run", "--detach", "--name", runtime, "--network", network, "--publish", `${port}:5000`,
    "--env", "NODE_ENV=production", "--env", "PORT=5000",
    "--env", `DATABASE_URL=postgres://${dbUser}:${dbPassword}@${database}:5432/${dbName}`,
    "--env", "AI_INTEGRATIONS_GEMINI_API_KEY=rollback-rehearsal-configured", image], "inherit");
}
async function verifyRuntime(image: string): Promise<void> {
  const port = await availablePort();
  runRuntime(image, port);
  const base = `http://127.0.0.1:${port}`;
  await check(`${base}/`, "web");
  await check(`${base}/api/healthz`, "api");
}
async function main(): Promise<void> {
  timeoutMs = duration(process.env.ROLLBACK_REHEARSAL_TIMEOUT_MS ?? "180000");
  if (suppliedDatabaseUrl) {
    throw new Error("DATABASE_URL must not be supplied; this rehearsal creates an isolated disposable database.");
  }
  if (currentRevision === "unavailable" || parentRevision === "unavailable") {
    throw new Error("A checked-out Git HEAD and parent revision (HEAD^) are required for this rehearsal.");
  }
  docker(["info"], "ignore");
  git(["rev-parse", "--is-inside-work-tree"]);
  console.log(`Preparing parent revision ${parentRevision}`);
  git(["worktree", "add", "--detach", "--force", parentContext, parentRevision]);
  parentWorktreeAdded = true;
  console.log(`Preparing current revision ${currentRevision}`);
  git(["worktree", "add", "--detach", "--force", currentContext, currentRevision]);
  currentWorktreeAdded = true;
  docker(["network", "create", network], "inherit");
  docker(["volume", "create", volume], "inherit");
  docker(["build", "--network", buildNetwork, "--target", "api", "--tag", parentTag, parentContext], "inherit");
  parentImageId = docker(["image", "inspect", "--format", "{{.Id}}", parentTag]);
  docker(["build", "--network", buildNetwork, "--target", "api", "--tag", currentTag, currentContext], "inherit");
  currentImageId = docker(["image", "inspect", "--format", "{{.Id}}", currentTag]);
  docker(["build", "--network", buildNetwork, "--target", "api-migrate", "--tag", migrationTag, currentContext], "inherit");
  migrationImageId = docker(["image", "inspect", "--format", "{{.Id}}", migrationTag]);
  docker(["run", "--detach", "--name", database, "--network", network, "--volume", `${volume}:/var/lib/postgresql/data`,
    "--env", `POSTGRES_USER=${dbUser}`, "--env", `POSTGRES_PASSWORD=${dbPassword}`, "--env", `POSTGRES_DB=${dbName}`,
    "postgres:16-alpine"], "inherit");
  await waitFor("Postgres", pgReady);
  try {
    docker(["run", "--rm", "--network", network, "--env", `DATABASE_URL=postgres://${dbUser}:${dbPassword}@${database}:5432/${dbName}`, migrationTag], "inherit");
    migrationResult = "exit 0";
  } catch (error) { migrationResult = "non-zero exit"; throw error; }
  const migrationSnapshot = schemaSnapshot("after-migration");
  beforeSchema = schemaFingerprint(migrationSnapshot);
  await verifyRuntime(currentTag);
  currentChecks = "PASS";
  const currentSnapshot = schemaSnapshot("after-current-runtime");
  currentSchema = schemaFingerprint(currentSnapshot);
  if (beforeSchema !== currentSchema) {
    schemaDifference = captureSchemaDifference("after-migration", "after-current-runtime");
    throw new Error(`public schema changed while starting the current runtime (${beforeSchema} -> ${currentSchema})`);
  }
  docker(["rm", "--force", runtime], "inherit");
  await verifyRuntime(parentTag);
  rollbackChecks = "PASS";
  const parentSnapshot = schemaSnapshot("after-parent-runtime");
  afterSchema = schemaFingerprint(parentSnapshot);
  if (currentSchema !== afterSchema) {
    schemaDifference = captureSchemaDifference("after-current-runtime", "after-parent-runtime");
    throw new Error(`public schema changed during runtime replacement (${currentSchema} -> ${afterSchema})`);
  }
}

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => {
    failure = `Interrupted by ${signal}`;
    const remaining = cleanup();
    if (remaining.length) failure += `\nCleanup failed verification or left disposable resources:\n- ${remaining.join("\n- ")}`;
    try { report(); } catch (error) { console.error(`Could not write evidence: ${String(error)}`); }
    process.exit(remaining.length ? 1 : code);
  });
}
try { await main(); } catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`FAIL schema-safe rollback rehearsal:\n${failure}`);
  process.exitCode = 1;
} finally {
  const remaining = cleanup();
  if (remaining.length) {
    failure += `${failure ? "\n" : ""}Cleanup failed verification or left disposable resources:\n- ${remaining.join("\n- ")}`;
    console.error(`FAIL schema-safe rollback rehearsal cleanup:\n- ${remaining.join("\n- ")}`);
    process.exitCode = 1;
  }
  try { report(); } catch (error) {
    console.error(`Could not write evidence: ${String(error)}`);
    process.exitCode = 1;
  }
}