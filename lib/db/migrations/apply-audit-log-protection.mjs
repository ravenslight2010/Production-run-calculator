import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set before applying audit-log protection");
}

const migrationUrls = [
  new URL("./0001_audit_logs_append_only.sql", import.meta.url),
  new URL("./0002_qc_workflow_events_append_only.sql", import.meta.url),
];
const migrations = await Promise.all(
  migrationUrls.map((migrationUrl) => readFile(migrationUrl, "utf8")),
);
const pool = new pg.Pool({ connectionString, max: 1 });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const migration of migrations) {
      await client.query(migration);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}