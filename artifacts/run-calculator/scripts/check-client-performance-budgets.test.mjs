import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => fs.readFileSync(path.join(packageDir, relativePath), "utf8");
const documentation = source("docs/performance-budgets.md");
const diagnostics = source("src/performanceDiagnostics.ts");

const operations = [
  {
    label: "Initial calculator commit",
    budgetKey: "initialLoadMs",
    selector: /entry\.kind === "load"\s*\?\s*SLOW_LOAD_MS/,
    kind: "load",
    measurementPath: "src/pages/home.tsx",
    measurement: /if \(phase === "mount"\) recordPerformance\("initial-load", actualDuration, "load"\)/,
    additionalMeasurements: [
      {
        path: "src/performanceDiagnostics.ts",
        pattern: /recordPerformance\(\s*"browser:navigation-to-dom-content-loaded"[\s\S]*?"load"\s*,?\s*\)/,
      },
      {
        path: "src/performanceDiagnostics.ts",
        pattern: /recordPerformance\(\s*"browser:navigation-to-load"[\s\S]*?"load"\s*,?\s*\)/,
      },
    ],
  },
  {
    label: "Tab transition commit",
    budgetKey: "tabTransitionMs",
    selector: /:\s*SLOW_TRANSITION_MS\);/,
    kind: "navigation",
    measurementPath: "src/hooks/useHomeNavigation.ts",
    measurement: /recordPerformance\(`tab:\$\{activeTab\}`, durationMs, "navigation"\)/,
    additionalMeasurements: [
      {
        path: "src/hooks/useHomeNavigation.ts",
        pattern: /recordPerformance\(`tab-render:\$\{activeTab\}`, durationMs, "render"\)/,
      },
    ],
  },
  {
    label: "Home render commit",
    budgetKey: "renderMs",
    selector: /entry\.kind === "render"\s*\?\s*SLOW_TRANSITION_MS/,
    kind: "render",
    measurementPath: "src/pages/home.tsx",
    measurement: /recordPerformance\(`home-commit:\$\{phase\}`, actualDuration, "render"\)/,
  },
  {
    label: "HMR update",
    budgetKey: "initialLoadMs",
    selector: /entry\.kind === "hmr"\s*\?\s*SLOW_LOAD_MS/,
    kind: "hmr",
    measurementPath: "src/performanceDiagnostics.ts",
    measurement: /recordPerformance\("hmr:update", performance\.now\(\) - updateStartedAt, "hmr"\)/,
  },
  {
    label: "Live calculation",
    budgetKey: "calculationMs",
    selector: /entry\.kind === "calculation"\s*\?\s*SLOW_CALCULATION_MS/,
    kind: "calculation",
    measurementPath: "src/contexts/LiveRunContext.tsx",
    measurement: /recordPerformance\("live-calculation", performance\.now\(\) - calcStartedAt, "calculation"\)/,
  },
  {
    label: "Persisted run-value storage scan",
    budgetKey: "storageScanMs",
    selector: /entry\.kind === "storage"\s*\?\s*100\b/,
    kind: "storage",
    measurementPath: "src/pages/home.tsx",
    measurement: /recordPerformance\("run-values-storage-scan", performance\.now\(\) - startedAt, "storage"\)/,
  },
  {
    label: "Timed API request",
    budgetKey: "apiRequestMs",
    selector: /entry\.kind === "api"\s*\?\s*1000\b/,
    kind: "api",
    measurementPath: "src/performanceDiagnostics.ts",
    measurement: /recordPerformance\(`api:\$\{operation\}:\$\{response\.status\}`, performance\.now\(\) - startedAt, "api"\)/,
    additionalMeasurements: [
      {
        path: "src/performanceDiagnostics.ts",
        pattern: /recordPerformance\(`api-request-failure:\$\{operation\}:\$\{requestOutcome\}`, duration, "api"\)/,
      },
    ],
  },
];

function documentedBudget(sourceText, operation) {
  const escapedLabel = operation.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sourceText.match(new RegExp(`^\\| ${escapedLabel} \\| ([\\d,]+) ms \\|$`, "m"));
  assert.ok(match, `performance-budgets.md must document the ${operation.label} budget.`);
  return Number(match[1].replaceAll(",", ""));
}

function diagnosticBudget(sourceText, operation) {
  const declaration = sourceText.match(/export const PERFORMANCE_BUDGETS\s*=\s*\{([^}]+)\}/);
  assert.ok(declaration, "performanceDiagnostics.ts must define PERFORMANCE_BUDGETS.");
  const match = declaration[1].match(
    new RegExp(`\\b${operation.budgetKey}:\\s*([\\w]+)`),
  );
  assert.ok(match, `PERFORMANCE_BUDGETS must define ${operation.budgetKey}.`);
  const value = match[1];
  if (/^[\d_]+$/.test(value)) return Number(value.replaceAll("_", ""));

  const constant = sourceText.match(new RegExp(`const ${value}\\s*=\\s*([\\d_]+)`));
  assert.ok(constant, `PERFORMANCE_BUDGETS.${operation.budgetKey} must resolve to a numeric diagnostic threshold.`);
  return Number(constant[1].replaceAll("_", ""));
}

function assertBudgetsMatch(operation, documentedMs, enforcedMs) {
  assert.equal(
    documentedMs,
    enforcedMs,
    `${operation.label} budget drift: performance-budgets.md documents ${documentedMs} ms, but PERFORMANCE_BUDGETS.${operation.budgetKey} enforces ${enforcedMs} ms.`,
  );
}

function assertSourceMatches(sourceText, pattern, message) {
  assert.ok(pattern.test(sourceText), message);
}

test("documented client performance targets match the selected diagnostic budgets", () => {
  for (const operation of operations) {
    const documentedMs = documentedBudget(documentation, operation);
    const enforcedMs = diagnosticBudget(diagnostics, operation);
    const measurementSource = source(operation.measurementPath);

    assertSourceMatches(
      diagnostics,
      operation.selector,
      `${operation.label} diagnostics must select the budget for ${operation.kind} measurements.`,
    );
    assertSourceMatches(measurementSource, operation.measurement,
      `${operation.label} must be recorded with diagnostic kind ${operation.kind}.`);
    for (const measurement of operation.additionalMeasurements ?? []) {
      assertSourceMatches(source(measurement.path), measurement.pattern,
        `${operation.label} browser timing must be recorded with diagnostic kind ${operation.kind}.`);
    }
    assertBudgetsMatch(operation, documentedMs, enforcedMs);
  }
});

test("budget drift errors name the operation and documented/enforced values", () => {
  assert.throws(
    () => assertBudgetsMatch(operations[0], 1_500, 1_200),
    /Initial calculator commit budget drift: performance-budgets\.md documents 1500 ms, but PERFORMANCE_BUDGETS\.initialLoadMs enforces 1200 ms\./,
  );
});
