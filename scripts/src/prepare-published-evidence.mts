import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_RECORD_PATH,
  PROJECT_ROOT,
  readBoundedJson,
  validateSourceRecord,
  writeRecord,
} from "./build-source-identity.mjs";
import {
  createPublishedSourceHandoffFromMatch,
  verifyPublishedBuild,
} from "./verify-published-build.mjs";
import {
  captureReadinessEvidence,
} from "./capture-readiness-recovery.mts";
import {
  DEFAULT_FROM_DATE,
  DEFAULT_HEAL_ID,
} from "./source-library-reconciliation-capture-core.mjs";
import {
  importSourceLibraryReconciliationEvidence,
} from "./import-source-library-reconciliation-evidence.mts";

const SOURCE_MATCH_RELATIVE_PATH = ".local/build-identity/published-source-match.json";
const SOURCE_HANDOFF_RELATIVE_PATH = ".local/build-identity/published-source-handoff.json";
const READINESS_RELATIVE_PATH = "readiness-recovery/readiness-recovery.json";
const SOURCE_RECONCILIATION_RELATIVE_PATH = "source-library-reconciliation.json";
const MAX_RECONCILIATION_RESPONSE_BYTES = 256_000;
const RECONCILIATION_TIMEOUT_MS = 25_000;

type PreparePublishedEvidenceOptions = {
  url: string;
  evidenceDirectory: string;
  expectedFile?: string;
  reportPath: string;
  healId: string;
  fromDate: string;
  sourceMatchPath?: string;
  sourceHandoffPath?: string;
  fetchImpl?: typeof fetch;
};

type PreparePublishedEvidenceDependencies = {
  verifyPublishedBuild?: typeof verifyPublishedBuild;
  captureReadinessEvidence?: typeof captureReadinessEvidence;
  captureReconciliation?: typeof captureReconciliation;
  importSourceLibraryReconciliationEvidence?: typeof importSourceLibraryReconciliationEvidence;
};

function officialHttpsOrigin(value: string): URL {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error("The official Replit primary URL is invalid.");
  }
  if (target.protocol !== "https:" || target.username || target.password ||
      target.pathname !== "/" || target.search || target.hash) {
    throw new Error("Use the official HTTPS primary URL without credentials, path, or query parameters.");
  }
  return target;
}

async function readBoundedCapture(response: Response): Promise<Uint8Array> {
  if (response.status === 429) {
    await response.body?.cancel();
    throw new Error("Published reconciliation capture is rate-limited; honor Retry-After before retrying.");
  }
  if (response.status === 409) {
    await response.body?.cancel();
    throw new Error("A published reconciliation capture is already in progress.");
  }
  if (response.status !== 200 ||
      !response.headers.get("content-type")?.includes("application/json") ||
      !response.body) {
    await response.body?.cancel();
    throw new Error("Published reconciliation capture is unavailable or has an unexpected response.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RECONCILIATION_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Published reconciliation capture exceeds its response budget.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
  } catch {
    throw new Error("Published reconciliation capture is invalid.");
  }
  return bytes;
}

async function captureReconciliation(
  target: URL,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(
      new URL("/api/profile-data/source-library-reconciliation/capture", target),
      {
        signal: AbortSignal.timeout(RECONCILIATION_TIMEOUT_MS),
        redirect: "error",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      },
    );
  } catch {
    throw new Error("Published reconciliation capture could not be reached safely.");
  }
  return readBoundedCapture(response);
}

