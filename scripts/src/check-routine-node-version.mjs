#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const EVIDENCE_PATH = path.join(
  REPO_ROOT,
  "docs/second-pass-reviewer-benchmark-2026-09-05.json",
);
const NODE_SELECTOR_PATH = path.join(REPO_ROOT, ".nvmrc");
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/ci.yml");
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
  const requiredVersion = evidence?.evaluationManifest?.dependencies?.node;

  if (typeof requiredVersion !== "string" || requiredVersion.trim() === "") {
    throw new Error(
      `Retained evidence does not declare evaluationManifest.dependencies.node: ${evidencePath}`,
    );
  }

  return requiredVersion;
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

export function checkRepositoryNodeVersionContract({
  requiredVersion,
  selectorVersion,
  ciVersions,
}) {
  if (
    typeof requiredVersion !== "string" ||
    typeof selectorVersion !== "string" ||
    !Array.isArray(ciVersions) ||
    ciVersions.length === 0
  ) {
    throw new TypeError(
      "requiredVersion, selectorVersion, and non-empty ciVersions are required",
    );
  }

  const mismatchedCiVersions = ciVersions.filter(
    (version) => version !== requiredVersion,
  );
  if (selectorVersion !== requiredVersion || mismatchedCiVersions.length > 0) {
    throw new Error(
      [
        "Repository Node version contract is out of sync.",
        `Retained evidence: ${requiredVersion}`,
        `.nvmrc selector: ${selectorVersion}`,
        `Explicit CI pins: ${[...new Set(ciVersions)].join(", ")}`,
        "Align the selector and every explicit CI pin without rewriting retained evidence.",
      ].join("\n"),
    );
  }
}

export function main() {
  const requiredVersion = readRequiredNodeVersion();
  checkRepositoryNodeVersionContract({
    requiredVersion,
    selectorVersion: readNodeSelectorVersion(),
    ciVersions: readCiNodeVersions(),
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