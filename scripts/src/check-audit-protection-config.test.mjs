import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEFAULT_ARTIFACT_PATH,
  validateAuditProtectionConfig,
} from "./check-audit-protection-config.mjs";

const artifactToml = await readFile(DEFAULT_ARTIFACT_PATH, "utf8");

function replaceProductionArgs(artifact, args) {
  const sectionHeader = "[services.production.run]";
  const sectionStart = artifact.indexOf(sectionHeader);
  const beforeSection = artifact.slice(0, sectionStart);
  const section = artifact.slice(sectionStart);
  return `${beforeSection}${section.replace(
    /^\s*args\s*=\s*.*$/m,
    `args = ${JSON.stringify(args)}`,
  )}`;
}

test("accepts the API artifact production command with audit protection first", () => {
  assert.doesNotThrow(() => validateAuditProtectionConfig(artifactToml));
});

test("rejects a production command that starts the API directly", () => {
  const bypassingConfig = replaceProductionArgs(artifactToml, [
    "node",
    "--enable-source-maps",
    "artifacts/api-server/dist/index.mjs",
  ]);

  assert.throws(
    () => validateAuditProtectionConfig(bypassingConfig),
    /must apply audit-log protection before starting the API/,
  );
});

test("rejects a command that applies protection after starting the API", () => {
  const reorderedConfig = replaceProductionArgs(artifactToml, [
    "sh",
    "-c",
    "exec node --enable-source-maps artifacts/api-server/dist/index.mjs && pnpm --filter @workspace/db run apply-audit-log-protection",
  ]);

  assert.throws(
    () => validateAuditProtectionConfig(reorderedConfig),
    /must run before the production API server starts/,
  );
});

test("rejects a missing production run section", () => {
  assert.throws(
    () =>
      validateAuditProtectionConfig(
        artifactToml.replace(
          "[services.production.run]",
          "[services.production.start]",
        ),
      ),
    /missing the \[services\.production\.run\] section/,
  );
});