export async function preparePublishedEvidence(
  options: PreparePublishedEvidenceOptions,
  dependencies: PreparePublishedEvidenceDependencies = {},
): Promise<{
  appBuildId: string;
  sourceFingerprintSha256: string;
  files: string[];
}> {
  const target = officialHttpsOrigin(options.url);
  const expected = validateSourceRecord(readBoundedJson(path.resolve(
    options.expectedFile ?? path.join(PROJECT_ROOT, EXPECTED_RECORD_PATH),
  )));
  const fetchImpl = options.fetchImpl ?? fetch;
  const verify = dependencies.verifyPublishedBuild ?? verifyPublishedBuild;
  const captureReady = dependencies.captureReadinessEvidence ?? captureReadinessEvidence;
  const captureReconciliationEvidence = dependencies.captureReconciliation ?? captureReconciliation;
  const importReconciliation = dependencies.importSourceLibraryReconciliationEvidence ??
    importSourceLibraryReconciliationEvidence;
  const match = await verify({
    url: target.origin,
    expected,
    fetchImpl,
  });
  const handoff = createPublishedSourceHandoffFromMatch(match, expected);
  const finalFiles = [
    [".local/build-identity/published-source-match.json",
      options.sourceMatchPath ?? path.join(PROJECT_ROOT, SOURCE_MATCH_RELATIVE_PATH)],
    [".local/build-identity/published-source-handoff.json",
      options.sourceHandoffPath ?? path.join(PROJECT_ROOT, SOURCE_HANDOFF_RELATIVE_PATH)],
    ["readiness-recovery/readiness-recovery.json",
      path.join(options.evidenceDirectory, READINESS_RELATIVE_PATH)],
    ["source-library-reconciliation.json",
      path.join(options.evidenceDirectory, SOURCE_RECONCILIATION_RELATIVE_PATH)],
  ] as const;
  const stageDirectory = path.join(
    PROJECT_ROOT,
    ".local/build-identity",
    `.published-evidence-${randomUUID()}`,
  );
  await mkdir(stageDirectory, { recursive: true });
  try {
    const stagedMatch = path.join(stageDirectory, "published-source-match.json");
    const stagedHandoff = path.join(stageDirectory, "published-source-handoff.json");
    const stagedReadiness = path.join(stageDirectory, "readiness-recovery.json");
    const stagedReconciliation = path.join(stageDirectory, "source-library-reconciliation.json");
    writeRecord(stagedMatch, match);
    writeRecord(stagedHandoff, handoff);

    const readiness = await captureReady({
      url: new URL("/api/readyz", target).toString(),
      environment: "release",
      deploymentHandoffPath: stagedHandoff,
      mode: "normal",
      outputPath: stagedReadiness,
    });
    if (!readiness.verification.passed)
      throw new Error("Published readiness evidence did not pass verification.");

    const reconciliationBytes = await captureReconciliationEvidence(target, fetchImpl);
    await importReconciliation({
      inputBytes: reconciliationBytes,
      output: stagedReconciliation,
      report: options.reportPath,
      healId: options.healId,
      fromDate: options.fromDate,
      deploymentHandoffPath: stagedHandoff,
    });

    const finalMatch = await verify({
      url: target.origin,
      expected,
      fetchImpl,
    });
    if (finalMatch.appBuildId !== match.appBuildId ||
        finalMatch.sourceFingerprintSha256 !== match.sourceFingerprintSha256) {
      throw new Error("Published source changed during evidence preparation.");
    }

    const stagedFiles = [stagedMatch, stagedHandoff, stagedReadiness, stagedReconciliation];
    for (let index = 0; index < finalFiles.length; index += 1) {
      const [, destination] = finalFiles[index]!;
      await mkdir(path.dirname(destination), { recursive: true });
      const promotionFile = `${destination}.${randomUUID()}.tmp`;
      try {
        await copyFile(stagedFiles[index]!, promotionFile);
        await rename(promotionFile, destination);
      } finally {
        await rm(promotionFile, { force: true });
      }
    }
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }

  return {
    appBuildId: match.appBuildId,
    sourceFingerprintSha256: match.sourceFingerprintSha256,
    files: finalFiles.map(([, destination]) => destination),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error("Run post-publish evidence preparation through release-check.mts.");
  process.exitCode = 2;
}
