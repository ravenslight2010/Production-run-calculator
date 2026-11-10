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
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
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

const hostReport = flag("--report");
const outPath =
  flag("--out") || path.join(root, ".opencode", "opencode.local.json");

if (hostReport) {
  if (!existsSync(hostReport)) {
    console.error(`Host report not found: ${hostReport}`);
    process.exit(1);
  }
  console.log(`— Rendering OpenCode config from ${hostReport} → ${outPath}`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  const render = path.join(root, "scripts/coding-assistant/render-opencode-config.mjs");
  const r = spawnSync(
    process.execPath,
    [render, "--report", hostReport, "--out", outPath],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if ((r.status ?? 1) !== 0) {
    console.error("Config render failed (fail-closed).");
    process.exit(1);
  }
} else {
  console.log(
    "— No --report supplied; skipped model-specific config render.\n" +
      "  On Windows, run the HostInspector to produce a report, then re-run with --report.",
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
Next steps (pilot, read-only):
  1. Install Ollama and pull the candidate model from the host report (if any).
  2. Install OpenCode (https://opencode.ai) for your OS.
  3. Point OpenCode at the rendered config${hostReport ? ` (${outPath})` : " (after rendering with --report)"}.
  4. Confirm the session cannot edit files or run shell (read-only profile).
  5. Keep agent work under a separate directory from production plant data.

Safety:
  - No cloud providers in the read-only profile.
  - No production app dependency on the assistant.
  - Do not expose Ollama/OpenCode on the plant network.
`);
process.exit(0);
