// Called only with the disposable database created by the integration suite.
import assert from "node:assert/strict";
import { checkIdentitySequenceDrift, IDENTITY_SEQUENCE_TARGETS } from "./identity-sequence-drift.mjs";
import { runIdentitySequenceHealthCheck } from "./identity-sequence-health.mjs";

async function snapshot(pool) {
  const state = [];
  for (const { tableName, columnName } of IDENTITY_SEQUENCE_TARGETS) {
    // Identifiers come only from the fixed runtime inventory.
    const result = await pool.query(`
      SELECT (SELECT jsonb_agg(row_data ORDER BY row_data::text)
              FROM (SELECT to_jsonb(t) AS row_data FROM public."${tableName}" t) fixture_rows) AS rows,
             last_value::text, is_called
      FROM public."${tableName}_${columnName}_seq"`);
    state.push(result.rows[0]);
  }
  return state;
}

function observedPool(pool, queries, injectedQuery, failRollback = false) {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, parameters) {
          queries.push(sql);
          if (sql === "ROLLBACK" && failRollback) throw new Error("fixture rollback failure");
          if (sql.startsWith("WITH expected")) {
            const mode = await client.query("SHOW transaction_read_only");
            assert.equal(mode.rows[0].transaction_read_only, "on");
            if (injectedQuery) await client.query(injectedQuery);
          }
          return client.query(sql, parameters);
        },
        release(discard) {
          client.release(discard);
          if (discard) queries.push("DISCARDED");
        },
      };
    },
  };
}

export async function verifySerialHealthContract(pool) {
  const before = await snapshot(pool);
  const queries = [];
  const result = await runIdentitySequenceHealthCheck(observedPool(pool, queries));
  assert.deepEqual(result, {
    checked: IDENTITY_SEQUENCE_TARGETS.length, driftedCount: 0, driftedTargets: [], targetsTruncated: false,
    hadDrift: false, warningStarted: false, warningCleared: false,
  });
  assert.equal(queries[0], "BEGIN READ ONLY");
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.deepEqual(await snapshot(pool), before, "healthy diagnostics preserve every row and counter");

  const invalidMetadata = [
    ["missing default",
      "ALTER TABLE public.action_items ALTER COLUMN id DROP DEFAULT",
      "ALTER TABLE public.action_items ALTER COLUMN id SET DEFAULT nextval('public.action_items_id_seq'::regclass)"],
    ["constant default",
      "ALTER TABLE public.action_items ALTER COLUMN id SET DEFAULT 42",
      "ALTER TABLE public.action_items ALTER COLUMN id SET DEFAULT nextval('public.action_items_id_seq'::regclass)"],
    ["wrong sequence default despite retained ownership",
      "ALTER TABLE public.action_items ALTER COLUMN id SET DEFAULT nextval('public.ai_corrections_id_seq'::regclass)",
      "ALTER TABLE public.action_items ALTER COLUMN id SET DEFAULT nextval('public.action_items_id_seq'::regclass)"],
    ["expression around nextval",
      "ALTER TABLE public.action_items ALTER COLUMN id SET DEFAULT (nextval('public.action_items_id_seq'::regclass) + 1)",
      "ALTER TABLE public.action_items ALTER COLUMN id SET DEFAULT nextval('public.action_items_id_seq'::regclass)"],
    ["unowned generator",
      "ALTER SEQUENCE public.action_items_id_seq OWNED BY NONE",
      "ALTER SEQUENCE public.action_items_id_seq OWNED BY public.action_items.id"],
    ["cycling generator",
      "ALTER SEQUENCE public.action_items_id_seq CYCLE",
      "ALTER SEQUENCE public.action_items_id_seq NO CYCLE"],
    ["negative increment",
      "ALTER SEQUENCE public.action_items_id_seq INCREMENT BY -1 MINVALUE 1 MAXVALUE 2147483647",
      "ALTER SEQUENCE public.action_items_id_seq INCREMENT BY 1"],
    ["missing target",
      "ALTER TABLE public.action_items RENAME TO missing_action_items",
      "ALTER TABLE public.missing_action_items RENAME TO action_items"],
  ];
  for (const [label, mutate, restore] of invalidMetadata) {
    await pool.query(mutate);
    try {
      const failedQueries = [];
      await assert.rejects(
        checkIdentitySequenceDrift(observedPool(pool, failedQueries)),
        undefined, label,
      );
      assert.equal(failedQueries.at(-1), "ROLLBACK", `${label} rolls back`);
      const mode = await pool.query("SHOW transaction_read_only");
      assert.equal(mode.rows[0].transaction_read_only, "off", `${label} releases a reusable client`);
    } finally {
      await pool.query(restore);
    }
    assert.equal((await runIdentitySequenceHealthCheck(pool)).hadDrift, false, `${label} recovers`);
  }

  // Identity is NOT a second silently accepted contract. Change only a pristine
  // disposable target; restore its original serial sequence/default afterwards.
  await pool.query("ALTER TABLE public.action_items ALTER COLUMN id DROP DEFAULT");
  await pool.query("ALTER SEQUENCE public.action_items_id_seq OWNED BY NONE");
  await pool.query("ALTER TABLE public.action_items ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY");
  try {
    await assert.rejects(checkIdentitySequenceDrift(pool), /non-null integer serial/);
  } finally {
    await pool.query("ALTER TABLE public.action_items ALTER COLUMN id DROP IDENTITY");
    await pool.query("ALTER SEQUENCE public.action_items_id_seq OWNED BY public.action_items.id");
    await pool.query("ALTER TABLE public.action_items ALTER COLUMN id SET DEFAULT nextval('public.action_items_id_seq'::regclass)");
  }

  // Attempted mutations inside the actual diagnostic transaction must fail at
  // PostgreSQL's read-only boundary, roll back, and leave all counters untouched.
  for (const injected of [
    "DELETE FROM public.photo_aliases",
    "SELECT nextval('public.action_items_id_seq'::regclass)",
    "SELECT setval('public.action_items_id_seq'::regclass, 99999)",
  ]) {
    const failedQueries = [];
    await assert.rejects(
      checkIdentitySequenceDrift(observedPool(pool, failedQueries, injected)),
      { code: "25006" },
    );
    assert.equal(failedQueries.at(-1), "ROLLBACK");
  }
  const rollbackFailure = [];
  await assert.rejects(
    checkIdentitySequenceDrift(observedPool(
      pool, rollbackFailure, "SELECT nextval('public.action_items_id_seq'::regclass)", true,
    )),
    { code: "25006" },
    "rollback failure preserves the original diagnostic error",
  );
  assert.equal(rollbackFailure.at(-1), "DISCARDED", "failed rollback must destroy the pooled connection");
  assert.equal((await pool.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "off");
  assert.deepEqual(await snapshot(pool), before, "metadata errors and read-only enforcement preserve IDs and progress");

  // A never-called sequence at exactly MAX(id) is drift, not a safe allocation.
  await pool.query("INSERT INTO public.photo_aliases (id, guess_name, item_key) VALUES (77, 'fixture', 'fixture')");
  await pool.query("SELECT setval('public.photo_aliases_id_seq', 77, false)");
  try {
    const report = await checkIdentitySequenceDrift(pool);
    assert.equal(report.find(row => row.target === "photo_aliases.id").status, "drift");
  } finally {
    await pool.query("DELETE FROM public.photo_aliases WHERE id = 77");
    await pool.query("SELECT setval('public.photo_aliases_id_seq', 77, true)");
  }
  assert.deepEqual(await snapshot(pool), before);
}
