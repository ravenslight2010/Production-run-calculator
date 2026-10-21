import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import pg from "pg";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packageName = "@workspace/db";
const targets = parseTargets(
  await readFile(new URL("./0003_serial_to_identity.sql", import.meta.url), "utf8"),
);
const developmentRepairSql = await readFile(
  new URL("../dev/restore-serial-generators.sql", import.meta.url), "utf8",
);
const seededHighWaterMarks = new Map([
  ["audit_logs.id", 1006],
  ["production_runs.id", 1036],
  ["operational_intent_ledger.sequence", 9001],
  ["photo_aliases.id", 77], // Empty table: counter must not reset to MAX(id).
]);

function parseTargets(sql) {
  const parsed = [...sql.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/gu)].map(
    ([, tableName, columnName]) => ({ tableName, columnName }),
  );
  assert.equal(parsed.length, 37, "migration target list should contain 37 columns");
  return parsed;
}

function findBinary(name) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  assert.equal(result.status, 0, `required PostgreSQL binary is unavailable: ${name}`);
  return result.stdout.trim();
}

function run(command, args, { cwd = repoRoot, env = process.env, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > 2_000_000) output = output.slice(-2_000_000);
    };
    const signalChild = (signal) => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall through to the direct child if its process group is gone.
        }
      }
      child.kill(signal);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      signalChild("SIGTERM");
      setTimeout(() => signalChild("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} exceeded ${timeoutMs}ms.\n${output}`));
      } else if (code !== 0) {
        reject(new Error(`${command} exited with ${code ?? signal}.\n${output}`));
      } else {
        resolve(output);
      }
    });
  });
}

function privateDatabaseEnvironment(databaseUrl) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PG")) delete env[key];
  }
  delete env.SERIAL_IDENTITY_TEST_ADMIN_URL;
  env.DATABASE_URL = databaseUrl;
  env.NODE_ENV = "test";
  return env;
}

function getSafeExternalAdminUrl() {
  const explicitUrl = process.env.SERIAL_IDENTITY_TEST_ADMIN_URL;
  const candidate = explicitUrl ?? process.env.DATABASE_URL;
  if (!candidate) return null;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    if (explicitUrl) {
      throw new Error("SERIAL_IDENTITY_TEST_ADMIN_URL must be a local disposable PostgreSQL URL");
    }
    return null;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  const isTestDatabase = /(?:^|[_-])(?:test|ci)(?:$|[_-])/iu.test(databaseName);
  if (isLoopback && isTestDatabase) return parsed.toString();
  if (explicitUrl) {
    throw new Error(
      "SERIAL_IDENTITY_TEST_ADMIN_URL must use a loopback host and a database name containing test or ci",
    );
  }
  return null;
}

function urlForDatabase(adminUrl, databaseName) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function chooseLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

