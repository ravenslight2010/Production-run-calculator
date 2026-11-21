/**
 * Filters stdin paths for release integration shards. Under CI_PUBLIC_SOURCE
 * without the private reconciliation audit, drops the heal integration suite
 * so public CI matches run-unit-tests.mjs excludes.
 *
 * Dedicated sync/roles/convergence exclusions stay in the package.json find
 * command (`! -path ...`) so release-check shard inventory keeps working.
 */
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  publicSourceApiTestExcludes,
  warnPublicSourceApiTestExcludes,
} from "../../../scripts/src/public-source-api-test-excludes.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const publicExcludes = new Set(publicSourceApiTestExcludes({ root: repoRoot }));
warnPublicSourceApiTestExcludes([...publicExcludes]);

const lines = [];
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const normalized = line.replaceAll("\\", "/").trim();
  if (!normalized || publicExcludes.has(normalized)) continue;
  lines.push(normalized);
}
process.stdout.write(lines.length > 0 ? `${lines.join("\n")}\n` : "");
