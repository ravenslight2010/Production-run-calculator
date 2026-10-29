import { resolve, relative, sep } from "node:path";
import { lstat, mkdir, chmod, open } from "node:fs/promises";
import { constants } from "node:fs";
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

const MAX_LOCAL_REPORT_BYTES = 256 * 1024;
const LOCAL_STATUSES = [
  "PASS", "FAIL", "INFRASTRUCTURE TIMEOUT", "INFRASTRUCTURE ERROR", "BLOCKED", "NOT REACHED",
] as const;

/** Read metadata only, never create directories, follow links, or read raw logs. */
export async function readLocalReleaseReport(root: string, destination: string): Promise<string> {
  destination = localReleaseEvidenceDirectory(root, false, destination);
  try {
    let current = resolve(root);
    for (const part of relative(root, destination).split(sep)) {
      current = resolve(current, part);
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error();
    }
    const filename = resolve(destination, "local-check-report.md");
    const entry = await lstat(filename);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error();
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_LOCAL_REPORT_BYTES) throw new Error();
      const bytes = Buffer.alloc(MAX_LOCAL_REPORT_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_LOCAL_REPORT_BYTES) throw new Error();
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    } finally {
      await file.close();
    }
  } catch {
    throw new Error("Local report is missing, unreadable, oversized, or uses an unsafe path.");
  }
}

/** A local PASS is metadata consistency, not authentication or production approval. */
export function verifyLocalReleaseReport(text: string, options: {
  identity: LocalReleaseIdentity;
  full: boolean;
  expectedLabels: readonly string[];
}): void {
  if (Buffer.byteLength(text) > MAX_LOCAL_REPORT_BYTES) throw new Error("Local report is oversized.");
  const lines = text.split("\n");
  const captured = lines[3]?.replace(/^Captured: /, "");
  if (!captured || !Number.isFinite(Date.parse(captured)) ||
      new Date(captured).toISOString() !== captured) {
    throw new Error("Local report has an invalid capture time.");
  }
  const outcome = lines[10]?.replace(/^Local result: /, "");
  if (!["PASS", "FAIL", "INCOMPLETE"].includes(outcome ?? "")) {
    throw new Error("Local report has an invalid result.");
  }
  const results = options.expectedLabels.map((label, index): ReleaseStepResult => {
    const status = LOCAL_STATUSES.find((value) => lines[18 + index] === `- ${value} ${label}`);
    if (!status) throw new Error("Local report requires exact check identities and permitted statuses.");
    return { label, status, elapsedMs: 0 };
  });
  const canonical = formatLocalReleaseReport({
    ...options, results, completed: outcome !== "INCOMPLETE",
  }).replace(/^Captured: .+$/m, `Captured: ${captured}`);
  if (text !== canonical) {
    throw new Error("Local report is malformed, stale, or mismatched with this checkout/check set.");
  }
  if (outcome !== "PASS") {
    throw new Error(`Local report is ${outcome}; a complete local PASS is required.`);
  }
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
    expectedLabels.some((label) => !/^[A-Za-z0-9 ()/.:;_-]{1,160}$/.test(label))
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
