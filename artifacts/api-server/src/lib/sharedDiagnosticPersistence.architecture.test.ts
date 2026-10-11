import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "@workspace/typescript-api-v6";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    transaction: databaseMocks.transaction,
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  }),
}));

import { createSharedDiagnosticPersistence } from "./sharedDiagnosticPersistence";

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

type NamedFunction = {
  name: string;
  node: ts.FunctionLikeDeclaration;
};

function namedFunctions(sourceFile: ts.SourceFile): NamedFunction[] {
  const functions: NamedFunction[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      const parent = node.parent;
      const parentName =
        (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
          ? parent.name.text
          : ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)
            ? parent.name.text
            : undefined);
      let functionName = parentName;
      if (
        (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
        node.name
      ) {
        functionName = node.name.text;
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        functionName = node.name.text;
      }
      if (functionName && node.body) {
        functions.push({ name: functionName, node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

function aliasedDatabaseTransactions(
  sourceFile: ts.SourceFile,
  databaseBindings: string[],
): { databaseNames: Set<string>; transactionNames: Set<string> } {
  const databaseNames = new Set(databaseBindings);
  const transactionNames = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const initializer = node.initializer;
        const aliasesDatabase =
          ts.isIdentifier(initializer) && databaseNames.has(initializer.text);
        const aliasesTransaction =
          ts.isIdentifier(initializer) && transactionNames.has(initializer.text);
        const referencesDatabaseTransaction =
          ts.isPropertyAccessExpression(initializer) &&
          initializer.name.text === "transaction" &&
          ts.isIdentifier(initializer.expression) &&
          databaseNames.has(initializer.expression.text);

        if (aliasesDatabase && !databaseNames.has(node.name.text)) {
          databaseNames.add(node.name.text);
          changed = true;
        }
        if (
          (aliasesTransaction || referencesDatabaseTransaction) &&
          !transactionNames.has(node.name.text)
        ) {
          transactionNames.add(node.name.text);
          changed = true;
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        databaseNames.has(node.initializer.text)
      ) {
        for (const element of node.name.elements) {
          const importedName = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(importedName) &&
            importedName.text === "transaction" &&
            ts.isIdentifier(element.name) &&
            !transactionNames.has(element.name.text)
          ) {
            transactionNames.add(element.name.text);
            changed = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { databaseNames, transactionNames };
}

function functionCalls(functionNode: ts.FunctionLikeDeclaration): Set<string> {
  const calls = new Set<string>();
  if (!functionNode.body) return calls;

  const visit = (node: ts.Node): void => {
    if (node !== functionNode.body && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calls.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(functionNode.body);
  return calls;
}

function functionOpensDatabaseTransaction(
  functionNode: ts.FunctionLikeDeclaration,
  databaseBindings: Set<string>,
  transactionAliases: Set<string>,
): boolean {
  if (!functionNode.body) return false;
  let opensTransaction = false;

  const visit = (node: ts.Node): void => {
    if (
      opensTransaction ||
      (node !== functionNode.body && ts.isFunctionLike(node))
    ) return;
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (
        ts.isIdentifier(expression) &&
        transactionAliases.has(expression.text)
      ) {
        opensTransaction = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === "transaction" &&
        ts.isIdentifier(expression.expression) &&
        databaseBindings.has(expression.expression.text)
      ) {
        opensTransaction = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionNode.body);
  return opensTransaction;
}

function hasDatabaseTransactionOnPathFromDiagnosticWriter(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    "architecture-check.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const { databaseNames, transactionNames: transactionAliases } =
    aliasedDatabaseTransactions(
      sourceFile,
      importedDatabaseBindings(source),
    );
  const functions = namedFunctions(sourceFile);
  const functionsByName = new Map<string, NamedFunction[]>();
  for (const fn of functions) {
    const sameName = functionsByName.get(fn.name) ?? [];
    sameName.push(fn);
    functionsByName.set(fn.name, sameName);
  }

  const transactionFunctions = new Set(
    functions
      .filter((fn) =>
        functionOpensDatabaseTransaction(
          fn.node,
          databaseNames,
          transactionAliases,
        )
      )
      .map((fn) => fn.name),
  );
  const callsByFunction = new Map(
    functions.map((fn) => [fn, functionCalls(fn.node)]),
  );
  const isTransactionReachable = (
    fn: NamedFunction,
    visited: Set<NamedFunction>,
  ): boolean => {
    if (transactionFunctions.has(fn.name)) return true;
    if (visited.has(fn)) return false;
    visited.add(fn);
    for (const calledName of callsByFunction.get(fn) ?? []) {
      for (const calledFunction of functionsByName.get(calledName) ?? []) {
        if (isTransactionReachable(calledFunction, visited)) return true;
      }
    }
    return false;
  };

  return functions.some(
    (fn) =>
      /diagnostic|persist|write|record|store/i.test(fn.name) &&
      isTransactionReachable(fn, new Set()),
  );
}

function diagnosticPersistenceViolation(source: string): boolean {
  if (!isHealthDiagnosticModule(source)) return false;
  return hasDatabaseTransactionOnPathFromDiagnosticWriter(source);
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

  it("rejects transaction aliases and neutral helpers reachable from diagnostic writers", () => {
    const aliasedTransaction = `
      import { db as database } from "@workspace/db";
      export type WorkerDiagnostic = { status: "ok" };
      const openTransaction = database.transaction;
      export async function persistDiagnostic() {
        return openTransaction(async (tx) => tx);
      }
    `;
    const destructuredTransaction = `
      import { db as database } from "@workspace/db";
      export type WorkerDiagnostic = { status: "ok" };
      const { transaction: openTransaction } = database;
      export async function persistDiagnostic() {
        return openTransaction(async (tx) => tx);
      }
    `;
    const aliasedDatabase = `
      import { db } from "@workspace/db";
      export type WorkerDiagnostic = { status: "ok" };
      const database = db;
      export async function persistDiagnostic() {
        return database.transaction(async (tx) => tx);
      }
    `;
    const helperMediatedTransaction = `
      import { db } from "@workspace/db";
      export type WorkerDiagnostic = { status: "ok" };
      async function saveRow() {
        return db.transaction(async (tx) => tx);
      }
      export async function recordDiagnostic() {
        return saveRow();
      }
    `;

    expect(diagnosticPersistenceViolation(aliasedTransaction)).toBe(true);
    expect(diagnosticPersistenceViolation(destructuredTransaction)).toBe(true);
    expect(diagnosticPersistenceViolation(aliasedDatabase)).toBe(true);
    expect(diagnosticPersistenceViolation(helperMediatedTransaction)).toBe(true);
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
    const diagnosticModuleWithOrdinaryTransaction = `
      import { db } from "@workspace/db";
      export type WorkerDiagnostic = { status: "ok" };
      export async function updateInventory() {
        return db.transaction(async (tx) => tx);
      }
    `;

    expect(diagnosticPersistenceViolation(coordinated)).toBe(false);
    expect(diagnosticPersistenceViolation(ordinaryTransaction)).toBe(false);
    expect(diagnosticPersistenceViolation(diagnosticModuleWithOrdinaryTransaction)).toBe(false);
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

describe("shared health-diagnostic persistence behavior", () => {
  const transaction = databaseMocks.transaction;
  const tx = { execute: vi.fn() };

  beforeEach(() => {
    transaction.mockReset();
    tx.execute.mockReset();
    tx.execute.mockResolvedValue(undefined);
    transaction.mockImplementation(async (callback) => callback(tx));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPersistence() {
    return createSharedDiagnosticPersistence({
      callerTimeoutMs: 50,
      databaseTimeoutMs: 25,
      timeoutMessage: "diagnostic persistence timed out",
    });
  }

  it("times out the caller while allowing the database work to finish", async () => {
    vi.useFakeTimers();
    let finishWork: ((value: string) => void) | undefined;
    const work = new Promise<string>((resolve) => {
      finishWork = resolve;
    });
    const persistence = createPersistence();

    const result = persistence.run(async () => work);
    const rejection = expect(result).rejects.toThrow(
      "diagnostic persistence timed out",
    );
    await vi.advanceTimersByTimeAsync(50);
    await rejection;

    finishWork?.("eventually persisted");
    await expect(work).resolves.toBe("eventually persisted");
  });

  it("runs the fallback after a caller timeout", async () => {
    vi.useFakeTimers();
    const persistence = createPersistence();
    const fallback = vi.fn().mockResolvedValue("fallback value");

    const result = persistence.runOrFallback(
      async () => new Promise<string>(() => undefined),
      fallback,
    );
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBe("fallback value");
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("cleans up after a database deadline and permits later persistence", async () => {
    const persistence = createPersistence();
    const deadlineError = Object.assign(
      new Error("canceling statement due to statement timeout"),
      { code: "57014" },
    );
    transaction
      .mockRejectedValueOnce(deadlineError)
      .mockImplementationOnce(async (callback) => callback(tx));

    const timedOut = persistence.track(persistence.runOrFallback(
      async () => "not reached",
      () => "fallback value",
    ));
    await expect(timedOut).resolves.toBe("fallback value");

    const allSettled = vi.spyOn(Promise, "allSettled");
    await persistence.settlePending();
    expect(allSettled).not.toHaveBeenCalled();
    allSettled.mockRestore();

    await expect(persistence.run(async () => "recovered")).resolves.toBe(
      "recovered",
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["resolve", () => Promise.resolve("saved")],
    ["reject", () => Promise.reject(new Error("write failed"))],
  ])("removes tracked operations after they %s", async (_outcome, createOperation) => {
    const persistence = createPersistence();
    const tracked = persistence.track(createOperation());

    await Promise.allSettled([tracked]);

    const allSettled = vi.spyOn(Promise, "allSettled");
    await expect(persistence.settlePending()).resolves.toBeUndefined();
    expect(allSettled).not.toHaveBeenCalled();
    allSettled.mockRestore();
  });

  it("waits for every in-flight tracked operation to settle", async () => {
    const persistence = createPersistence();
    let resolveFirst: (() => void) | undefined;
    let rejectSecond: ((error: Error) => void) | undefined;
    const first = persistence.track(new Promise<void>((resolve) => {
      resolveFirst = resolve;
    }));
    const second = persistence.track(new Promise<void>((_resolve, reject) => {
      rejectSecond = reject;
    }));
    let drainFinished = false;

    const drain = persistence.settlePending().then(() => {
      drainFinished = true;
    });
    resolveFirst?.();
    await first;
    await Promise.resolve();
    expect(drainFinished).toBe(false);

    rejectSecond?.(new Error("expected diagnostic failure"));
    await Promise.allSettled([second]);
    await drain;
    expect(drainFinished).toBe(true);
  });

  it("sets transaction-local statement and lock deadlines before work", async () => {
    const persistence = createPersistence();
    const work = vi.fn().mockResolvedValue("saved");

    await expect(persistence.run(work)).resolves.toBe("saved");

    expect(tx.execute).toHaveBeenCalledOnce();
    expect(tx.execute.mock.calls[0]?.[0]).toEqual({
      strings: [
        "SELECT set_config(\n        'statement_timeout',\n        ",
        ",\n        true\n      ), set_config(\n        'lock_timeout',\n        ",
        ",\n        true\n      )",
      ],
      values: ["25ms", "25ms"],
    });
    expect(tx.execute.mock.invocationCallOrder[0]).toBeLessThan(
      work.mock.invocationCallOrder[0]!,
    );
  });
});