function assertNoDrizzleError(output, label) {
  assert.doesNotMatch(
    output,
    /(?:^|\n)\s*(?:Drizzle(?:Query)?Error|Error)\s*:|relation\s+["`]?.*?_id_seq["`]?.*already exists/imu,
    `${label} logged a Drizzle error or serial-sequence collision despite its exit status`,
  );
}

test("the push-output guard catches Drizzle errors hidden by a zero CLI exit", () => {
  assert.throws(
    () =>
      assertNoDrizzleError(
        'relation "production_runs_id_seq" already exists',
        "push",
      ),
    /logged a Drizzle error/u,
  );
  assert.throws(
    () => assertNoDrizzleError("DrizzleQueryError: migration failed", "push"),
    /logged a Drizzle error/u,
  );
  assert.doesNotThrow(() => assertNoDrizzleError("Changes applied successfully", "push"));
});

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

test("normal database commands cannot reintroduce the unsupported identity rollout", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(scripts["apply-serial-to-identity"], undefined);
  for (const command of [scripts.push, scripts["push-force"]]) {
    assert.doesNotMatch(command, /serial-to-identity/);
    assert.match(command, /drizzle-kit push/);
  }
});

async function setUpSerialFixture(pool) {
  for (const { tableName, columnName } of targets) {
    const table = quoteIdentifier(tableName);
    const column = quoteIdentifier(columnName);
    const sequenceName = `${tableName}_${columnName}_seq`;
    const sequence = quoteIdentifier(sequenceName);
    await pool.query(
      `ALTER TABLE public.${table} ALTER COLUMN ${column} DROP IDENTITY IF EXISTS`,
    );
    await pool.query(`ALTER TABLE public.${table} ALTER COLUMN ${column} DROP DEFAULT`);
    await pool.query(`DROP SEQUENCE IF EXISTS public.${sequence}`);
    await pool.query(`CREATE SEQUENCE public.${sequence}`);
    await pool.query(
      `ALTER TABLE public.${table} ALTER COLUMN ${column} SET DEFAULT nextval('public.${sequenceName}'::regclass)`,
    );
    await pool.query(
      `ALTER SEQUENCE public.${sequence} OWNED BY public.${table}.${column}`,
    );
  }

  await pool.query(
    `INSERT INTO public.audit_logs (id, actor, action, changes)
     VALUES (1006, 'identity-fixture', 'migration-test', '{}'::jsonb)`,
  );
  await pool.query(
    `INSERT INTO public.production_runs
      (id, cases_needed, cases_left, skids_completed, pizzas_per_min,
       total_time_sec, batches_needed, inputs)
     VALUES (1036, 1, 1, 0, 1, 60, 1, '{}'::jsonb)`,
  );
  await pool.query(
    `INSERT INTO public.operational_intent_ledger
      (sequence, scope, date, intent_id, outcome)
     VALUES (9001, 'live', '2026-10-20', 'serial-identity-fixture', 'accepted')`,
  );
  for (const { tableName, columnName } of targets) {
    const highWater = seededHighWaterMarks.get(`${tableName}.${columnName}`);
    if (highWater !== undefined) {
      await pool.query("SELECT setval($1::regclass, $2, true)",
        [`public.${tableName}_${columnName}_seq`, highWater]);
    }
  }
}

async function verifyIdentityColumns(pool) {
  for (const { tableName, columnName } of targets) {
    const qualifiedTable = `public.${tableName}`;
    const column = await pool.query(
      `SELECT data_type, is_nullable, is_identity, identity_generation
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [tableName, columnName],
    );
    assert.equal(column.rowCount, 1, `${qualifiedTable}.${columnName} exists`);
    assert.equal(column.rows[0].data_type, "integer", `${qualifiedTable}.${columnName} remains integer`);
    assert.equal(column.rows[0].is_nullable, "NO", `${qualifiedTable}.${columnName} remains NOT NULL`);
    assert.equal(column.rows[0].is_identity, "NO", `${qualifiedTable}.${columnName} stays serial`);
    assert.equal(
      column.rows[0].identity_generation,
      null,
      `${qualifiedTable}.${columnName} accepts explicit IDs`,
    );

    const sequenceResult = await pool.query(
      "SELECT pg_get_serial_sequence($1, $2) AS sequence_name",
      [qualifiedTable, columnName],
    );
    const sequenceName = sequenceResult.rows[0].sequence_name;
    assert.ok(sequenceName, `${qualifiedTable}.${columnName} owns an identity sequence`);

    const dependency = await pool.query(
      `SELECT d.deptype
       FROM pg_depend d
       WHERE d.classid = 'pg_class'::regclass
         AND d.objid = $1::regclass
         AND d.refclassid = 'pg_class'::regclass
         AND d.refobjid = $2::regclass
         AND d.refobjsubid = (
           SELECT attnum FROM pg_attribute
           WHERE attrelid = $2::regclass AND attname = $3
         )`,
      [sequenceName, qualifiedTable, columnName],
    );
    assert.ok(
      dependency.rows.some(({ deptype }) => deptype === "a"),
      `${qualifiedTable}.${columnName} serial sequence is automatically owned`,
    );

    if (columnName === "id") {
      const primaryKey = await pool.query(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid
           WHERE i.indrelid = $1::regclass
             AND i.indisprimary
             AND a.attname = $2
             AND a.attnum = ANY(i.indkey)
         ) AS has_primary_key`,
        [qualifiedTable, columnName],
      );
      assert.equal(
        primaryKey.rows[0].has_primary_key,
        true,
        `${qualifiedTable}.${columnName} remains the primary key`,
      );
    }

    const expectedNext = (seededHighWaterMarks.get(`${tableName}.${columnName}`) ?? 0) + 1;
    const nextId = await pool.query("SELECT nextval($1::regclass) AS id", [sequenceName]);
    assert.equal(
      Number(nextId.rows[0].id),
      expectedNext,
      `${qualifiedTable}.${columnName} generates the next unused value`,
    );
  }
}

async function verifySeedRows(pool) {
  const audit = await pool.query("SELECT id FROM public.audit_logs WHERE id = 1006");
  const run = await pool.query("SELECT id FROM public.production_runs WHERE id = 1036");
  const cursor = await pool.query(
    "SELECT sequence FROM public.operational_intent_ledger WHERE sequence = 9001",
  );
  assert.equal(audit.rowCount, 1, "pre-existing audit ID is preserved");
  assert.equal(run.rowCount, 1, "pre-existing production-run ID is preserved");
  assert.equal(cursor.rowCount, 1, "pre-existing operational cursor is preserved");

  const auditInsert = await pool.query(
    `INSERT INTO public.audit_logs (actor, action, changes)
     VALUES ('identity-fixture', 'generated-id-check', '{}'::jsonb)
     RETURNING id`,
  );
  const runInsert = await pool.query(
    `INSERT INTO public.production_runs
      (cases_needed, cases_left, skids_completed, pizzas_per_min,
       total_time_sec, batches_needed, inputs)
     VALUES (1, 1, 0, 1, 60, 1, '{}'::jsonb)
     RETURNING id`,
  );
  const cursorInsert = await pool.query(
    `INSERT INTO public.operational_intent_ledger
      (scope, date, intent_id, outcome)
     VALUES ('live', '2026-10-20', 'serial-identity-generated', 'accepted')
     RETURNING sequence`,
  );
  assert.equal(Number(auditInsert.rows[0].id), 1008);
  assert.equal(Number(runInsert.rows[0].id), 1038);
  assert.equal(Number(cursorInsert.rows[0].sequence), 9003);

  await assert.rejects(
    pool.query(
      `INSERT INTO public.production_runs
        (id, cases_needed, cases_left, skids_completed, pizzas_per_min,
         total_time_sec, batches_needed, inputs)
       VALUES (1036, 1, 1, 0, 1, 60, 1, '{}'::jsonb)`,
    ),
    (error) => error?.code === "23505",
    "duplicate primary-key IDs are rejected",
  );
}

async function verifySequencesRemainAdvanced(pool) {
  for (const { tableName, columnName } of targets) {
    const sequenceResult = await pool.query(
      "SELECT pg_get_serial_sequence($1, $2) AS sequence_name",
      [`public.${tableName}`, columnName],
    );
    const sequenceName = sequenceResult.rows[0].sequence_name;
    const nextId = await pool.query("SELECT nextval($1::regclass) AS id", [sequenceName]);
    const firstExpected =
      (seededHighWaterMarks.get(`${tableName}.${columnName}`) ?? 0) + 1;
    const usedAdditionalInsert = ["audit_logs", "production_runs", "operational_intent_ledger"].includes(tableName);
    assert.equal(
      Number(nextId.rows[0].id),
      firstExpected + (usedAdditionalInsert ? 2 : 1),
      `${tableName}.${columnName} sequence is not reset on a second push`,
    );
  }
}

async function createDatabase(adminPool, name, template) {
  const templateClause = template ? ` TEMPLATE ${quoteIdentifier(template)}` : "";
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(name)}${templateClause}`);
}

test(
  "database package pushes preserve serial generators and the approved development repair is rerunnable",
  { timeout: 300_000 },
  async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "test must not run in production");
    assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1", "test must not run in a deployment");
    const externalAdminUrl = getSafeExternalAdminUrl();
    const suffix = `${process.pid}_${Date.now().toString(36)}`;
    const seedDatabase = `identity_seed_${suffix}`;
    const pushDatabase = `identity_push_${suffix}`;
    const forceDatabase = `identity_force_${suffix}`;
    const createdDatabaseNames = new Set();
    let adminPool;
    let primaryError;
    let cleanupError;
    let adminUrl = externalAdminUrl;
    let tempDirectory;
    let dataDirectory;
    let pgCtl;
    let clusterMayBeRunning = false;

    try {
      if (!adminUrl) {
        assert.ok(
          typeof process.getuid !== "function" || process.getuid() !== 0,
          "PostgreSQL must run as a non-root user",
        );
        const postgres = findBinary("postgres");
        const postgresDirectory = path.dirname(postgres);
        const initdb = path.join(postgresDirectory, "initdb");
        pgCtl = path.join(postgresDirectory, "pg_ctl");
        tempDirectory = await mkdtemp(path.join(tmpdir(), "serial-to-identity-"));
        dataDirectory = path.join(tempDirectory, "data");
        const socketDirectory = path.join(tempDirectory, "socket");
        const logPath = path.join(tempDirectory, "postgres.log");
        const port = await chooseLoopbackPort();

        await run(initdb, [
          "-D",
          dataDirectory,
          "-U",
          "postgres",
          "--auth=trust",
          "--no-instructions",
        ]);
        await mkdir(socketDirectory);
        clusterMayBeRunning = true;
        await run(pgCtl, [
          "-D",
          dataDirectory,
          "-o",
          `-F -p ${port} -h 127.0.0.1 -k ${socketDirectory}`,
          "-l",
          logPath,
          "-w",
          "start",
        ]);
        adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
      }

      adminPool = new pg.Pool({
        connectionString: adminUrl,
        max: 1,
        connectionTimeoutMillis: 5_000,
      });
      const createDatabasePermission = await adminPool.query(
        `SELECT rolsuper OR rolcreatedb AS allowed
         FROM pg_roles WHERE rolname = current_user`,
      );
      assert.equal(
        createDatabasePermission.rows[0]?.allowed,
        true,
        "disposable test database role must be able to create databases",
      );
      await createDatabase(adminPool, seedDatabase);
      createdDatabaseNames.add(seedDatabase);
      const seedUrl = urlForDatabase(adminUrl, seedDatabase);
      const initialPush = await run(
        "pnpm",
        [
          "--filter",
          packageName,
          "exec",
          "drizzle-kit",
          "push",
          "--force",
          "--config",
          "./drizzle.config.ts",
        ],
        { env: privateDatabaseEnvironment(seedUrl) },
      );
      assertNoDrizzleError(initialPush, "initial disposable schema creation");

      await createDatabase(adminPool, pushDatabase, seedDatabase);
      createdDatabaseNames.add(pushDatabase);
      await createDatabase(adminPool, forceDatabase, seedDatabase);
      createdDatabaseNames.add(forceDatabase);
      await adminPool.query(`DROP DATABASE ${quoteIdentifier(seedDatabase)}`);

      for (const [databaseName, packageScript] of [
        [pushDatabase, "push"],
        [forceDatabase, "push-force"],
      ]) {
        const databaseUrl = urlForDatabase(adminUrl, databaseName);
        const targetUrl = new URL(databaseUrl);
        assert.ok(
          ["localhost", "127.0.0.1", "[::1]"].includes(targetUrl.hostname),
          "package pushes must only target a loopback database",
        );
        assert.match(
          targetUrl.pathname,
          /^\/identity_(?:push|force)_/u,
          "package pushes must only target a generated disposable database",
        );
        const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
        try {
          await setUpSerialFixture(pool);
          if (packageScript === "push-force") {
            // Reproduce development's identity schema, including an empty
            // table whose counter is above MAX(id), without touching prod.
            await run("node", ["./migrations/apply-serial-to-identity.mjs"], {
              cwd: path.join(repoRoot, "lib/db"),
              env: privateDatabaseEnvironment(databaseUrl),
            });
            await pool.query("SELECT setval('public.photo_aliases_id_seq', 77, true)");
            await pool.query("GRANT USAGE, SELECT ON SEQUENCE public.audit_logs_id_seq TO audit_maintenance");
            await pool.query(developmentRepairSql);
            await pool.query(developmentRepairSql);
            const permission = await pool.query(
              "SELECT has_sequence_privilege('audit_maintenance', 'public.audit_logs_id_seq', 'USAGE, SELECT') AS retained",
            );
            assert.equal(permission.rows[0].retained, true, "audit maintenance sequence grants survive repair");
          }
        } finally {
          await pool.end();
        }

        const firstRun = await run(
          "pnpm",
          ["--filter", packageName, "run", packageScript],
          { env: privateDatabaseEnvironment(databaseUrl) },
        );
        assertNoDrizzleError(firstRun, `${packageScript} conversion run`);

        const verificationPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
        try {
          await verifyIdentityColumns(verificationPool);
          await verifySeedRows(verificationPool);
        } finally {
          await verificationPool.end();
        }

        const secondRun = await run(
          "pnpm",
          ["--filter", packageName, "run", packageScript],
          { env: privateDatabaseEnvironment(databaseUrl) },
        );
        assertNoDrizzleError(secondRun, `${packageScript} second run`);

        const finalPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
        try {
          await verifySequencesRemainAdvanced(finalPool);
          const retainedRows = await finalPool.query(
            `SELECT
               (SELECT count(*)::int FROM public.audit_logs WHERE id IN (1006, 1008)) AS audit_rows,
               (SELECT count(*)::int FROM public.production_runs WHERE id IN (1036, 1038)) AS run_rows,
               (SELECT count(*)::int FROM public.operational_intent_ledger
                WHERE sequence IN (9001, 9003)) AS cursor_rows`,
          );
          assert.deepEqual(retainedRows.rows[0], {
            audit_rows: 2,
            run_rows: 2,
            cursor_rows: 2,
          });
        } finally {
          await finalPool.end();
        }
      }
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (adminPool) {
        for (const databaseName of [...createdDatabaseNames].reverse()) {
          try {
            await adminPool.query(
              `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
            );
          } catch (error) {
            cleanupError ??= error;
          }
        }
        if (!cleanupError && createdDatabaseNames.size > 0) {
          try {
            const remaining = await adminPool.query(
              "SELECT datname FROM pg_database WHERE datname = ANY($1::text[])",
              [[...createdDatabaseNames]],
            );
            assert.equal(
              remaining.rowCount,
              0,
              "all disposable database fixtures must be removed",
            );
          } catch (error) {
            cleanupError ??= error;
          }
        }
        try {
          await adminPool.end();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (clusterMayBeRunning) {
        const status = spawnSync(pgCtl, ["-D", dataDirectory, "status"], {
          encoding: "utf8",
        });
        if (status.status === 0) {
          const stopped = spawnSync(
            pgCtl,
            ["-D", dataDirectory, "-m", "immediate", "-w", "stop"],
            { encoding: "utf8", timeout: 20_000 },
          );
          if (stopped.status !== 0) {
            const message = `Could not stop the disposable PostgreSQL cluster; preserving ${tempDirectory}.`;
            if (primaryError) {
              console.error(message);
            } else {
              cleanupError ??= new Error(message);
            }
          }
        } else if (status.status !== 3) {
          const message = `Could not confirm disposable PostgreSQL shutdown; preserving ${tempDirectory}.`;
          if (primaryError) {
            console.error(message);
          } else {
            cleanupError ??= new Error(message);
          }
        }
      }

      if (clusterMayBeRunning) {
        const finalStatus = spawnSync(pgCtl, ["-D", dataDirectory, "status"], {
          encoding: "utf8",
        });
        if (finalStatus.status === 3) {
          try {
            await rm(tempDirectory, { recursive: true, force: false });
          } catch (error) {
            cleanupError ??= error;
          }
        } else if (!primaryError) {
          cleanupError ??= new Error(
            `Disposable PostgreSQL may still be running; preserving ${tempDirectory}.`,
          );
        }
      } else if (tempDirectory) {
        try {
          await rm(tempDirectory, { recursive: true, force: false });
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (cleanupError && !primaryError) {
        throw cleanupError;
      } else if (cleanupError) {
        console.error(`Disposable database cleanup also failed: ${cleanupError.message}`);
      }
    }
  },
);
