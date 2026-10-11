import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fingerprintSource, SOURCE_POLICY } from "./build-source-files.mjs";

const SOURCE = /^source-sha256:[a-f0-9]{64}$/;
const ASSESSMENT = /^test-sha256:[a-f0-9]{64}$/;
const LEGACY = /^[a-f0-9]{40}$/;
export const isSourceRevision = (value) => typeof value === "string" && SOURCE.test(value);
export const isDeploymentRevision = (value) => typeof value === "string" &&
  (SOURCE.test(value) || LEGACY.test(value));
export const isEvidenceRevision = (value) => typeof value === "string" &&
  (SOURCE.test(value) || ASSESSMENT.test(value) || LEGACY.test(value));
export const isAssessmentRevision = (value) => typeof value === "string" && ASSESSMENT.test(value);
export function assessmentRevision(policy, source, verification) {
  if (policy !== SOURCE_POLICY ||
      !/^[a-f0-9]{64}$/.test(source) || !/^[a-f0-9]{64}$/.test(verification))
    throw new Error("Invalid source/verification identity.");
  return `test-sha256:${createHash("sha256").update(JSON.stringify([
    policy, source, verification,
  ])).digest("hex")}`;
}
export const sourceRevision = (fingerprint) => {
  if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint))
    throw new Error("Invalid production-source fingerprint.");
  return `source-sha256:${fingerprint}`;
};

// Test evidence has a separate identity: production fingerprints intentionally
// exclude tests, so changing a test/policy must invalidate an old test result.
export function captureReleaseIdentity(root) {
  const production = fingerprintSource(root);
  const hash = createHash("sha256").update("verification-inputs-v1\0");
  const excluded = new Set(["node_modules", ".git", ".local", "dist", "coverage",
    "captures", "evidence", "datasets", "corpus", "test-results", "playwright-report"]);
  let total = 0;
  let count = 0;
  function walk(relative) {
    const absolute = path.join(root, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Verification input symlinks are not allowed.");
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (!excluded.has(name) && !name.startsWith(".env")) walk(`${relative}/${name}`);
      }
    } else if (stat.isFile()) {
      if (/\.(?:log|tsbuildinfo)$/.test(relative)) return;
      total += stat.size;
      if (++count > 30_000 || stat.size > 16 * 1024 * 1024 || total > 256 * 1024 * 1024)
        throw new Error("Verification input budget exceeded.");
      const bytes = readFileSync(absolute);
      hash.update(`${Buffer.byteLength(relative)}:${relative}:${bytes.length}:`).update(bytes);
    } else throw new Error("Invalid verification input.");
  }
  for (const base of ["scripts/src", "lib", "artifacts/api-server/src",
    "artifacts/run-calculator/src", "artifacts/run-calculator/e2e", ".agents/skills",
    ".github/workflows"]) {
    try { lstatSync(path.join(root, base)); } catch { continue; }
    walk(base);
  }
  walk("scripts/package.json");
  // Browser/test configuration lives outside src/e2e.
  for (const artifact of ["api-server", "run-calculator"]) {
    const directory = path.join(root, "artifacts", artifact);
    for (const name of readdirSync(directory).sort()) {
      if (/^(?:playwright|vitest|tsconfig).*\.|^package\.json$/.test(name))
        walk(`artifacts/${artifact}/${name}`);
    }
  }
  const verificationFingerprintSha256 = hash.digest("hex");
  const revision = assessmentRevision(production.sourcePolicy,
    production.sourceFingerprintSha256, verificationFingerprintSha256);
  return {
    revision, sourceRevision: sourceRevision(production.sourceFingerprintSha256),
    sourcePolicy: production.sourcePolicy,
    sourceFingerprintSha256: production.sourceFingerprintSha256,
    verificationFingerprintSha256,
  };
}