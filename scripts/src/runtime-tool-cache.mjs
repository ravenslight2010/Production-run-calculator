import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execute = promisify(execFile);
const maximumArchiveBytes = 64 * 1024 * 1024;
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function json(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65_536) throw new Error("Startup-tool metadata is invalid.");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new Error("Startup-tool metadata cannot be decoded.");
  }
}

async function specification(root) {
  const manifest = await json(path.join(root, "package.json"));
  const manager = /^pnpm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(manifest.packageManager ?? "");
  const selector = path.join(root, ".nvmrc");
  if ((await fs.stat(selector)).size > 128) throw new Error("Node selector exceeds its bound.");
  const node = (await fs.readFile(selector, "utf8")).trim();
  const engine = /^>=(\d+)$/.exec(manifest.engines?.node ?? "");
  if (!manager || !/^\d+\.\d+\.\d+$/.test(node) || !engine) throw new Error("Startup-tool pins must be explicit and supported.");
  return { pnpm: manager[1], node, minimumNodeMajor: Number(engine[1]) };
}

async function executable(root) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, "corepack");
    try {
      await fs.access(candidate, constants.X_OK);
      const resolved = await fs.realpath(candidate);
      if (!(await fs.stat(resolved)).isFile() || inside(root, resolved)) continue;
      return resolved;
    } catch {}
  }
  throw new Error("The existing trusted Corepack runtime is unavailable; no fallback tool will be installed.");
}

async function privateDirectory(root, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  if (inside(root, await fs.realpath(directory))) {
    await fs.rm(directory, { recursive: true, force: true });
    throw new Error("Startup-tool temporary cache must be outside the workspace.");
  }
  await fs.chmod(directory, 0o700);
  return directory;
}

