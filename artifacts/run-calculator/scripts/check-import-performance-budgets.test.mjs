import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documentationPath = path.join(packageDir, "docs/performance-budgets.md");
const performanceSourcePath = path.join(packageDir, "src/performanceDiagnostics.ts");

const importOperations = [
  { label: "Workbook parse", key: "parseMs", suffix: "-parse" },
  { label: "Review open after parse", key: "reviewOpenMs", suffix: "-review-open" },
  { label: "Import commit", key: "commitMs", suffix: "-commit" },
  { label: "Workbook export", key: "exportMs", suffix: "-export" },
];

function readDocumentedBudget(source, operation) {
  const escapedLabel = operation.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^\\| ${escapedLabel} \\| ([\\d,]+) ms \\|$`, "m"));
  assert.ok(match, `performance-budgets.md must document the ${operation.label} budget.`);
  return Number(match[1].replaceAll(",", ""));
}

function readEnforcedBudget(source, operation) {
  const declaration = source.match(
    /export const IMPORT_PERFORMANCE_BUDGETS\s*=\s*\{([^}]+)\}/,
  );
  assert.ok(declaration, "performanceDiagnostics.ts must define IMPORT_PERFORMANCE_BUDGETS.");
  const match = declaration[1].match(new RegExp(`\\b${operation.key}:\\s*([\\d_]+)`));
  assert.ok(match, `IMPORT_PERFORMANCE_BUDGETS must define ${operation.key}.`);
  return Number(match[1].replaceAll("_", ""));
}

function assertBudgetMatches(operation, documentedMs, enforcedMs) {
  assert.equal(
    documentedMs,
    enforcedMs,
    `${operation.label} budget drift: performance-budgets.md documents ${documentedMs} ms, but IMPORT_PERFORMANCE_BUDGETS.${operation.key} enforces ${enforcedMs} ms.`,
  );
}

function assertDiagnosticUsesBudget(source, operation) {
  const mapping = new RegExp(
    `entry\\.name\\.endsWith\\("${operation.suffix}"\\)\\s*\\?\\s*IMPORT_PERFORMANCE_BUDGETS\\.${operation.key}`,
  );
  assert.match(
    source,
    mapping,
    `${operation.label} diagnostics must use the ${operation.suffix} event suffix and IMPORT_PERFORMANCE_BUDGETS.${operation.key}.`,
  );
}

test("documented import time targets match the diagnostic budgets", () => {
  const documentation = fs.readFileSync(documentationPath, "utf8");
  const performanceSource = fs.readFileSync(performanceSourcePath, "utf8");

  for (const operation of importOperations) {
    const documentedMs = readDocumentedBudget(documentation, operation);
    const enforcedMs = readEnforcedBudget(performanceSource, operation);
    assertDiagnosticUsesBudget(performanceSource, operation);
    assertBudgetMatches(operation, documentedMs, enforcedMs);
  }
});

test("import budget drift errors name the operation and both values", () => {
  assert.throws(
    () => assertBudgetMatches(importOperations[0], 120_000, 90_000),
    /Workbook parse budget drift: performance-budgets\.md documents 120000 ms, but IMPORT_PERFORMANCE_BUDGETS\.parseMs enforces 90000 ms\./,
  );
});
