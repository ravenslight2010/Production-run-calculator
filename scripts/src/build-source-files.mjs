import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const SOURCE_POLICY = "production-source-v2";
const SOURCE_LIBRARY_RECONCILIATION_ASSETS = new Set([
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.sha256",
]);
const REQUIRED = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "artifacts/api-server/src", "artifacts/run-calculator/src", "lib", "scripts/src",
  "attached_assets/source-library/audits",
  ...SOURCE_LIBRARY_RECONCILIATION_ASSETS];
const TOP_FILES = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  ".replit", ".npmrc", ".node-version", ".nvmrc"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", "__tests__",
  "fixtures", "snapshots", "corpus", "datasets", "captures", "evidence", "e2e"]);
const SKIP_FILES = new Set(["publish-source-record.json", "build-info.json",
  "build-source-part.json"]);

export function isSourceInput(relative) {
  const parts = relative.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p) || p.startsWith(".env")) ||
      SKIP_FILES.has(parts.at(-1)) || /\.(?:test|spec)\.[^.]+$/.test(relative) ||
      /\.(?:log|tsbuildinfo)$/.test(relative)) return false;
  if (SOURCE_LIBRARY_RECONCILIATION_ASSETS.has(relative)) return true;
  if (parts.length === 1) return TOP_FILES.has(relative) || /^tsconfig.*\.json$/.test(relative);
  if (parts[0] === "lib" || relative.startsWith("scripts/src/")) return true;
  if (parts[0] !== "artifacts" || !["api-server", "run-calculator"].includes(parts[1])) return false;
  return ["src", "public", "scripts"].includes(parts[2]) ||
    (parts.length === 3 && (/^(?:vite|tsconfig).*\.|^build\.|^index\.html$/.test(parts[2]) ||
      ["package.json", "artifact.toml"].includes(parts[2])));
}

