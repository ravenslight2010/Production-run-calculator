import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function smallJson(file) {
  try {
    if (fs.statSync(file).size > 65_536) return;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
}

function canonicalPath(value) {
  const suffix = [];
  let current = path.resolve(value);
  while (true) {
    try { return path.resolve(fs.realpathSync(current), ...suffix); } catch {
      const parent = path.dirname(current);
      if (parent === current) return;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function executableAvailable(command, env) {
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    try {
      const candidate = path.resolve(directory, command);
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return true;
    } catch {
      // A missing/broken candidate is not permission to execute a fallback.
    }
  }
  return false;
}

/** Filesystem inspection only: never import or execute a discovered tool. */
export function diagnoseStartupTools({
  root = repositoryRoot,
  env = process.env,
  nodeVersion = process.versions.node,
} = {}) {
  const findings = [];
  const manifest = smallJson(path.join(root, "package.json"));
  const managerMatch = typeof manifest?.packageManager === "string"
    ? /^pnpm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(manifest.packageManager) : null;
  const expectedManager = managerMatch?.[1] ?? null;
  let expectedNode = null;
  try {
    const value = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
    if (/^\d+\.\d+\.\d+$/.test(value)) expectedNode = value;
  } catch {}
  const safeNodeVersion = /^\d+\.\d+\.\d+$/.test(nodeVersion) ? nodeVersion : null;
  if (!expectedNode) findings.push("Restore the exact Node selector in .nvmrc.");
  else if (safeNodeVersion !== expectedNode) findings.push("The running Node differs from the release pin. Use the existing pinned-runtime runner before validation.");
  if (!expectedManager) findings.push("Restore the exact pnpm packageManager pin in package.json.");

  const commands = Object.fromEntries(["node", "corepack", "pnpm", "npm", "npx"]
    .map((command) => [command, { available: executableAvailable(command, env), executed: false }]));
  if (!commands.corepack.available) findings.push("Corepack is missing from PATH. Restore the project runtime before invoking the managed startup wrapper.");
  if (!commands.pnpm.available) findings.push("No executable pnpm entry was found. Use approved provisioning separately; this diagnostic will not install it.");

  const configuredHome = env.COREPACK_HOME || (env.HOME ? path.join(env.HOME, ".cache/node/corepack") : undefined);
  const canonicalRoot = canonicalPath(root);
  const canonicalHome = configuredHome && path.isAbsolute(configuredHome) ? canonicalPath(configuredHome) : undefined;
  let cache = { state: "unavailable", versionMatchesPin: false, integrity: "not-verified" };
  if (!canonicalRoot || !canonicalHome) {
    findings.push("Corepack cache location is unavailable or not absolute; configure a private cache outside the workspace.");
  } else if (inside(canonicalRoot, canonicalHome)) {
    cache = { ...cache, state: "unsafe-workspace-location" };
    findings.push("Corepack cache resolves inside the workspace. Move its configuration outside the workspace to avoid recursive provisioning.");
  } else if (expectedManager) {
    const directory = path.join(canonicalHome, "v1/pnpm", expectedManager);
    const resolvedDirectory = canonicalPath(directory);
    if (!resolvedDirectory || !inside(canonicalHome, resolvedDirectory) || inside(canonicalRoot, resolvedDirectory)) {
      cache = { ...cache, state: "unsafe-cache-target" };
      findings.push("The expected cache entry resolves outside its private cache. Review that target before provisioning or startup.");
    } else {
      const metadata = smallJson(path.join(resolvedDirectory, "package.json"));
      if (metadata?.name === "pnpm" && metadata.version === expectedManager) {
        cache = { ...cache, state: "present-unverified", versionMatchesPin: true };
      } else {
        cache = { ...cache, state: metadata ? "invalid-metadata" : "missing-or-unreadable" };
        findings.push("The exact pnpm cache entry is missing, unreadable, or declares another version. Use separately approved verified provisioning; do not execute a stale manager.");
      }
    }
  }
  return {
    mode: "read-only-no-install",
    networkUsed: false,
    discoveredToolsExecuted: false,
    startupVerified: false,
    offlineStartupVerified: false,
    node: { expected: expectedNode, running: safeNodeVersion, matchesPin: expectedNode !== null && expectedNode === safeNodeVersion },
    packageManager: { name: "pnpm", expected: expectedManager, activeVersion: "not-executed" },
    commands,
    cache,
    findings,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--json")) {
    console.error("Usage: node scripts/src/startup-tools-diagnostic.mjs [--json]");
    process.exitCode = 2;
  } else {
    const result = diagnoseStartupTools();
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      console.log("Startup tools: read-only inspection; no install, network probe, or discovered-tool execution.");
      console.log(`Node: expected ${result.node.expected ?? "unknown"}; running ${result.node.running ?? "unknown"}.`);
      console.log(`pnpm: expected ${result.packageManager.expected ?? "unknown"}; active version not executed.`);
      console.log(`Corepack cache: ${result.cache.state}; integrity not verified.`);
      for (const finding of result.findings) console.log(`- ${finding}`);
      console.log("This is not startup, cache-integrity, or offline-startup certification.");
    }
    process.exitCode = result.findings.length ? 1 : 0;
  }
}
