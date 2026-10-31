// Runtime-owned, immutable serial targets. The historical migration supplies
// the original inventory, NOT the generator contract (see ../dev/README.md).
// New schema targets are added here without rewriting that historical SQL.
// Keep the legacy identity-* module/event names for consumer compatibility.
export const IDENTITY_SEQUENCE_TARGETS = Object.freeze([
  ["action_items", "id"],
  ["ai_conversation_turns", "id"],
  ["ai_corrections", "id"],
  ["ai_result_cache", "id"],
  ["audit_logs", "id"],
  ["background_operation_events", "id"],
  ["cache_maintenance_events", "id"],
  ["denied_merges", "id"],
  ["duplicate_review_groups", "id"],
  ["facility_knowledge", "id"],
  ["factory_kv", "id"],
  ["field_check_issues", "id"],
  ["field_check_observations", "id"],
  ["fill_missing_values", "id"],
  ["freezer_surplus_adjustments", "id"],
  ["freezer_surplus_decision_corrections", "id"],
  ["import_aliases", "id"],
  ["import_history", "id"],
  ["ingredient_batch_weights", "id"],
  ["inventory_items", "id"],
  ["inventory_ledger", "id"],
  ["inventory_locations", "id"],
  ["inventory_lots", "id"],
  ["inventory_observations", "id"],
  ["inventory_product_references", "id"],
  ["merge_aliases", "id"],
  ["merged_away", "id"],
  ["operational_intent_ledger", "sequence"],
  ["photo_aliases", "id"],
  ["production_runs", "id"],
  ["qc_workflow_events", "id"],
  ["quality_checks", "id"],
  ["saved_cheese_sheets", "id"],
  ["saved_premix_sheets", "id"],
  ["saved_shipping_guides", "id"],
  ["saved_spec_sheets", "id"],
  ["spec_import_aliases", "id"],
  ["sync_conflict_logs", "id"],
].map(([tableName, columnName]) => Object.freeze({ tableName, columnName })));

const targets = IDENTITY_SEQUENCE_TARGETS;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualifiedName(schema, relation) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(relation)}`;
}

/**
 * Inspect the supported serial generators without advancing or resetting them.
 * Uses one bounded, read-only transaction and returns at most the 38
 * schema-owned targets. Importing this module performs no I/O.
 */
export async function checkIdentitySequenceDrift(pool) {
  const client = await pool.connect();
  let transactionOpen = false;
  let discardClient = false;

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
              attribute.atttypid = 'int4'::regtype AND attribute.attnotnull AS valid_column,
              pg_get_expr(defaults.adbin, defaults.adrelid) AS column_default,
              format('nextval(%L::regclass)', sequence.oid::regclass::text) AS expected_default,
              EXISTS (
                SELECT 1 FROM pg_depend AS ownership
                WHERE ownership.classid = 'pg_class'::regclass
                  AND ownership.objid = sequence.oid
                  AND ownership.refclassid = 'pg_class'::regclass
                  AND ownership.refobjid = attribute.attrelid
                  AND ownership.refobjsubid = attribute.attnum
                  AND ownership.deptype = 'a'
              ) AS serial_owned,
              sequence_ns.nspname AS sequence_schema,
              sequence.relname AS sequence_name,
              pg_sequence.seqincrement::text AS increment_by,
              pg_sequence.seqcycle AS cycles
       FROM expected
       LEFT JOIN information_schema.columns AS columns
         ON columns.table_schema = 'public'
        AND columns.table_name = expected.table_name
        AND columns.column_name = expected.column_name
       LEFT JOIN pg_attribute AS attribute
         ON attribute.attrelid = to_regclass(format('%I.%I', 'public', expected.table_name))
        AND attribute.attname = expected.column_name
        AND NOT attribute.attisdropped
       LEFT JOIN pg_attrdef AS defaults
         ON defaults.adrelid = attribute.attrelid AND defaults.adnum = attribute.attnum
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
        row.is_identity !== "NO" ||
        row.identity_generation != null ||
        row.valid_column !== true ||
        row.serial_owned !== true ||
        row.column_default == null ||
        row.column_default !== row.expected_default ||
        !row.sequence_schema ||
        !row.sequence_name ||
        row.increment_by == null ||
        row.cycles !== false
      ) {
        throw new Error(
          `Expected public.${row.table_name}.${row.column_name} to be a non-null integer serial with its owned, non-cycling sequence as the nextval default.`,
        );
      }
      if (BigInt(row.increment_by) <= 0n) {
        throw new Error(
          `Unsupported non-positive serial increment on public.${row.table_name}.${row.column_name}.`,
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
        // A normal pool release does NOT close a failed/open transaction.
        // Destroy this connection rather than handing it to another caller.
        discardClient = true;
      }
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}
