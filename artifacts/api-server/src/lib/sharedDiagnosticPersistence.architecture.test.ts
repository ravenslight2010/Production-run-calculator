import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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