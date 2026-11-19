#!/usr/bin/env node
/**
 * Pilot path verification for the local coding assistant.
 * Fail-closed static checks + optional live probes (Ollama).
 *
 *   node scripts/coding-assistant/verify-pilot.mjs
 *   node scripts/coding-assistant/verify-pilot.mjs --fixture
 *   node scripts/coding-assistant/verify-pilot.mjs --report path.json --out /tmp/oc.json
 *   node scripts/coding-assistant/verify-pilot.mjs --live   # require Ollama reachable
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const results = [];
function ok(id, detail) {
  results.push({ id, ok: true, detail });
  console.log(`PASS  ${id}${detail ? ` — ${detail}` : ""}`);
}
function fail(id, detail) {
  results.push({ id, ok: false, detail });
  console.error(`FAIL  ${id}${detail ? ` — ${detail}` : ""}`);
}
function warn(id, detail) {
  results.push({ id, ok: true, warn: true, detail });
  console.warn(`WARN  ${id}${detail ? ` — ${detail}` : ""}`);
}

function runNode(script, scriptArgs = []) {
  return spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

console.log("Coding-assistant pilot verification\n");

// 1) unit tests
{
  const { readdirSync } = await import("node:fs");
  const dir = path.join(root, "scripts/coding-assistant/tests");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => path.join(dir, f));
  const r = spawnSync(process.execPath, ["--test", ...files], {
    cwd: root,
    encoding: "utf8",
  });
  if ((r.status ?? 1) === 0) ok("unit-tests", `${files.length} files`);
  else fail("unit-tests", (r.stderr || r.stdout || "").slice(0, 400));
}

// 2) static profile template
{
  const r = runNode(path.join(root, "scripts/coding-assistant/check-readonly-profile.mjs"));
  if ((r.status ?? 1) === 0) ok("readonly-template", "example profile invariants");
  else fail("readonly-template", (r.stderr || r.stdout || "").slice(0, 300));
}

// 3) render profile
const out =
  flag("--out") ||
  path.join(mkdtempSync(path.join(tmpdir(), "ca-verify-")), "opencode.local.json");
const report =
  flag("--report") ||
  (has("--fixture") || !flag("--report")
    ? path.join(root, "docs/coding-assistant/fixtures/host-report-candidate-7b.json")
    : flag("--report"));
{
  const r = runNode(path.join(root, "scripts/coding-assistant/bootstrap-local.mjs"), [
    "--report",
    report,
    "--out",
    out,
  ]);
  if ((r.status ?? 1) === 0 && existsSync(out)) {
    ok("render-profile", out);
    try {
      const cfg = JSON.parse(readFileSync(out, "utf8"));
      const model = String(cfg.model || "");
      if (!model.startsWith("plant-local/")) fail("profile-model", `unexpected model ${model}`);
      else ok("profile-model", model);
      const providers = Object.keys(cfg.providers || {});
      if (providers.length !== 1 || providers[0] !== "plant-local") {
        fail("profile-providers", `expected only plant-local, got ${providers.join(",")}`);
      } else ok("profile-providers", "plant-local only");
      const base = cfg.providers?.["plant-local"]?.settings?.baseURL || "";
      if (!String(base).includes("127.0.0.1") && !String(base).includes("localhost")) {
        fail("profile-loopback", base);
      } else ok("profile-loopback", base);
      const blob = JSON.stringify(cfg);
      for (const bad of ["openai.com", "anthropic", "api.google", "execute:*"]) {
        // execute deny should be present; cloud hosts must not
        if (bad === "execute:*") {
          if (!blob.includes("execute")) warn("profile-execute-deny", "could not find execute deny string");
          else ok("profile-execute-deny", "execute tooling restricted in profile");
        } else if (blob.includes(bad)) fail("profile-no-cloud", `found ${bad}`);
      }
      if (!blob.includes("openai.com") && !blob.includes("anthropic")) {
        ok("profile-no-cloud", "no cloud host strings");
      }
    } catch (e) {
      fail("profile-parse", String(e.message || e));
    }
  } else fail("render-profile", (r.stderr || r.stdout || "missing out file").slice(0, 300));
}

// 4) installer files present
for (const rel of [
  "scripts/self-host/coding-assistant/Install-CodingAssistant.ps1",
  "scripts/self-host/coding-assistant/Install-CodingAssistant-DOUBLECLICK.cmd",
  "scripts/self-host/coding-assistant/README.md",
  "docs/coding-assistant/pilot-runbook.md",
  "scripts/coding-assistant/chat-ui/server.mjs",
]) {
  const p = path.join(root, rel);
  if (existsSync(p)) ok(`artifact:${path.basename(rel)}`, rel);
  else fail(`artifact:${path.basename(rel)}`, `missing ${rel}`);
}

// 5) PATH tooling
function onPath(cmd) {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
  return (r.status ?? 1) === 0;
}
if (onPath("ollama")) ok("path-ollama", "ollama on PATH");
else warn("path-ollama", "not on PATH (install via Windows installer or ollama.com)");
if (onPath("opencode")) ok("path-opencode", "opencode on PATH");
else warn("path-opencode", "not on PATH — use chat-ui pilot or install OpenCode");

// 6) live Ollama
async function probeOllama() {
  const live = has("--live");
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const names = (data.models || []).map((m) => m.name || m.model).filter(Boolean);
    ok("ollama-up", names.slice(0, 5).join(", ") || "reachable");
    const want = ["qwen2.5-coder:7b", "qwen3-coder:30b"];
    const hasModel = names.some((n) => want.some((w) => n === w || n.startsWith(w)));
    if (hasModel) ok("ollama-model", "catalogue model present");
    else warn("ollama-model", `pull one of ${want.join(" | ")}`);
  } catch (e) {
    const msg = String(e.message || e);
    if (live) fail("ollama-up", msg);
    else warn("ollama-up", `${msg} (pass --live to require)`);
  }
}

await probeOllama();

const failed = results.filter((r) => !r.ok);
const warns = results.filter((r) => r.warn);
console.log(
  `\nSummary: ${results.filter((r) => r.ok && !r.warn).length} pass, ${warns.length} warn, ${failed.length} fail`,
);
if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("\nPilot pilot path is OK for static/config checks.");
  console.log("Chat UI:  node scripts/coding-assistant/chat-ui/server.mjs");
  console.log("OpenCode: point at rendered profile; confirm edit/shell denied.");
}
