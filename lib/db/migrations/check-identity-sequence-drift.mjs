import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const migrationPath = new URL("./0003_serial_to_identity.sql", import.meta.url);
const migrationSql = await readFile(migrationPath, "utf8");
const targets = [...migrationSql.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/gu)].map(
  ([, tableName, columnName]) => ({ tableName, columnName }),
);

if (targets.length !== 37) {
  throw new Error(`Expected 37 identity targets; found ${targets.length}.`);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualifiedName(schema, relation) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(relation)}`;
}

/**
 * Inspect the identity generators without advancing or resetting them.
 * Uses one bounded, read-only transaction and returns at most the 37
 * migration-owned targets.
 */
export async function checkIdentitySequenceDrift(pool) {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    await client.query("SET LOCAL statement_timeout = '10000ms'");

    const values = targets
      .map((_, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::text)`)
      .join(", ");
    const parameters = targets.flatMap(({ tableName, columnName }) => [
      tableName,
      columnName,
    ]);
    const metadata = await client.query(
      `WITH expected(table_name, column_name) AS (VALUES ${values})
       SELECT expected.table_name, expected.column_name,
              columns.is_identity, columns.identity_generation,
              sequence_ns.nspname AS sequence_schema,
              sequence.relname AS sequence_name,
              pg_sequence.seqincrement::text AS increment_by
       FROM expected
       LEFT JOIN information_schema.columns AS columns
         ON columns.table_schema = 'public'
        AND columns.table_name = expected.table_name
        AND columns.column_name = expected.column_name
       LEFT JOIN pg_class AS sequence
         ON sequence.oid = pg_get_serial_sequence(
           format('%I.%I', 'public', expected.table_name),
           expected.column_name
         )::regclass
       LEFT JOIN pg_namespace AS sequence_ns ON sequence_ns.oid = sequence.relnamespace
       LEFT JOIN pg_sequence ON pg_sequence.seqrelid = sequence.oid
       ORDER BY expected.table_name, expected.column_name`,
      parameters,
    );

    if (metadata.rowCount !== targets.length) {
      throw new Error(
        `Identity target lookup returned ${metadata.rowCount ?? 0} rows; expected ${targets.length}.`,
      );
    }

    for (const row of metadata.rows) {
      if (
        row.is_identity !== "YES" ||
        row.identity_generation !== "BY DEFAULT" ||
        !row.sequence_schema ||
        !row.sequence_name ||
        row.increment_by == null
      ) {
        throw new Error(
          `Expected public.${row.table_name}.${row.column_name} to be a BY DEFAULT identity with an owned sequence.`,
        );
      }
      if (BigInt(row.increment_by) <= 0n) {
        throw new Error(
          `Unsupported non-positive identity increment on public.${row.table_name}.${row.column_name}.`,
        );
      }
    }

    const checks = metadata.rows
      .map((row) => {
        const table = qualifiedName("public", row.table_name);
        const column = quoteIdentifier(row.column_name);
        const sequence = qualifiedName(row.sequence_schema, row.sequence_name);
        const target = `${row.table_name}.${row.column_name}`;
        return `SELECT '${target}'::text AS target,
                       (SELECT MAX(${column})::text FROM ${table}) AS table_max,
                       (SELECT last_value::text FROM ${sequence}) AS sequence_last_value,
                       (SELECT is_called FROM ${sequence}) AS sequence_is_called,
                       ${BigInt(row.increment_by)}::text AS increment_by`;
      })
      .join("\nUNION ALL\n");
    const result = await client.query(
      `SELECT * FROM (${checks}) AS identity_checks ORDER BY target`,
    );
    if (result.rowCount !== targets.length) {
      throw new Error(
        `Identity check returned ${result.rowCount ?? 0} rows; expected ${targets.length}.`,
      );
    }

    const report = result.rows.map((row) => {
      const maxId = row.table_max == null ? null : BigInt(row.table_max);
      const lastValue = BigInt(row.sequence_last_value);
      const increment = BigInt(row.increment_by);
      const nextGeneratedId = lastValue + (row.sequence_is_called ? increment : 0n);
      const isBehind = maxId != null && nextGeneratedId <= maxId;
      return {
        target: row.target,
        tableMax: maxId?.toString() ?? null,
        sequenceLastValue: lastValue.toString(),
        sequenceIsCalled: row.sequence_is_called,
        nextGeneratedId: nextGeneratedId.toString(),
        status: isBehind ? "drift" : "ok",
      };
    });

    await client.query("ROLLBACK");
    transactionOpen = false;
    return report;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the diagnostic error; releasing the client closes its transaction.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set to run the identity sequence diagnostic.");
  }

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const report = await checkIdentitySequenceDrift(pool);
    const drifted = report.filter(({ status }) => status === "drift");
    console.log(JSON.stringify({ checked: report.length, drifted }, null, 2));
    if (drifted.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Identity sequence diagnostic failed.");
    process.exitCode = 2;
  });
}