function childEnvironment(home, network) {
  const env = {
    PATH: process.env.PATH ?? "", HOME: home, COREPACK_HOME: path.join(home, "corepack"),
    COREPACK_NPM_REGISTRY: "https://registry.npmjs.org",
    COREPACK_ENABLE_NETWORK: network ? "1" : "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", COREPACK_DEFAULT_TO_LATEST: "0",
    COREPACK_ENABLE_PROJECT_SPEC: "1", COREPACK_ENABLE_STRICT: "1",
    NODE_USE_SYSTEM_CA: "0",
  };
  // Public trust-store paths only; never inherit registry tokens, custom
  // integrity-key overrides, provider credentials or application secrets.
  for (const key of ["SSL_CERT_FILE", "NIX_SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function corepack(command, args, env, runner, timeout) {
  try {
    return await runner(command, args, { env, cwd: env.HOME, timeout, maxBuffer: 128 * 1024 });
  } catch {
    throw new Error("Verified startup-tool packaging/restoration failed. Check the trusted Corepack runtime and HTTPS trust; do not disable signature or TLS checks.");
  }
}

async function archiveBytes(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumArchiveBytes) {
    throw new Error("Retained startup-tool archive is missing, oversized or unsafe.");
  }
  const bytes = await fs.readFile(file);
  if (bytes.length > maximumArchiveBytes) throw new Error("Retained startup-tool archive exceeded its bound.");
  return bytes;
}

export async function buildRuntimeToolCache({ root = rootDirectory, runner = execute, corepackPath } = {}) {
  root = await fs.realpath(root);
  const spec = await specification(root);
  if (process.versions.node !== spec.node) throw new Error("Build startup tools with the exact .nvmrc runtime.");
  const command = corepackPath ?? await executable(root);
  const home = await privateDirectory(root, "prc-corepack-build-");
  try {
    const env = childEnvironment(home, true);
    const version = (await corepack(command, ["--version"], env, runner, 10_000)).stdout.trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Cannot identify the existing Corepack runtime.");
    const archive = path.join(home, "pnpm-cache.tgz");
    // pnpm 12's signed npm package is a dispatcher. Corepack does not run its
    // lifecycle scripts or fetch its native payload merely by packing it.
    // Warm the exact manager in this private, non-workspace directory first;
    // the dispatcher's default npm checksum/signature verification stays on.
    await corepack(command, ["install", "--global", `pnpm@${spec.pnpm}`], env, runner, 90_000);
    const managerVersion = (await corepack(command, ["pnpm", "--version"], env, runner, 90_000)).stdout.trim();
    if (managerVersion !== spec.pnpm) throw new Error("Prepared startup manager does not match the source pin.");
    const native = path.join(env.COREPACK_HOME, "v1/pnpm", spec.pnpm, process.platform === "win32" ? "pnpm-native.exe" : "pnpm-native");
    if (!(await fs.lstat(native)).isFile()) throw new Error("Verified pnpm native payload is unavailable.");
    // Pack both the dispatcher and the now-verified native payload.
    await corepack(command, ["pack", `pnpm@${spec.pnpm}`, "--output", archive], env, runner, 90_000);
    const bytes = await archiveBytes(archive);
    const api = await fs.realpath(path.join(root, "artifacts/api-server"));
    if (!inside(root, api)) throw new Error("API build directory resolves outside the workspace.");
    const dist = path.join(api, "dist");
    await fs.mkdir(dist, { recursive: true });
    if (!inside(root, await fs.realpath(dist))) throw new Error("API output directory resolves outside the workspace.");
    const output = path.join(dist, "runtime-tools");
    await fs.mkdir(output, { recursive: true });
    if ((await fs.lstat(output)).isSymbolicLink()) throw new Error("Startup-tool output must not be a symlink.");
    const metadata = {
      schema: 1, pnpm: spec.pnpm, buildNode: spec.node, corepack: version,
      platform: process.platform, arch: process.arch,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      producer: "corepack-pack-pnpm-native-default-integrity",
    };
    const suffix = randomUUID();
    const stagedArchive = path.join(output, `pnpm-cache.${suffix}.tmp`);
    const stagedManifest = path.join(output, `manifest.${suffix}.tmp`);
    try {
      await fs.writeFile(stagedArchive, bytes, { flag: "wx", mode: 0o644 });
      await fs.writeFile(stagedManifest, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o644 });
      await fs.rename(stagedArchive, path.join(output, "pnpm-cache.tgz"));
      await fs.rename(stagedManifest, path.join(output, "manifest.json"));
    } finally {
      await fs.rm(stagedArchive, { force: true });
      await fs.rm(stagedManifest, { force: true });
    }
    return metadata;
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

export async function restoreRuntimeToolCache({ root = rootDirectory, runner = execute, corepackPath } = {}) {
  root = await fs.realpath(root);
  const spec = await specification(root);
  const output = path.join(root, "artifacts/api-server/dist/runtime-tools");
  if (!inside(root, await fs.realpath(output))) throw new Error("Retained startup tools resolve outside the workspace.");
  const metadata = await json(path.join(output, "manifest.json"));
  if (metadata.schema !== 1 || metadata.pnpm !== spec.pnpm || metadata.buildNode !== spec.node ||
    metadata.platform !== process.platform || metadata.arch !== process.arch ||
    metadata.producer !== "corepack-pack-pnpm-native-default-integrity" ||
    !/^\d+\.\d+\.\d+$/.test(metadata.corepack ?? "") || !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? "") ||
    Number(process.versions.node.split(".")[0]) < spec.minimumNodeMajor) {
    throw new Error("Retained startup tools do not match this source/runtime; rebuild before publishing.");
  }
  const archive = path.join(output, "pnpm-cache.tgz");
  const bytes = await archiveBytes(archive);
  if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) throw new Error("Retained startup-tool integrity check failed.");
  const command = corepackPath ?? await executable(root);
  const home = await privateDirectory(root, "prc-corepack-runtime-");
  try {
    const env = childEnvironment(home, false);
    // Install the already-verified bytes, not a source path that could change
    // between validation and the child process reading it.
    const verifiedArchive = path.join(home, "verified-pnpm-cache.tgz");
    await fs.writeFile(verifiedArchive, bytes, { flag: "wx", mode: 0o600 });
    const version = (await corepack(command, ["--version"], env, runner, 10_000)).stdout.trim();
    if (version !== metadata.corepack) throw new Error("Runtime Corepack differs from the build; rebuild the retained tools.");
    await corepack(command, ["install", "--global", "--cache-only", verifiedArchive], env, runner, 20_000);
    const packageDirectory = path.join(env.COREPACK_HOME, "v1/pnpm", spec.pnpm);
    if (!inside(home, await fs.realpath(packageDirectory))) throw new Error("Restored package escapes its private cache.");
    const restored = await json(path.join(packageDirectory, "package.json"));
    if (restored.name !== "pnpm" || restored.version !== spec.pnpm) throw new Error("Restored startup-tool version does not match the pin.");
    const native = path.join(packageDirectory, process.platform === "win32" ? "pnpm-native.exe" : "pnpm-native");
    if (!(await fs.lstat(native)).isFile()) throw new Error("Restored pnpm native payload is unavailable.");
    await fs.access(native, process.platform === "win32" ? constants.R_OK : constants.X_OK);
    return { home, corepackHome: env.COREPACK_HOME };
  } catch (error) {
    await fs.rm(home, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !["build", "restore"].includes(process.argv[2])) throw new Error("Usage: node scripts/src/runtime-tool-cache.mjs build|restore");
    if (process.argv[2] === "build") {
      const metadata = await buildRuntimeToolCache();
      console.log(`Retained startup tools prepared: pnpm@${metadata.pnpm}, Corepack ${metadata.corepack}.`);
    } else {
      console.log((await restoreRuntimeToolCache()).corepackHome);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Startup-tool cache operation failed.");
    process.exitCode = 1;
  }
}
