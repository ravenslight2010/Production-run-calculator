#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverRetainedEvaluationPaths as discoverSharedRetainedEvaluationPaths,
  evaluationManifestFromEvidence,
  RETAINED_EVALUATION_CANONICAL_RELATIVE_PATH,
  retainedEvaluationDirectories,
} from "./retained-evaluation-contract.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const RETAINED_EVIDENCE_DIRECTORIES = retainedEvaluationDirectories(REPO_ROOT);
const CURRENT_EVALUATION_MANIFEST_PATH = path.join(
  REPO_ROOT,
  RETAINED_EVALUATION_CANONICAL_RELATIVE_PATH,
);
const NODE_SELECTOR_PATH = path.join(REPO_ROOT, ".nvmrc");
const CI_WORKFLOW_PATHS = [
  path.join(REPO_ROOT, ".github/workflows/ci.yml"),
  path.join(REPO_ROOT, ".github/workflows/release-check.yml"),
];
const CI_WORKFLOW_PATH = CI_WORKFLOW_PATHS[0];
const REPRODUCTION_COMMAND =
  "bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run test";

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

  throw new Error(
    [
      "Routine scripts validation requires the Node version bound to retained evidence.",
      `Actual Node version: ${actualVersion}`,
      `Required Node version: ${requiredVersion}`,
      `Safe reproduction command: ${REPRODUCTION_COMMAND}`,
      "The preflight did not rewrite retained evidence.",
    ].join("\n"),
  );
}


export function readRequiredNodeVersion(
  evidencePath = CURRENT_EVALUATION_MANIFEST_PATH,
) {
  const evidence = readRetainedEvaluationJson(evidencePath);
  const manifest = evaluationManifestFromEvidence(evidence);
  const requiredVersion = manifest?.dependencies?.node;

  if (typeof requiredVersion !== "string" || requiredVersion.trim() === "") {
    throw new Error(
      `Retained evidence does not declare a valid evaluation manifest Node version: ${evidencePath}`,
    );
  }

  return requiredVersion;
}

export function readCurrentEvaluationNodeVersion(
  evidencePath = CURRENT_EVALUATION_MANIFEST_PATH,
) {
  return readRequiredNodeVersion(evidencePath);
}

function readRetainedEvaluationJson(evidencePath) {
  let contents;
  try {
    contents = fs.readFileSync(evidencePath, "utf8");
  } catch {
    throw new Error(
      `Unable to read retained evaluation evidence: ${evidencePath}`,
    );
  }

  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`Malformed retained evaluation JSON: ${evidencePath}`);
  }
}

export function discoverRetainedEvaluationPaths(
  evidenceDirectories = RETAINED_EVIDENCE_DIRECTORIES,
) {
  return discoverSharedRetainedEvaluationPaths(evidenceDirectories);
}

export function readRequiredNodeVersions(
  evidencePaths = discoverRetainedEvaluationPaths(),
) {
  return readRequiredNodeVersionEntries(evidencePaths).map(
    ({ requiredVersion }) => requiredVersion,
  );
}

export function readRequiredNodeVersionEntries(
  evidencePaths = discoverRetainedEvaluationPaths(),
) {
  if (!Array.isArray(evidencePaths) || evidencePaths.length === 0) {
    throw new TypeError("evidencePaths must be a non-empty array");
  }

  return evidencePaths.map((evidencePath) => ({
    evidencePath,
    requiredVersion: readRequiredNodeVersion(evidencePath),
  }));
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
  currentVersion,
  selectorVersion,
  ciVersions,
}) {
  if (
    typeof currentVersion !== "string" ||
    currentVersion.trim() === "" ||
    typeof selectorVersion !== "string" ||
    !Array.isArray(ciVersions) ||
    ciVersions.length === 0
  ) {
    throw new TypeError(
      "currentVersion, selectorVersion, and non-empty ciVersions are required",
    );
  }

  const mismatchedCiVersions = ciVersions.filter(
    (version) => version !== currentVersion,
  );
  if (
    selectorVersion !== currentVersion ||
    mismatchedCiVersions.length > 0
  ) {
    throw new Error(
      [
        "Repository Node version contract is out of sync.",
        `Current evaluation manifest: ${currentVersion}`,
        `.nvmrc selector: ${selectorVersion}`,
        `Explicit CI pins: ${[...new Set(ciVersions)].join(", ")}`,
        "Align the canonical current evaluation manifest, selector, and explicit CI pins. Preserve dated evidence as historical provenance.",
      ].join("\n"),
    );
  }

  return currentVersion;
}

export function main() {
  const currentVersion = checkRepositoryNodeVersionContract({
    currentVersion: readCurrentEvaluationNodeVersion(),
    selectorVersion: readNodeSelectorVersion(),
    ciVersions: readAllCiNodeVersions(),
  });
  checkRoutineNodeVersion({
    actualVersion: process.versions.node,
    requiredVersion: currentVersion,
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