import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(import.meta.dirname, "..");
const coordinatorPath = path.join(
  import.meta.dirname,
  "sharedDiagnosticPersistence.ts",
);

function listProductionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listProductionTypeScriptFiles(entryPath);
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".spec.ts")
    ) {
      return [];
    }
    return [entryPath];
  });
}

function importedDatabaseBindings(source: string): string[] {
  const databaseImport = source.match(
    /import\s*\{([^}]*)\}\s*from\s*["']@workspace\/db["']/s,
  );
  if (!databaseImport) return [];

  return databaseImport[1]
    .split(",")
    .map((binding) => binding.trim().match(/^db(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)?.[1] ?? (
      binding.trim() === "db" ? "db" : undefined
    ))
    .filter((binding): binding is string => binding !== undefined);
}

function isHealthDiagnosticModule(source: string): boolean {
  return /\bexport\s+(?:(?:async\s+)?function|const|type|interface)\s+\w*Diagnostic(?:s)?\b/.test(
    source,
  );
}

function directDatabaseTransactions(source: string): string[] {
  return importedDatabaseBindings(source).filter((binding) =>
    new RegExp(`\\b${binding.replaceAll("$", "\\$")}\\s*\\.\\s*transaction\\s*\\(`).test(source)
  );
}

function diagnosticPersistenceViolation(source: string): boolean {
  return isHealthDiagnosticModule(source) && directDatabaseTransactions(source).length > 0;
}

describe("shared health-diagnostic persistence architecture", () => {
  it("rejects diagnostic stores that directly open database transactions", () => {
    const bypass = `
      import { db as database } from "@workspace/db";
      export type WorkerDiagnostic = { status: "ok" };
      export async function persistDiagnostic() {
        return database.transaction(async (tx) => tx);
      }
    `;

    expect(diagnosticPersistenceViolation(bypass)).toBe(true);
  });

  it("permits coordinator-backed diagnostic stores and ordinary transactions", () => {
    const coordinated = `
      import { db } from "@workspace/db";
      import { createSharedDiagnosticPersistence } from "./sharedDiagnosticPersistence";
      export type WorkerDiagnostic = { status: "ok" };
      const persistence = createSharedDiagnosticPersistence(options);
      export async function persistDiagnostic() {
        return persistence.run(async (tx) => tx);
      }
    `;
    const ordinaryTransaction = `
      import { db } from "@workspace/db";
      export async function updateInventory() {
        return db.transaction(async (tx) => tx);
      }
    `;

    expect(diagnosticPersistenceViolation(coordinated)).toBe(false);
    expect(diagnosticPersistenceViolation(ordinaryTransaction)).toBe(false);
  });

  it("keeps production diagnostic stores behind the shared coordinator", () => {
    const violations = listProductionTypeScriptFiles(sourceRoot)
      .filter((file) => file !== coordinatorPath)
      .filter((file) => diagnosticPersistenceViolation(readFileSync(file, "utf8")))
      .map((file) => path.relative(sourceRoot, file));

    expect(
      violations,
      `Shared health-diagnostic stores must use createSharedDiagnosticPersistence ` +
        `instead of opening db.transaction directly. The coordinator owns caller ` +
        `timeouts, PostgreSQL deadlines, pending-operation draining, and fallback behavior.`,
    ).toEqual([]);
  });
});