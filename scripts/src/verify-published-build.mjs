import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceRevision } from "./release-source-identity.mjs";
import {
  EXPECTED_RECORD_PATH, PROJECT_ROOT, readBoundedJson, sourceRecordDigest,
  validateBuildInfo, validateSourceRecord, writeRecord,
} from "./build-source-identity.mjs";

export async function verifyPublishedBuild({ url, expected, timeoutMs = 15_000 }) {
  validateSourceRecord(expected);
  if (expected.mode !== "publish") throw new Error("The expected record must be a publish candidate.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new Error("Invalid build-identity timeout.");
  const target = new URL(url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if ((target.protocol !== "https:" && !(loopback && target.protocol === "http:")) ||
      target.username || target.password || target.search || target.hash)
    throw new Error("Use the official HTTPS app URL without credentials or query parameters.");
  const response = await fetch(new URL("/api/build-info", target), {
    signal: AbortSignal.timeout(timeoutMs), redirect: "error",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Published build metadata is unavailable or has an unexpected response.");
  if (!response.body) throw new Error("Published build metadata is empty.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) {
        await reader.cancel();
        throw new Error("Published build metadata exceeds its response budget.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const actual = validateBuildInfo(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (actual.buildMode !== "release") throw new Error("Published metadata is not a complete release build.");
  for (const key of ["appBuildId", "sourcePolicy", "sourceFingerprintSha256"]) {
    if (actual[key] !== expected[key]) throw new Error("Published source does not match the expected build.");
  }
  const now = new Date();
  if (Date.parse(actual.completedAt) < Date.parse(expected.preparedAt) ||
      Date.parse(actual.completedAt) > now.getTime() + 60_000)
    throw new Error("Published build timestamps conflict with the expected record.");
  return {
    schemaVersion: 1, kind: "published-source-match", status: "source-match",
    authority: "application-source-comparison-only", productionGo: false,
    expectedRecordSha256: sourceRecordDigest(expected),
    appBuildId: actual.appBuildId, sourcePolicy: actual.sourcePolicy,
    sourceFingerprintSha256: actual.sourceFingerprintSha256,
    gitRevision: actual.gitRevision, gitBinding: actual.gitBinding,
    builtAt: actual.completedAt, capturedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    unresolvedIdentityRequirements: [
      "controlled-published-deployment-handoff",
    ],
  };
}

export async function createPublishedSourceHandoff(options) {
  // Never accept a supplied receipt as proof: repeat the bounded live lookup
  // against the separately prepared expectation.
  const match = await verifyPublishedBuild(options);
  return {
    schemaVersion: 2, kind: "published-source-deployment-handoff",
    identityAuthority: "independent-expected-source-comparison",
    deploymentId: match.appBuildId, appBuildId: match.appBuildId,
    deployedRevision: sourceRevision(match.sourceFingerprintSha256),
    sourcePolicy: match.sourcePolicy,
    sourceFingerprintSha256: match.sourceFingerprintSha256,
    expectedRecordSha256: match.expectedRecordSha256,
    expectedSource: validateSourceRecord(options.expected),
    issuedAt: match.capturedAt, expiresAt: match.expiresAt,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--url", "--expected-file", "--output", "--handoff-output"].includes(args[i]) ||
        !args[i + 1] || Object.hasOwn(options, args[i])) throw new Error("Invalid version-check arguments.");
    options[args[i]] = args[i + 1];
  }
  if (!options["--url"]) throw new Error("An official published target is required.");
  const expected = readBoundedJson(path.resolve(options["--expected-file"] ??
    path.join(PROJECT_ROOT, EXPECTED_RECORD_PATH)));
  const receipt = await verifyPublishedBuild({ url: options["--url"], expected });
  writeRecord(path.resolve(options["--output"] ??
    path.join(PROJECT_ROOT, ".local/build-identity/published-source-match.json")), receipt);
  if (options["--handoff-output"]) {
    const handoff = await createPublishedSourceHandoff({ url: options["--url"], expected });
    writeRecord(path.resolve(options["--handoff-output"]), handoff);
  }
  console.log(JSON.stringify(receipt));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const safeReasons = new Set([
      "Invalid version-check arguments.",
      "An official published target is required.",
      "Invalid prepared build-source record.",
      "The expected record must be a publish candidate.",
      "Use the official HTTPS app URL without credentials or query parameters.",
      "Published build metadata is unavailable or has an unexpected response.",
      "Published build metadata is empty.",
      "Published build metadata exceeds its response budget.",
      "Invalid sealed build identity.",
      "Published metadata is not a complete release build.",
      "Published source does not match the expected build.",
      "Published build timestamps conflict with the expected record.",
      "Build identity record contains invalid JSON.",
    ]);
    const reason = error instanceof Error && safeReasons.has(error.message) ? error.message :
      error?.name === "TimeoutError" || error?.name === "AbortError" ? "The version lookup timed out." :
      "The expected record or published metadata could not be read safely.";
    console.error(`Published version check BLOCKED: ${reason} No release approval was created.`);
    process.exitCode = 1;
  });
}