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
const CI_WORKFLOW_DIRECTORY = path.join(REPO_ROOT, ".github/workflows");
const NODE_COMPATIBILITY_WORKFLOW_PATH = path.join(
  CI_WORKFLOW_DIRECTORY,
  "node-compatibility-advisory.yml",
);
const NODE_COMPATIBILITY_COMPARISON_VERSION = "26.10.0";
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
const PNPM_LOCK_PATH = path.join(REPO_ROOT, "pnpm-lock.yaml");
const REPLIT_CONFIG_PATH = path.join(REPO_ROOT, ".replit");
const REPLIT_NIX_PATH = path.join(REPO_ROOT, "replit.nix");
const PYPROJECT_PATH = path.join(REPO_ROOT, "pyproject.toml");
const DOCKERFILE_PATH = path.join(REPO_ROOT, "Dockerfile");
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

export function discoverAllCiWorkflowPaths(
  workflowDirectory = CI_WORKFLOW_DIRECTORY,
) {
  return fs
    .readdirSync(workflowDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /\.(?:yml|yaml)$/i.test(entry.name),
    )
    .map((entry) => path.join(workflowDirectory, entry.name))
    .sort();
}

export function discoverCiWorkflowPaths(workflowDirectory = CI_WORKFLOW_DIRECTORY) {
  return discoverAllCiWorkflowPaths(workflowDirectory).filter(
    (workflowPath) =>
      path.basename(workflowPath) !==
      path.basename(NODE_COMPATIBILITY_WORKFLOW_PATH),
  );
}

export function readCiNodeVersions(
  ciWorkflowPath,
  selectorVersion = readNodeSelectorVersion(),
) {
  const workflow = fs.readFileSync(ciWorkflowPath, "utf8");
  const setupNodeSteps = [
    ...workflow.matchAll(/^\s*(?:-\s+)?uses:\s*actions\/setup-node@/gm),
  ].length;
  const versionFiles = [
    ...workflow.matchAll(
      /^\s*node-version-file:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/gm,
    ),
  ].map((match) => match[1]);
  const explicitVersions = [
    ...workflow.matchAll(
      /^\s*node-version:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/gm,
    ),
  ].map((match) => match[1]);
  const unsupportedVersionFiles = versionFiles.filter(
    (versionFile) => versionFile !== ".nvmrc",
  );

  if (unsupportedVersionFiles.length > 0) {
    throw new Error(
      `CI Node pins must use .nvmrc, not ${unsupportedVersionFiles.join(", ")}: ${ciWorkflowPath}`,
    );
  }

  const pinCount = versionFiles.length + explicitVersions.length;
  if (setupNodeSteps === 0 || pinCount === 0 || setupNodeSteps !== pinCount) {
    throw new Error(
      `Every actions/setup-node step must declare exactly one Node pin: ${ciWorkflowPath}`,
    );
  }

  return [
    ...versionFiles.map(() => selectorVersion),
    ...explicitVersions,
  ];
}

export function readAllCiNodeVersions(
  ciWorkflowPaths = discoverCiWorkflowPaths(),
  selectorVersion = readNodeSelectorVersion(),
) {
  if (!Array.isArray(ciWorkflowPaths)) {
    throw new TypeError("ciWorkflowPaths must be a non-empty array");
  }

  return ciWorkflowPaths.flatMap((ciWorkflowPath) => {
    const workflow = fs.readFileSync(ciWorkflowPath, "utf8");
    if (
      !/^\s*(?:-\s+)?uses:\s*actions\/setup-node@/m.test(workflow)
    ) {
      return [];
    }
    return readCiNodeVersions(ciWorkflowPath, selectorVersion);
  });
}

export function checkNodeCompatibilityWorkflow({
  currentVersion,
  versions,
}) {
  if (
    typeof currentVersion !== "string" ||
    !Array.isArray(versions) ||
    versions.length !== 2 ||
    versions[0] !== currentVersion ||
    versions[1] !== NODE_COMPATIBILITY_COMPARISON_VERSION
  ) {
    throw new Error(
      [
        "The Node compatibility advisory must test the pinned project runtime first.",
        `Expected Node pins: ${currentVersion}, ${NODE_COMPATIBILITY_COMPARISON_VERSION}`,
        `Found Node pins: ${Array.isArray(versions) ? versions.join(", ") : "invalid"}`,
      ].join("\n"),
    );
  }
}

export function checkWorkspacePackageManagerContract({
  packageManager,
  lockfileContents,
} = {}) {
  const packageManagerMatch = /^pnpm@(\d+\.\d+\.\d+)$/.exec(
    typeof packageManager === "string" ? packageManager : "",
  );
  if (!packageManagerMatch || typeof lockfileContents !== "string") {
    throw new TypeError(
      "An exact packageManager and pnpm lockfile contents are required",
    );
  }

  const lockfileMatch =
    /^      pnpm:\s*\n        specifier:\s*([^\r\n]+)\s*\n        version:\s*([^\r\n]+)\s*$/m.exec(
      lockfileContents,
    );
  if (!lockfileMatch) {
    throw new Error(
      "pnpm-lock.yaml does not contain the root pinned pnpm bootstrap entry",
    );
  }

  const expectedVersion = packageManagerMatch[1];
  const [lockSpecifier, lockVersion] = lockfileMatch.slice(1);
  if (lockSpecifier !== expectedVersion || lockVersion !== expectedVersion) {
    throw new Error(
      [
        "The package manager version contract is out of sync.",
        `package.json packageManager: pnpm@${expectedVersion}`,
        `pnpm-lock.yaml bootstrap: specifier=${lockSpecifier}, version=${lockVersion}`,
        "Update the root packageManager and regenerate the lockfile together.",
      ].join("\n"),
    );
  }

  return expectedVersion;
}

