import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set before applying audit-log protection");
}

const migrationUrl = new URL("./0001_audit_logs_append_only.sql", import.meta.url);
const migration = await readFile(migrationUrl, "utf8");
const pool = new pg.Pool({ connectionString, max: 1 });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration);
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