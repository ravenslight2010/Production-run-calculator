#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ARTIFACT_PATH = resolve(
  fileURLToPath(
    new URL(
      "../../artifacts/api-server/.replit-artifact/artifact.toml",
      import.meta.url,
    ),
  ),
);

const AUDIT_PROTECTION_COMMAND =
  "pnpm --filter @workspace/db run apply-audit-log-protection";

function readProductionRunArgs(artifactToml) {
  const sectionHeader = "[services.production.run]";
  const sectionStart = artifactToml.indexOf(sectionHeader);
  if (sectionStart < 0) {
    throw new Error(
      "artifact.toml is missing the [services.production.run] section",
    );
  }

  const sectionContents = artifactToml.slice(
    sectionStart + sectionHeader.length,
  );
  const nextSection = sectionContents.search(/^\[[^\]]+\]/m);
  const section =
    nextSection < 0
      ? sectionContents
      : sectionContents.slice(0, nextSection);

  const argsLiteral = section.match(/^\s*args\s*=\s*(.+)$/m)?.[1];
  if (!argsLiteral) {
    throw new Error(
      "[services.production.run] must define an args array",
    );
  }

  try {
    const args = JSON.parse(argsLiteral);
    if (
      !Array.isArray(args) ||
      args.some((arg) => typeof arg !== "string")
    ) {
      throw new Error("args is not an array of strings");
    }
    return args;
  } catch {
    throw new Error(
      "[services.production.run].args must be a JSON-compatible array of strings",
    );
  }
}

export function validateAuditProtectionConfig(artifactToml) {
  const args = readProductionRunArgs(artifactToml);
  const command = args.join(" ");
  const migrationIndex = command.indexOf(AUDIT_PROTECTION_COMMAND);
  const serverIndex = command.indexOf("exec node ");

  if (migrationIndex < 0) {
    throw new Error(
      "[services.production.run].args must apply audit-log protection before starting the API",
    );
  }
  if (serverIndex < 0) {
    throw new Error(
      "[services.production.run].args must use exec node to start the API after its startup protections",
    );
  }
  if (migrationIndex > serverIndex) {
    throw new Error(
      "apply-audit-log-protection must run before the production API server starts",
    );
  }

  return { args };
}

export async function main(
  artifactPath = process.env.AUDIT_PROTECTION_ARTIFACT_PATH ??
    DEFAULT_ARTIFACT_PATH,
) {
  let artifactToml;
  try {
    artifactToml = await readFile(artifactPath, "utf8");
  } catch {
    throw new Error(`Could not read API artifact configuration: ${artifactPath}`);
  }

  validateAuditProtectionConfig(artifactToml);
  console.log(
    "Audit protection publish guard passed: the production API command applies audit-log protection before starting the server.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Audit protection publish guard failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}