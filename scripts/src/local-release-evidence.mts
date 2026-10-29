import { resolve, relative, sep } from "node:path";
import { lstat, mkdir, chmod } from "node:fs/promises";
import { assessmentRevision } from "./release-source-identity.mjs";
import type { ReleaseStepResult } from "./release-check.mts";

export type LocalReleaseIdentity = {
  revision: string;
  sourceRevision: string;
  sourcePolicy: string;
  sourceFingerprintSha256: string;
  verificationFingerprintSha256: string;
};

export function localReleaseEvidenceDirectory(
  root: string,
  full: boolean,
  configured?: string,
): string {
  const base = resolve(root, ".local/release-check");
  const destination = resolve(root, configured ?? `.local/release-check/${full ? "full" : "standard"}`);
  const child = relative(base, destination);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || resolve(base, child) !== destination) {
    throw new Error("Local-only evidence must use a child directory of .local/release-check.");
  }
  return destination;
}

export async function prepareLocalReleaseDirectory(root: string, destination: string): Promise<void> {
  const parts = relative(root, destination).split(sep);
  let current = resolve(root);
  for (const part of parts) {
    current = resolve(current, part);
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("Local evidence directories must not contain symlinks or non-directories.");
    }
  }
  await chmod(destination, 0o700);
}

export function formatLocalReleaseReport(options: {
  identity: LocalReleaseIdentity;
  full: boolean;
  expectedLabels: readonly string[];
  results: readonly ReleaseStepResult[];
  completed: boolean;
}): string {
  const { identity, expectedLabels, results } = options;
  if (
    identity.revision !== assessmentRevision(identity.sourcePolicy,
      identity.sourceFingerprintSha256, identity.verificationFingerprintSha256) ||
    identity.sourceRevision !== `source-sha256:${identity.sourceFingerprintSha256}`
  ) throw new Error("Local evidence requires matching source and verification fingerprints.");
  if (
    expectedLabels.length === 0 ||
    new Set(expectedLabels).size !== expectedLabels.length ||
    new Set(results.map((result) => result.label)).size !== results.length ||
    results.some((result) => !expectedLabels.includes(result.label)) ||
    expectedLabels.some((label) => !/^[A-Za-z0-9 ()/.:_-]{1,160}$/.test(label))
  ) throw new Error("Local evidence requires exact, unique check identities.");
  const passed = options.completed && results.length === expectedLabels.length &&
    results.every((result) => result.status === "PASS");
  return [
    "# Local Verification Report",
    "Scope: local-only",
    `Check set: ${options.full ? "full" : "standard"}`,
    `Captured: ${new Date().toISOString()}`,
    "Environment: local runner; fixture/development checks, not production evidence",
    `Assessed revision: ${identity.revision}`,
    `Source revision: ${identity.sourceRevision}`,
    `Source policy: ${identity.sourcePolicy}`,
    `Source fingerprint SHA-256: ${identity.sourceFingerprintSha256}`,
    `Verification fingerprint SHA-256: ${identity.verificationFingerprintSha256}`,
    `Local result: ${passed ? "PASS" : options.completed ? "FAIL" : "INCOMPLETE"}`,
    "Production decision: NOT ASSESSED",
    "Published readiness: NOT ASSESSED",
    "Production reconciliation: NOT ASSESSED",
    "This report cannot satisfy published readiness, reconciliation, or release approval.",
    "Producing command: pnpm run release:check:local" + (options.full ? " -- --full" : ""),
    "Sanitization: check identities/statuses only; raw logs and payloads remain private.",
    "",
    ...expectedLabels.map((label) => {
      const result = results.find((item) => item.label === label);
      return `- ${result?.status ?? "NOT REACHED"} ${label}`;
    }),
    "",
  ].join("\n");
}
