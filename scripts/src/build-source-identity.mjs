import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintSource, SOURCE_POLICY, verifiedGitRevision } from "./build-source-files.mjs";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SOURCE_RECORD_PATH = "artifacts/api-server/publish-source-record.json";
export const EXPECTED_RECORD_PATH = ".local/build-identity/expected-source.json";
const SHA = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const APP_ID = /^app-build:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SOURCE_KEYS = ["schemaVersion", "kind", "appBuildId", "sourcePolicy",
  "sourceFingerprintSha256", "gitRevision", "gitBinding", "preparedAt", "mode"];
export const INFO_KEYS = ["schemaVersion", "kind", "appBuildId", "sourcePolicy",
  "sourceFingerprintSha256", "gitRevision", "gitBinding", "completedAt", "buildMode",
  "platformDeploymentId", "platformBuildId", "platformIdentitySource"];
const dateValid = (s) => typeof s === "string" && Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString() === s;
const exactKeys = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj) &&
  Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
const gitValid = (r) => r.gitRevision === null ? r.gitBinding === "unavailable" :
  typeof r.gitRevision === "string" && GIT.test(r.gitRevision) && r.gitBinding === "verified";

export function validateSourceRecord(r) {
  if (!exactKeys(r, SOURCE_KEYS) || r.schemaVersion !== 1 || r.kind !== "prepared-build-source" ||
      !APP_ID.test(r.appBuildId) || r.sourcePolicy !== SOURCE_POLICY ||
      !SHA.test(r.sourceFingerprintSha256) || !gitValid(r) || !dateValid(r.preparedAt) ||
      !["publish", "development"].includes(r.mode))
    throw new Error("Invalid prepared build-source record.");
  return r;
}

export function validateBuildInfo(r) {
  const identifier = (v) => v === null || (typeof v === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(v));
  if (!exactKeys(r, INFO_KEYS) || r.schemaVersion !== 1 || r.kind !== "app-build-info" ||
      !APP_ID.test(r.appBuildId) || r.sourcePolicy !== SOURCE_POLICY ||
      !SHA.test(r.sourceFingerprintSha256) || !gitValid(r) || !dateValid(r.completedAt) ||
      !["release", "development"].includes(r.buildMode) ||
      !identifier(r.platformDeploymentId) || !identifier(r.platformBuildId) ||
      !["runtime-reported", "unavailable"].includes(r.platformIdentitySource) ||
      (r.platformIdentitySource === "unavailable" &&
        (r.platformDeploymentId !== null || r.platformBuildId !== null)))
    throw new Error("Invalid sealed build identity.");
  return r;
}

export function readBoundedJson(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192)
    throw new Error("Build identity record exceeds its size budget or is not a regular file.");
  const bytes = readFileSync(file);
  if (bytes.length > 8192) throw new Error("Build identity record exceeds its size budget.");
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Build identity record contains invalid JSON."); }
}

export function writeRecord(file, record) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

export function createSourceRecord(root, mode = "publish") {
  const snapshot = fingerprintSource(root);
  const gitRevision = verifiedGitRevision(root, snapshot);
  if (fingerprintSource(root).sourceFingerprintSha256 !== snapshot.sourceFingerprintSha256)
    throw new Error("Build source changed while preparing its identity.");
  return validateSourceRecord({
    schemaVersion: 1, kind: "prepared-build-source", appBuildId: `app-build:${randomUUID()}`,
    sourcePolicy: snapshot.sourcePolicy, sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
    gitRevision, gitBinding: gitRevision === null ? "unavailable" : "verified",
    preparedAt: new Date().toISOString(), mode,
  });
}

export function assertSourceUnchanged(root, record) {
  validateSourceRecord(record);
  if (fingerprintSource(root).sourceFingerprintSha256 !== record.sourceFingerprintSha256)
    throw new Error("Build source changed. Run prepare:publish again before publishing.");
}

export function preparePublishSource(root = PROJECT_ROOT, { reuse = false } = {}) {
  const candidateFile = path.join(root, SOURCE_RECORD_PATH);
  const record = reuse && existsSync(candidateFile)
    ? validateSourceRecord(readBoundedJson(candidateFile)) : createSourceRecord(root);
  if (record.mode !== "publish") throw new Error("A development record cannot prepare a publish.");
  assertSourceUnchanged(root, record);
  writeRecord(candidateFile, record);
  writeRecord(path.join(root, EXPECTED_RECORD_PATH), record);
  return record;
}

