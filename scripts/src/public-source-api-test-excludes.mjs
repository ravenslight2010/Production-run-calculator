/**
 * Shared CI_PUBLIC_SOURCE excludes for API suites that import the private
 * source-library reconciliation audit. Keep this list aligned across
 * run-unit-tests.mjs, run-api-unit-tests-isolated.mts, and the release
 * integration file finder so public CI skips the same private-asset suites
 * without weakening private-source runs.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_LIBRARY_RECONCILIATION_REPORT_RELATIVE =
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json";

export const PUBLIC_SOURCE_API_TEST_EXCLUDES = Object.freeze([
  "src/lib/sourceLibraryReconciliationCapture.test.ts",
  "src/lib/sourceLibraryReconciliationHeal.integration.test.ts",
]);

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function isPublicCiSource(env = process.env) {
  return env.CI_PUBLIC_SOURCE === "1" || env.CI_PUBLIC_SOURCE === "true";
}

export function publicSourceApiTestExcludes({
  env = process.env,
  root = defaultRoot,
  exists = existsSync,
} = {}) {
  if (!isPublicCiSource(env)) return [];
  if (exists(path.join(root, SOURCE_LIBRARY_RECONCILIATION_REPORT_RELATIVE))) {
    return [];
  }
  return [...PUBLIC_SOURCE_API_TEST_EXCLUDES];
}

export function vitestPublicSourceExcludeArgs(options) {
  return publicSourceApiTestExcludes(options).flatMap((pattern) => [
    "--exclude",
    pattern,
  ]);
}

export function warnPublicSourceApiTestExcludes(excludes, log = console.warn) {
  if (excludes.length === 0) return;
  log(
    "CI_PUBLIC_SOURCE: excluding source-library reconciliation API tests (assets absent).",
  );
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  const mode = process.argv[2] ?? "paths";
  const excludes = publicSourceApiTestExcludes();
  if (mode === "vitest-args") {
    process.stdout.write(vitestPublicSourceExcludeArgs().join(" "));
    if (excludes.length > 0) process.stdout.write("\n");
  } else if (mode === "paths") {
    for (const pattern of excludes) process.stdout.write(`${pattern}\n`);
  } else {
    console.error(
      "Usage: node public-source-api-test-excludes.mjs [paths|vitest-args]",
    );
    process.exit(2);
  }
}