export function checkDeclaredRuntimeInputs({
  nodeVersion,
  replitConfig,
  nixPackageFile,
  pyproject,
  dockerfile,
}) {
  const nodeMajor = /^(\d+)\.\d+\.\d+$/.exec(nodeVersion ?? "")?.[1];
  const nodeModule = /nodejs-(\d+)/.exec(replitConfig ?? "")?.[1];
  const pythonModule = /python-(\d+\.\d+)/.exec(replitConfig ?? "")?.[1];
  const pythonRequirement = /requires-python\s*=\s*['"]>=([0-9]+\.[0-9]+)/.exec(
    pyproject ?? "",
  )?.[1];
  const nixChannel = /^\s*channel\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(
    replitConfig ?? "",
  )?.[1];
  const nixPackagesDeclared =
    typeof nixPackageFile === "string" &&
    /\bdeps\s*=\s*\[/.test(nixPackageFile) &&
    /\bpkgs\.[A-Za-z0-9_.]+/.test(nixPackageFile);
  const pythonDependenciesAreEmpty =
    /^\s*dependencies\s*=\s*\[\s*\]\s*$/m.test(pyproject ?? "");
  const escapedNodeVersion =
    typeof nodeVersion === "string"
      ? nodeVersion.replaceAll(".", "\\.")
      : "(?!)";
  const dockerNodeImage = new RegExp(
    `^ARG NODE_IMAGE=node:${escapedNodeVersion}-slim@sha256:[a-f0-9]{64}$`,
    "m",
  ).test(dockerfile ?? "");
  const dockerAptSnapshot =
    /^\s*RUN snapshot=\d{8}T\d{6}Z\s*\\$/m.test(dockerfile ?? "");

  if (
    !nodeMajor ||
    nodeModule !== nodeMajor ||
    !pythonModule ||
    pythonModule !== pythonRequirement ||
    !nixChannel ||
    !/^stable-\d{2}_\d{2}$/.test(nixChannel) ||
    !nixPackagesDeclared ||
    !pythonDependenciesAreEmpty ||
    !dockerNodeImage ||
    !dockerAptSnapshot
  ) {
    throw new Error(
      [
        "Declared runtime and system dependency inputs are inconsistent.",
        `Project Node: ${nodeVersion || "missing"}`,
        `Replit Node module: ${nodeModule || "missing"}`,
        `Replit Python module: ${pythonModule || "missing"}`,
        `Python minimum: ${pythonRequirement || "missing"}`,
        `Replit Nix channel: ${nixChannel || "missing"}`,
        `Nix packages declared: ${nixPackagesDeclared}`,
        `Python dependencies empty: ${pythonDependenciesAreEmpty}`,
        `Docker Node image pin matches: ${dockerNodeImage}`,
        `Docker Debian snapshot is pinned: ${dockerAptSnapshot}`,
        "Keep system package inputs on the pinned Replit Nix channel; add a Python lockfile before declaring external Python packages.",
      ].join("\n"),
    );
  }

  return { nodeVersion, pythonVersion: pythonModule, nixChannel };
}

export function checkFrozenWorkflowInstalls(
  ciWorkflowPaths = discoverAllCiWorkflowPaths(),
) {
  const unfrozenInstallLines = [];
  for (const workflowPath of ciWorkflowPaths) {
    const lines = fs.readFileSync(workflowPath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/^\s*#/.test(line)) return;
      const install = /\bpnpm\s+install\b(.*)$/.exec(line);
      if (install && !/\s--frozen-lockfile(?:\s|$)/.test(install[1])) {
        unfrozenInstallLines.push(`${workflowPath}:${index + 1}`);
      }
    });
  }

  if (unfrozenInstallLines.length > 0) {
    throw new Error(
      [
        "CI dependency installs must use the committed pnpm lockfile.",
        `Unfrozen installs: ${unfrozenInstallLines.join(", ")}`,
        "Use pnpm install --frozen-lockfile so workspace changes cannot silently resolve new packages.",
      ].join("\n"),
    );
  }
  return true;
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
  const currentVersion = readCurrentEvaluationNodeVersion();
  checkRepositoryNodeVersionContract({
    currentVersion,
    selectorVersion: readNodeSelectorVersion(),
    ciVersions: readAllCiNodeVersions(undefined, currentVersion),
  });
  checkNodeCompatibilityWorkflow({
    currentVersion,
    versions: readCiNodeVersions(
      NODE_COMPATIBILITY_WORKFLOW_PATH,
      currentVersion,
    ),
  });
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const pnpmVersion = checkWorkspacePackageManagerContract({
    packageManager: packageJson.packageManager,
    lockfileContents: fs.readFileSync(PNPM_LOCK_PATH, "utf8"),
  });
  checkDeclaredRuntimeInputs({
    nodeVersion: currentVersion,
    replitConfig: fs.readFileSync(REPLIT_CONFIG_PATH, "utf8"),
    nixPackageFile: fs.readFileSync(REPLIT_NIX_PATH, "utf8"),
    pyproject: fs.readFileSync(PYPROJECT_PATH, "utf8"),
    dockerfile: fs.readFileSync(DOCKERFILE_PATH, "utf8"),
  });
  checkFrozenWorkflowInstalls();
  checkRoutineNodeVersion({
    actualVersion: process.versions.node,
    requiredVersion: currentVersion,
  });
  console.log(
    `Runtime contract verified: Node ${currentVersion}, pnpm ${pnpmVersion}.`,
  );
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