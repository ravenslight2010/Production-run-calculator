#!/usr/bin/env node
/**
 * Local coding-assistant pilot bootstrap (read-only OpenCode profile).
 *
 * Does NOT install models, OpenCode, or Ollama. It:
 *  1) validates the static read-only profile template
 *  2) optionally renders a host-specific config from a host-inspection JSON
 *  3) prints next commands to run OpenCode against that config
 *
 * Usage:
 *   node scripts/coding-assistant/bootstrap-local.mjs
 *   node scripts/coding-assistant/bootstrap-local.mjs --report path/to/inspection.json
 *   node scripts/coding-assistant/bootstrap-local.mjs --report report.json --out .opencode/opencode.local.json
 *   node scripts/coding-assistant/bootstrap-local.mjs --fixture
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function has(name) {
  return args.includes(name);
}

function runNode(script, scriptArgs = []) {
  const r = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status ?? 1;
}

console.log("Coding assistant bootstrap (read-only pilot)\n");

const check = path.join(root, "scripts/coding-assistant/check-readonly-profile.mjs");
if (!existsSync(check)) {
  console.error("Missing check-readonly-profile.mjs");
  process.exit(1);
}
console.log("— Validating read-only profile template…");
if (runNode(check) !== 0) {
  console.error("Read-only profile check failed.");
  process.exit(1);
}

const fixturePath = path.join(
  root,
  "docs/coding-assistant/fixtures/host-report-candidate-7b.json",
);
let hostReport = flag("--report");
if (has("--fixture")) {
  hostReport = fixturePath;
  console.log(`— Using bundled fixture: ${fixturePath}`);
}

const outPath =
  flag("--out") || path.join(root, ".opencode", "opencode.local.json");

if (hostReport) {
  if (!existsSync(hostReport)) {
    console.error(`Host report not found: ${hostReport}`);
    process.exit(1);
  }
  console.log(`— Rendering OpenCode config from ${hostReport}`);
  const render = path.join(root, "scripts/coding-assistant/render-opencode-config.mjs");
  const r = spawnSync(
    process.execPath,
    [render, "--report", hostReport],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.stderr) process.stderr.write(r.stderr);
  if ((r.status ?? 1) !== 0) {
    if (r.stdout) process.stdout.write(r.stdout);
    console.error("Config render failed (fail-closed).");
    process.exit(1);
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, r.stdout, "utf8");
  console.log(`— Wrote ${outPath}`);
} else {
  console.log(
    "— No --report supplied; skipped model-specific config render.\n" +
      "  Use --fixture for the bundled sample, or on Windows run HostInspector and pass --report.",
  );
}

function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  return (r.status === 0 && r.stdout.trim()) || null;
}
const ollama = which("ollama");
const opencode = which("opencode");
console.log("\n— Local tooling");
console.log(`  ollama:   ${ollama ? ollama.split(/\r?\n/)[0] : "not found on PATH"}`);
console.log(`  opencode: ${opencode ? opencode.split(/\r?\n/)[0] : "not found on PATH"}`);

console.log(`
Next steps (pilot, read-only) — see docs/coding-assistant/pilot-runbook.md:
  1. Install Ollama; pull the candidate model from the host report / fixture.
  2. Install OpenCode (https://opencode.ai).
  3. Point OpenCode at ${hostReport ? outPath : "the rendered config"}.
  4. Confirm the session cannot edit files or run shell.
  5. Keep agent work under a separate directory from production plant data.
`);
process.exit(0);
