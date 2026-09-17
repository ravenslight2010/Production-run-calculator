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
    throw new TypeError("actualVersion and requiredVersion must be non-empty strings");
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

export function main() {
  checkRoutineNodeVersion({
    actualVersion: process.versions.node,
    requiredVersion: readRequiredNodeVersion(),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}