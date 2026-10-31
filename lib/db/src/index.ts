import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { AsyncLocalStorage } from "node:async_hooks";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Keep pool acquisition bounded so callers that already have their own
// fallback deadline do not wait forever behind a saturated checkout queue.
// This is intentionally shorter than cache-maintenance's one-second
// diagnostics deadline, allowing its local fallback to run after acquisition
// fails without leaving a waiter in node-postgres' pending queue.
const POOL_CONNECTION_TIMEOUT_MS = 900;
const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX);
const POOL_MAX =
  Number.isInteger(configuredPoolMax) && configuredPoolMax > 0
    ? configuredPoolMax
    : 10;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  max: POOL_MAX,
});

// node-postgres emits an `error` event on idle pooled clients when the backend
// connection is dropped server-side (e.g. Postgres terminating a connection due
// to an administrator command, code 57P01, or a network reset). Without a
// listener, node-postgres re-throws it as an uncaught exception that crashes the
// process. This is benign — the pool transparently reconnects on the next query
// — so swallow it here. Surfaced via console.error (this foundational lib has no
// app logger dependency by design) so a genuine, sustained failure is still
// visible without taking the server (or a test run) down.
pool.on("error", (err) => {
  console.error("Unexpected idle Postgres client error (pool will recover):", err);
});

const database = drizzle(pool, { schema });
type DatabaseTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type RequestTransaction = { tx: DatabaseTransaction; active: boolean; afterCommit: Array<() => void> };
const requestTransaction = new AsyncLocalStorage<RequestTransaction>();

/**
 * Explicitly scoped request transactions only. All other callers retain the
 * original database behavior, connection budget, and transaction ownership.
 */
export const db: typeof database = new Proxy(database, {
  get(target, property) {
    const context = requestTransaction.getStore();
    if (context && !context.active) throw new Error("The request database transaction is closed");
    const current = context?.active ? context.tx : target;
    const value = Reflect.get(current, property, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

export async function runInRequestDatabaseTransaction<T>(
  callback: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const effects: Array<() => void> = [];
  const result = await database.transaction(async (tx) => {
    const context: RequestTransaction = { tx, active: true, afterCommit: effects };
    try { return await requestTransaction.run(context, () => callback(tx)); }
    finally { context.active = false; }
  });
  for (const effect of effects) {
    try { effect(); }
    catch { console.error("A committed database refresh notification could not be delivered"); }
  }
  return result;
}

/** Keep cache invalidations and notifications behind the transaction commit. */
export function deferUntilDatabaseCommit(effect: () => void): boolean {
  const context = requestTransaction.getStore();
  if (!context?.active) return false;
  context.afterCommit.push(effect);
  return true;
}

export * from "./schema";
