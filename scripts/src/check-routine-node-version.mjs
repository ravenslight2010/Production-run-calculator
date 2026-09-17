#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const RETAINED_EVIDENCE_DIRECTORIES = [
  path.join(
    REPO_ROOT,
    "lib/corpus-harness/snapshots",
  ),
  path.join(
    REPO_ROOT,
    "docs",
  ),
];
const EVIDENCE_PATH = path.join(
  REPO_ROOT,
  "docs/second-pass-reviewer-benchmark-2026-09-05.json",
);
const NODE_SELECTOR_PATH = path.join(REPO_ROOT, ".nvmrc");
const CI_WORKFLOW_PATHS = [
  path.join(REPO_ROOT, ".github/workflows/ci.yml"),
  path.join(REPO_ROOT, ".github/workflows/release-check.yml"),
];
const CI_WORKFLOW_PATH = CI_WORKFLOW_PATHS[0];
const REPRODUCTION_COMMAND =
  "npx --yes --package=node@<required> -- pnpm --filter @workspace/scripts run test";

export function checkRoutineNodeVersion({
  actualVersion,
  requiredVersion,
} = {}) {
  if (
    typeof actualVersion !== "string" ||
    typeof requiredVersion !== "string" ||
    requiredVersion.trim() === ""
  ) {
    throw new TypeError(
      "actualVersion and requiredVersion must be non-empty strings",
    );
  }

  if (actualVersion === requiredVersion) {
    return;
  }

  const reproductionCommand = REPRODUCTION_COMMAND.replace(
    "<required>",
    requiredVersion,
  );
  throw new Error(
    [
      "Routine scripts validation requires the Node version bound to retained evidence.",
      `Actual Node version: ${actualVersion}`,
      `Required Node version: ${requiredVersion}`,
      `Safe reproduction command: ${reproductionCommand}`,
      "The preflight did not rewrite retained evidence.",
    ].join("\n"),
  );
}


export function readRequiredNodeVersion(evidencePath = EVIDENCE_PATH) {
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const manifest = evidence?.evaluationManifest ?? evidence;
  const requiredVersion = manifest?.dependencies?.node;

  if (typeof requiredVersion !== "string" || requiredVersion.trim() === "") {
    throw new Error(
      `Retained evidence does not declare a valid evaluation manifest Node version: ${evidencePath}`,
    );
  }

  return requiredVersion;
}

function isEvaluationManifestCandidate(evidence) {
  return (
    evidence &&
    typeof evidence === "object" &&
    !Array.isArray(evidence) &&
    ("manifestVersion" in evidence || "evaluationManifest" in evidence)
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

export function discoverRetainedEvaluationPaths(
  evidenceDirectories = RETAINED_EVIDENCE_DIRECTORIES,
) {
  if (
    !Array.isArray(evidenceDirectories) ||
    evidenceDirectories.length === 0 ||
    evidenceDirectories.some(
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

export function readRequiredNodeVersions(
  evidencePaths = discoverRetainedEvaluationPaths(),
) {
  if (!Array.isArray(evidencePaths) || evidencePaths.length === 0) {
    throw new TypeError("evidencePaths must be a non-empty array");
  }

  return evidencePaths.map((evidencePath) =>
    readRequiredNodeVersion(evidencePath),
  );
}

export function readNodeSelectorVersion(selectorPath = NODE_SELECTOR_PATH) {
  const selectorVersion = fs.readFileSync(selectorPath, "utf8").trim();

  if (selectorVersion === "") {
    throw new Error(`Node runtime selector is empty: ${selectorPath}`);
  }

  return selectorVersion;
}

export function readCiNodeVersions(ciWorkflowPath = CI_WORKFLOW_PATH) {
  const workflow = fs.readFileSync(ciWorkflowPath, "utf8");
  const versions = [
    ...workflow.matchAll(
      /^\s*node-version:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/gm,
    ),
  ].map((match) => match[1]);

  if (versions.length === 0) {
    throw new Error(
      `CI workflow does not declare an explicit node-version: ${ciWorkflowPath}`,
    );
  }

  return versions;
}

export function readAllCiNodeVersions(ciWorkflowPaths = CI_WORKFLOW_PATHS) {
  if (!Array.isArray(ciWorkflowPaths) || ciWorkflowPaths.length === 0) {
    throw new TypeError("ciWorkflowPaths must be a non-empty array");
  }

  return ciWorkflowPaths.flatMap((ciWorkflowPath) =>
    readCiNodeVersions(ciWorkflowPath),
  );
}

export function checkRepositoryNodeVersionContract({
  requiredVersion,
  requiredVersions,
  selectorVersion,
  ciVersions,
}) {
  const retainedVersions = requiredVersions ?? [requiredVersion];
  if (
    !Array.isArray(retainedVersions) ||
    retainedVersions.length === 0 ||
    retainedVersions.some(
      (version) => typeof version !== "string" || version.trim() === "",
    ) ||
    typeof selectorVersion !== "string" ||
    !Array.isArray(ciVersions) ||
    ciVersions.length === 0
  ) {
    throw new TypeError(
      "requiredVersions, selectorVersion, and non-empty ciVersions are required",
    );
  }

  const requiredVersionsSet = new Set(retainedVersions);
  const requiredNodeVersion = retainedVersions[0];
  const mismatchedCiVersions = ciVersions.filter(
    (version) => version !== requiredNodeVersion,
  );
  if (
    requiredVersionsSet.size > 1 ||
    selectorVersion !== requiredNodeVersion ||
    mismatchedCiVersions.length > 0
  ) {
    throw new Error(
      [
        "Repository Node version contract is out of sync.",
        `Retained evidence: ${[...requiredVersionsSet].join(", ")}`,
        `.nvmrc selector: ${selectorVersion}`,
        `Explicit CI pins: ${[...new Set(ciVersions)].join(", ")}`,
        "Align every retained manifest, the selector, and every explicit CI pin without rewriting retained evidence.",
      ].join("\n"),
    );
  }

  return requiredNodeVersion;
}

export function main() {
  const requiredVersion = checkRepositoryNodeVersionContract({
    requiredVersions: readRequiredNodeVersions(),
    selectorVersion: readNodeSelectorVersion(),
    ciVersions: readAllCiNodeVersions(),
  });
  checkRoutineNodeVersion({
    actualVersion: process.versions.node,
    requiredVersion,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}