export function buildSourceRecord(root = PROJECT_ROOT, mode = "publish") {
  if (mode === "development") return createSourceRecord(root, mode);
  const file = path.join(root, SOURCE_RECORD_PATH);
  if (!existsSync(file)) return preparePublishSource(root);
  const record = validateSourceRecord(readBoundedJson(file));
  assertSourceUnchanged(root, record);
  if (record.mode !== "publish") throw new Error("Invalid publish preparation mode.");
  return record;
}

export function sourceRecordDigest(record) {
  validateSourceRecord(record);
  return createHash("sha256").update(JSON.stringify(SOURCE_KEYS.map((k) => [k, record[k]]))).digest("hex");
}

export function buildInfoFromRecord(record, buildMode, completedAt = new Date().toISOString()) {
  validateSourceRecord(record);
  return validateBuildInfo({
    schemaVersion: 1, kind: "app-build-info", appBuildId: record.appBuildId,
    sourcePolicy: record.sourcePolicy, sourceFingerprintSha256: record.sourceFingerprintSha256,
    gitRevision: record.gitRevision, gitBinding: record.gitBinding, completedAt, buildMode,
    platformDeploymentId: null, platformBuildId: null, platformIdentitySource: "unavailable",
  });
}

function partFile(root, stage) {
  return path.join(root, stage === "api" ? "artifacts/api-server/dist/build-source-part.json" :
    "artifacts/run-calculator/dist/public/build-source-part.json");
}

function outputFingerprint(root, stage) {
  const directory = path.dirname(partFile(root, stage));
  const entry = stage === "api" ? "index.mjs" : "index.html";
  if (!existsSync(path.join(directory, entry))) throw new Error("Compiled build entry is missing.");
  const hash = createHash("sha256").update("build-output-v1\0");
  let total = 0;
  function walk(relative) {
    const absolute = path.join(directory, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Build output symlinks are not allowed.");
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (["build-info.json", "build-source-part.json"].includes(name) ||
            /^build-(?:info|source-part)\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) continue;
        walk(relative ? `${relative}/${name}` : name);
      }
      return;
    }
    total += stat.size;
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || total > 256 * 1024 * 1024)
      throw new Error("Invalid or oversized build output.");
    const bytes = readFileSync(absolute);
    hash.update(`${Buffer.byteLength(relative)}:${relative}:${bytes.length}:`).update(bytes);
  }
  walk("");
  return hash.digest("hex");
}

export function completeBuildStage(root, record, stage) {
  if (!["api", "web"].includes(stage)) throw new Error("Invalid build stage.");
  assertSourceUnchanged(root, record);
  writeRecord(partFile(root, stage), {
    schemaVersion: 1, kind: "build-source-part", stage, record,
    completedAt: new Date().toISOString(),
    outputFingerprintSha256: outputFingerprint(root, stage),
  });
  if (record.mode === "development") {
    if (stage === "api") writeRecord(path.join(root, "artifacts/api-server/dist/build-info.json"),
      buildInfoFromRecord(record, "development"));
    return false;
  }
  return sealBuildIdentity(root, false);
}

export function sealBuildIdentity(root = PROJECT_ROOT, required = true) {
  const record = validateSourceRecord(readBoundedJson(path.join(root, SOURCE_RECORD_PATH)));
  assertSourceUnchanged(root, record);
  const parts = [];
  for (const stage of ["api", "web"]) {
    const file = partFile(root, stage);
    if (!existsSync(file)) {
      if (required) throw new Error("Both API and web build stages must complete before sealing.");
      return false;
    }
    const part = readBoundedJson(file);
    if (!exactKeys(part, ["schemaVersion", "kind", "stage", "record", "completedAt", "outputFingerprintSha256"]) ||
        part.schemaVersion !== 1 || part.kind !== "build-source-part" || part.stage !== stage ||
        !dateValid(part.completedAt) || !SHA.test(part.outputFingerprintSha256))
      throw new Error("Invalid completed build stage.");
    let partDigest;
    try {
      partDigest = sourceRecordDigest(part.record);
    } catch {
      if (required) throw new Error("API and web builds do not share the prepared source identity.");
      return false;
    }
    if (partDigest !== sourceRecordDigest(record)) {
      if (required) throw new Error("API and web builds do not share the prepared source identity.");
      return false;
    }
    if (outputFingerprint(root, stage) !== part.outputFingerprintSha256)
      throw new Error("Compiled output changed after its build stage completed.");
    parts.push(part);
  }
  if (record.mode !== "publish") throw new Error("A development build cannot be sealed for release.");
  const completedAt = parts.map((p) => p.completedAt).sort().at(-1);
  const info = buildInfoFromRecord(record, "release", completedAt);
  writeRecord(path.join(root, "artifacts/api-server/dist/build-info.json"), info);
  writeRecord(path.join(root, "artifacts/run-calculator/dist/public/build-info.json"), info);
  return info;
}