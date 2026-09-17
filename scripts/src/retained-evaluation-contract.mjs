import fs from "node:fs";
import path from "node:path";

/**
 * Retained evaluation files are discovered from these repository locations.
 * Keep this list and the accepted manifest envelopes shared by every release
 * gate that reasons about retained evaluations.
 */
export const RETAINED_EVALUATION_DIRECTORY_RELATIVE_PATHS = Object.freeze([
  "lib/corpus-harness/snapshots",
  "docs",
]);

export const RETAINED_EVALUATION_MANIFEST_ENVELOPES = Object.freeze([
  "root",
  "evaluationManifest",
]);

export const RETAINED_EVALUATION_CANONICAL_RELATIVE_PATH =
  "lib/corpus-harness/snapshots/evaluation-manifest.json";

export function retainedEvaluationDirectories(repoRoot) {
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") {
    throw new TypeError("repoRoot must be a non-empty string");
  }

  return RETAINED_EVALUATION_DIRECTORY_RELATIVE_PATHS.map((relativePath) =>
    path.join(repoRoot, relativePath),
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function evaluationManifestFromEvidence(evidence) {
  if (!isRecord(evidence)) return undefined;
  if (
    RETAINED_EVALUATION_MANIFEST_ENVELOPES.includes("evaluationManifest")
    && "evaluationManifest" in evidence
  ) {
    return evidence.evaluationManifest;
  }
  if (
    RETAINED_EVALUATION_MANIFEST_ENVELOPES.includes("root")
    && "manifestVersion" in evidence
  ) {
    return evidence;
  }
  return undefined;
}

export function isEvaluationManifestCandidate(evidence) {
  return evaluationManifestFromEvidence(evidence) !== undefined
    || (
      isRecord(evidence)
      && (
        (
          RETAINED_EVALUATION_MANIFEST_ENVELOPES.includes("root")
          && "manifestVersion" in evidence
        )
        || (
          RETAINED_EVALUATION_MANIFEST_ENVELOPES.includes("evaluationManifest")
          && "evaluationManifest" in evidence
        )
      )
    );
}

function findJsonFiles(directoryPath) {
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return findJsonFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
    });
}

function isRetainedEvaluationPath(evidencePath) {
  const fileName = path.basename(evidencePath, path.extname(evidencePath));
  return /(?:evaluation|benchmark|manifest)/i.test(fileName);
}

export function discoverRetainedEvaluationPaths(evidenceDirectories) {
  if (
    !Array.isArray(evidenceDirectories)
    || evidenceDirectories.length === 0
    || evidenceDirectories.some(
      (directoryPath) =>
        typeof directoryPath !== "string" || directoryPath.trim() === "",
    )
  ) {
    throw new TypeError("evidenceDirectories must be a non-empty array");
  }

  const discoveredPaths = evidenceDirectories
    .flatMap((directoryPath) => findJsonFiles(directoryPath))
    .filter((evidencePath) => {
      let evidence;
      try {
        evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
      } catch {
        if (isRetainedEvaluationPath(evidencePath)) {
          throw new Error(
            `Malformed retained evaluation JSON: ${evidencePath}`,
          );
        }
        return false;
      }
      return isEvaluationManifestCandidate(evidence);
    });

  if (discoveredPaths.length === 0) {
    throw new Error(
      "No retained evaluation manifests were found in the supported evidence locations",
    );
  }

  return [...new Set(discoveredPaths)].sort((left, right) =>
    left.localeCompare(right),
  );
}