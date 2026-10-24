// Historical rehearsals only. Never invoked by push, startup, or Publish.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { test } from "node:test";
import pg from "pg";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const historicalRevision = "486d53b43189c920a3025b3cb90aaf9543e826a2";
const serialRevision = "9723b35f5a3c343051cb96ff9dcc664ef9f4aa10";

test("historical push-first conversion distinguishes SQL errors, rows, counters, and identity ownership",
  { timeout: 180_000 }, async () => {
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
    const dir = await mkdtemp(path.join(tmpdir(), "branch-claims-"));
    // Separate pinned workspaces retain each revision's own catalog/lockfile
    // and all importer manifests, without copying uploaded customer assets.
    const packageDir = await mkdtemp(path.join(root, ".local/branch-claims-fixture-"));
    const data = path.join(dir, "pg");
    const socket = path.join(dir, "socket");
    const pgBin = path.dirname(execFileSync("which", ["postgres"], { encoding: "utf8" }).trim());
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    let started = false;
    let pool;
    const run = (command, args, cwd = root, url) => {
      const env = { ...process.env, NODE_ENV: "test" };
      for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key];
      delete env.SERIAL_IDENTITY_TEST_ADMIN_URL;
      delete env.DATABASE_URL;
      if (url) {
        const target = new URL(url);
        assert.equal(target.hostname, "127.0.0.1");
        assert.equal(Number(target.port), port);
        assert.match(target.pathname, /^\/branch_claims_test_/);
        env.DATABASE_URL = url;
      }
      const result = spawnSync(command, args, {
        cwd, env, encoding: "utf8", timeout: 60_000, maxBuffer: 4_000_000,
      });
      assert.ifError(result.error);
      return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
    };
    const clean = (r) => {
      assert.equal(r.status, 0, r.output);
      assert.doesNotMatch(r.output, /(?:DrizzleQueryError|Error):|already exists/);
    };
    try {
      clean(run(path.join(pgBin, "initdb"), ["-D", data, "-U", "postgres", "--auth=trust"]));
      await mkdir(socket);
      clean(run(path.join(pgBin, "pg_ctl"), [
        "-D", data, "-l", path.join(dir, "pg.log"),
        "-o", `-F -h 127.0.0.1 -p ${port} -k ${socket}`, "-w", "start",
      ]));
      started = true;
      const adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
      const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
      try {
        await admin.query("CREATE DATABASE branch_claims_test_history");
      } finally { await admin.end(); }
      const url = `postgresql://postgres@127.0.0.1:${port}/branch_claims_test_history`;
      pool = new pg.Pool({ connectionString: url, max: 1 });

      // Extract only the reviewed database package, never execute a workflow or install.
      const packages = [];
      for (const [name, revision] of [["serial", serialRevision], ["historical", historicalRevision]]) {
        const target = path.join(packageDir, name);
        await mkdir(target);
        const archive = execFileSync("git", [
          "archive", revision, "lib", "artifacts", "scripts",
          "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc",
        ], { cwd: root, maxBuffer: 64_000_000 });
        execFileSync("tar", ["-x", "-C", target], { input: archive });
        const pkg = path.join(target, "lib/db");
        // A symlinked workspace hoist root is rejected by native pnpm when it
        // verifies an archived lockfile. Install the pinned source-only
        // fixture itself; do not execute dependency lifecycle scripts.
        clean(run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], target));
        packages.push(pkg);
      }
      const [serial, historical] = packages;
      clean(run("pnpm", ["run", "push-force"], serial, url));
      await pool.query(`INSERT INTO production_runs
        (id,cases_needed,cases_left,skids_completed,pizzas_per_min,total_time_sec,batches_needed,inputs)
        VALUES (1036,1,1,0,1,60,1,'{}')`);
      await pool.query(`INSERT INTO audit_logs (id,actor,action,changes)
        VALUES (1006,'fixture','fixture','{}')`);
      await pool.query(`INSERT INTO operational_intent_ledger
        (sequence,scope,date,intent_id,outcome) VALUES (9001,'live','2026-10-20','fixture','accepted')`);
      await pool.query("SELECT setval('production_runs_id_seq', 2000, true)");
      await pool.query("SELECT setval('photo_aliases_id_seq', 77, true)");
      await pool.query("GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO audit_maintenance");
      const before = await pool.query(`SELECT
        (SELECT jsonb_agg(to_jsonb(t)) FROM production_runs t) runs,
        (SELECT jsonb_agg(to_jsonb(t)) FROM audit_logs t) audit,
        (SELECT jsonb_agg(to_jsonb(t)) FROM operational_intent_ledger t) cursor`);

      // Drizzle's exit status alone cannot prove the push succeeded.
      const rawPush = run("pnpm", ["exec", "drizzle-kit", "push", "--config", "./drizzle.config.ts"], historical, url);
      assert.equal(rawPush.status, 0, rawPush.output);
      assert.match(rawPush.output, /relation ["']production_runs_id_seq["'] already exists/);
      console.log("historical raw Drizzle push: exit=0; SQL relation production_runs_id_seq already exists");
      const wrapper = run("pnpm", ["run", "push"], historical, url);
      assert.equal(wrapper.status, 0, wrapper.output);
      assert.match(wrapper.output, /relation ["']production_runs_id_seq["'] already exists/);
      console.log("historical full push wrapper: exit=0; same SQL error; subsequent conversion completed");

      const after = await pool.query(`SELECT
        (SELECT jsonb_agg(to_jsonb(t)) FROM production_runs t) runs,
        (SELECT jsonb_agg(to_jsonb(t)) FROM audit_logs t) audit,
        (SELECT jsonb_agg(to_jsonb(t)) FROM operational_intent_ledger t) cursor`);
      assert.deepEqual(after.rows, before.rows, "all fixture row contents survive conversion");
      const metadata = await pool.query(`SELECT a.attidentity, d.deptype,
        pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
        FROM pg_attribute a
        JOIN pg_depend d ON d.refobjid=a.attrelid AND d.refobjsubid=a.attnum
          AND d.classid='pg_class'::regclass AND d.objid=pg_get_serial_sequence('production_runs','id')::regclass
        LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
        WHERE a.attrelid='production_runs'::regclass AND a.attname='id'`);
      assert.deepEqual(metadata.rows, [{ attidentity: "d", deptype: "i", default_expression: null }]);
      const next = await pool.query(`SELECT nextval('production_runs_id_seq')::int run,
        nextval('audit_logs_id_seq')::int audit, nextval('operational_intent_ledger_sequence_seq')::int cursor,
        nextval('photo_aliases_id_seq')::int advanced_empty, nextval('action_items_id_seq')::int empty`);
      assert.deepEqual(next.rows[0], { run: 1037, audit: 1007, cursor: 9002, advanced_empty: 2, empty: 2 });
      // These are intentional characterizations of the retired helper's defect,
      // NOT acceptable preservation behavior for a future rollout.
      console.log("historical conversion: rows preserved; populated counter 2000->1037; empty counter 77->2; cursor=9002; first empty=2 (gap)");
      const permission = await pool.query(`SELECT has_sequence_privilege(
        'audit_maintenance', 'audit_logs_id_seq', 'USAGE, SELECT') AS retained`);
      assert.equal(permission.rows[0].retained, false, "dropped generator loses its explicit audit grant");
      console.log("historical conversion: explicit audit sequence grant lost");
      clean(run("pnpm", ["run", "push"], historical, url));
      const rerun = await pool.query("SELECT nextval('production_runs_id_seq')::int value");
      assert.equal(rerun.rows[0].value, 1038, "identity rerun does not reset the counter again");

      // New identity tables are independent of legacy conversion.
      await pool.query("CREATE TABLE branch_claims_new_identity (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY)");
      const identity = await pool.query("INSERT INTO branch_claims_new_identity DEFAULT VALUES RETURNING id");
      assert.equal(identity.rows[0].id, 1);
      console.log("new identity table: first generated ID=1; backing sequence exists independently of legacy migration");
      assert.ok((await pool.query("SELECT pg_get_serial_sequence('branch_claims_new_identity','id') s")).rows[0].s);

      await pool.query("CREATE DATABASE branch_claims_test_current_helper");
      const helperUrl = `postgresql://postgres@127.0.0.1:${port}/branch_claims_test_current_helper`;
      clean(run("pnpm", ["run", "push-force"], serial, helperUrl));
      const helperPool = new pg.Pool({ connectionString: helperUrl, max: 1 });
      try {
        await helperPool.query(`INSERT INTO production_runs
          (id,cases_needed,cases_left,skids_completed,pizzas_per_min,total_time_sec,batches_needed,inputs)
          VALUES (1036,1,1,0,1,60,1,'{}')`);
        await helperPool.query("SELECT setval('production_runs_id_seq', 2000, true)");
        await helperPool.query("SELECT setval('photo_aliases_id_seq', 77, true)");
        clean(run(process.execPath, ["lib/db/migrations/apply-serial-to-identity.mjs"], root, helperUrl));
        const values = await helperPool.query(`SELECT nextval('production_runs_id_seq')::int run,
          nextval('photo_aliases_id_seq')::int advanced_empty, nextval('action_items_id_seq')::int empty`);
        assert.deepEqual(values.rows[0], {
          run: 2001,
          advanced_empty: 78,
          empty: 1,
        });
        console.log("current direct helper: populated and advanced-empty high-water marks are preserved; empty first=1; NOT Publish proof");
      } finally {
        await helperPool.end();
      }
    } finally {
      await pool?.end();
      if (started) {
        const stop = run(path.join(pgBin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
        assert.equal(stop.status, 0, stop.output);
      }
      await rm(dir, { recursive: true, force: true });
      await rm(packageDir, { recursive: true, force: true });
    }
  });

