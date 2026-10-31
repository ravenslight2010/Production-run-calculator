import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set before applying serial-to-identity conversion",
  );
}

const migrationUrl = new URL("./0003_serial_to_identity.sql", import.meta.url);
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
