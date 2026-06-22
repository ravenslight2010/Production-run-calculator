import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
