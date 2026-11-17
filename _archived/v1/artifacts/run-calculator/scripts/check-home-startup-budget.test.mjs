import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documentationPath = path.join(packageDir, "docs/performance-budgets.md");
const performanceSourcePath = path.join(packageDir, "src/performanceDiagnostics.ts");

function readDocumentedBudget(source) {
  const match = source.match(
    /^\| First authenticated calculator visit on slow 3G \| ([\d,]+) ms \|$/m,
  );
  assert.ok(match, "performance-budgets.md must document the authenticated slow-network startup budget.");
  return Number(match[1].replaceAll(",", ""));
}

function readEnforcedBudget(source) {
  const declaration = source.match(
    /export const AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS\s*=\s*\{([^}]+)\}/,
  );
  assert.ok(declaration, "performanceDiagnostics.ts must define the authenticated startup budget.");
  const match = declaration[1].match(/\brunReadyMs:\s*([\d_]+)/);
  assert.ok(match, "AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS must define runReadyMs.");
  return Number(match[1].replaceAll("_", ""));
}

test("documented Home startup target matches the browser-enforced budget", () => {
  const documentedMs = readDocumentedBudget(fs.readFileSync(documentationPath, "utf8"));
  const enforcedMs = readEnforcedBudget(fs.readFileSync(performanceSourcePath, "utf8"));

  assert.equal(
    documentedMs,
    enforcedMs,
    `Home startup budget drift: performance-budgets.md documents ${documentedMs} ms, but AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS.runReadyMs enforces ${enforcedMs} ms.`,
  );
  assert.equal(
    enforcedMs,
    10_000,
    `The reviewed Home startup target must remain 10000 ms; the browser check enforces ${enforcedMs} ms.`,
  );
  console.log(`Home startup target aligned: documentation and browser check both use ${enforcedMs} ms.`);
});
