import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type DatabaseTransactionCallback = Parameters<typeof db.transaction>[0];
export type SharedDiagnosticTransaction = Parameters<DatabaseTransactionCallback>[0];

type SharedDiagnosticPersistenceOptions = {
  callerTimeoutMs: number;
  databaseTimeoutMs: number;
  timeoutMessage: string;
};

/**
 * Coordinates the safety controls around optional diagnostic persistence.
 *
 * Diagnostic payloads stay inside each caller's typed transaction callback;
 * this helper only accepts persistence work and fallback behavior.
 */
export function createSharedDiagnosticPersistence(
  options: SharedDiagnosticPersistenceOptions,
) {
  const pending = new Set<Promise<unknown>>();

  async function withCallerTimeout<T>(work: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(options.timeoutMessage)),
            options.callerTimeoutMs,
          );
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function run<T>(
    work: (tx: SharedDiagnosticTransaction) => Promise<T>,
  ): Promise<T> {
    return withCallerTimeout(db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config(
        'statement_timeout',
        ${`${options.databaseTimeoutMs}ms`},
        true
      ), set_config(
        'lock_timeout',
        ${`${options.databaseTimeoutMs}ms`},
        true
      )`);
      return work(tx);
    }));
  }

  async function runOrFallback<T>(
    work: (tx: SharedDiagnosticTransaction) => Promise<T>,
    fallback: () => T | Promise<T>,
  ): Promise<T> {
    try {
      return await run(work);
    } catch {
      return fallback();
    }
  }

  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise);
    promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }

  async function settlePending(): Promise<void> {
    if (pending.size > 0) {
      await Promise.allSettled([...pending]);
    }
  }

  return { run, runOrFallback, track, settlePending };
}