export function fingerprintSource(root) {
  const sourceRoot = path.resolve(root);
  for (const entry of REQUIRED) {
    let stat;
    try {
      let ancestor = sourceRoot;
      for (const segment of entry.split("/")) {
        ancestor = path.join(ancestor, segment);
        if (lstatSync(ancestor).isSymbolicLink()) throw new Error("Build-source symlinks are not allowed.");
      }
      stat = lstatSync(path.join(sourceRoot, entry));
    }
    catch { throw new Error("Required build-source inputs are missing."); }
    if (stat.isSymbolicLink()) throw new Error("Build-source symlinks are not allowed.");
    if (entry.includes(".") ? !stat.isFile() : !stat.isDirectory())
      throw new Error("Required build-source input has an invalid type.");
  }
  const files = [];
  let totalBytes = 0;
  function walk(relative) {
    const absolute = path.join(sourceRoot, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Build-source symlinks are not allowed.");
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (SKIP_DIRS.has(name) || name.startsWith(".env")) continue;
        walk(relative ? `${relative}/${name}` : name);
      }
    } else if (isSourceInput(relative)) {
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
        throw new Error("Invalid or oversized build-source input.");
      totalBytes += stat.size;
      files.push(relative);
      if (files.length > 20_000 || totalBytes > 128 * 1024 * 1024)
        throw new Error("Build-source input budget exceeded.");
    }
  }
  for (const name of readdirSync(sourceRoot).sort()) {
    if (TOP_FILES.has(name) || /^tsconfig.*\.json$/.test(name)) walk(name);
  }
  for (const base of ["lib", "scripts/src", "artifacts/api-server", "artifacts/run-calculator",
    "attached_assets/source-library/audits"]) {
    const names = readdirSync(path.join(sourceRoot, base)).sort();
    for (const name of names) {
      if (SKIP_DIRS.has(name) || name.startsWith(".env")) continue;
      // Only descend into directories used by these builds.
      if (base.startsWith("artifacts/") &&
          !["src", "public", "scripts"].includes(name) && !isSourceInput(`${base}/${name}`)) continue;
      walk(`${base}/${name}`);
    }
  }
  files.sort();
  const hash = createHash("sha256").update(`${SOURCE_POLICY}\0`);
  const gitFilesSha256 = new Map();
  for (const file of files) {
    const bytes = readFileSync(path.join(sourceRoot, file));
    const mode = lstatSync(path.join(sourceRoot, file)).mode & 0o111 ? "100755" : "100644";
    hash.update(`${Buffer.byteLength(file)}:${file}:${mode}:${bytes.length}:`).update(bytes);
    gitFilesSha256.set(file, {
      mode,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return { sourcePolicy: SOURCE_POLICY, sourceFingerprintSha256: hash.digest("hex"), files, gitFilesSha256 };
}

export function verifiedGitRevision(root, snapshot) {
  try {
    const run = (args) => execFileSync("git", args, {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000,
    }).trim();
    if (path.resolve(run(["rev-parse", "--show-toplevel"])) !== path.resolve(root)) return null;
    const sha = run(["rev-parse", "HEAD"]);
    if (!/^[a-f0-9]{40}$/.test(sha)) return null;
    // Compare captured bytes/modes to one immutable commit tree, not a mutable
    // index or a second HEAD lookup that another process could move mid-probe.
    // Git object IDs are only used to retrieve committed bytes; source identity
    // is verified with SHA-256 rather than trusting Git's object hash.
    const committed = new Map();
    for (const entry of run(["ls-tree", "-r", "-z", "--full-tree", sha]).split("\0")) {
      const tab = entry.indexOf("\t");
      if (tab < 0) continue;
      const file = entry.slice(tab + 1);
      const [mode, type, objectId] = entry.slice(0, tab).split(" ");
      if (type === "blob" && isSourceInput(file)) committed.set(file, { mode, objectId });
    }
    if (committed.size !== snapshot.gitFilesSha256.size ||
        snapshot.files.some((file) => {
          const captured = snapshot.gitFilesSha256.get(file);
          const treeEntry = committed.get(file);
          return !captured || !treeEntry || captured.mode !== treeEntry.mode ||
            !/^[a-f0-9]{40,64}$/.test(treeEntry.objectId);
        })) return null;

    const expectedByObject = new Map();
    for (const file of snapshot.files) {
      const objectId = committed.get(file).objectId;
      const expected = snapshot.gitFilesSha256.get(file);
      const previous = expectedByObject.get(objectId);
      if (previous && (previous.size !== expected.size || previous.sha256 !== expected.sha256)) return null;
      expectedByObject.set(objectId, expected);
    }
    const objectIds = [...expectedByObject.keys()];
    const contents = execFileSync("git", ["cat-file", "--batch"], {
      cwd: root,
      input: `${objectIds.join("\n")}\n`,
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 136 * 1024 * 1024,
    });
    let offset = 0;
    for (const objectId of objectIds) {
      const headerEnd = contents.indexOf(0x0a, offset);
      if (headerEnd < 0) return null;
      const [returnedId, type, sizeText] = contents.subarray(offset, headerEnd).toString("ascii").split(" ");
      if (returnedId !== objectId || type !== "blob" || !/^(?:0|[1-9]\d*)$/.test(sizeText)) return null;
      const size = Number(sizeText);
      const contentStart = headerEnd + 1;
      const contentEnd = contentStart + size;
      if (!Number.isSafeInteger(size) || contentEnd >= contents.length ||
          contents[contentEnd] !== 0x0a) return null;
      const expected = expectedByObject.get(objectId);
      const committedSha256 = createHash("sha256").update(contents.subarray(contentStart, contentEnd)).digest("hex");
      if (size !== expected.size || committedSha256 !== expected.sha256) return null;
      offset = contentEnd + 1;
    }
    if (offset !== contents.length) return null;
    return sha;
  } catch {
    // Missing Git metadata is an explicit unavailable binding, never a made-up SHA.
    return null;
  }
}