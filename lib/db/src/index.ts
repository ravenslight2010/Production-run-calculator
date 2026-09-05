import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

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
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
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

export const db = drizzle(pool, { schema });

export * from "./schema";
