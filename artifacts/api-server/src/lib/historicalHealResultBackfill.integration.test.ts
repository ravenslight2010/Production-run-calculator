// Real-Postgres regression coverage for the historical data-heal result
// annotation. The boot backfill must annotate only legacy NULL markers, retain
// already-recorded results verbatim, and remain marker-guarded on later boots.
//
// DATABASE_URL is redirected before importing @workspace/db because its pool
// binds when the module loads.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let dataHealsTable: DbModule["dataHealsTable"];
let runDataHeals: () => Promise<void>;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const BACKFILL_ID = "data-heal-result-backfill-v1";
const LEGACY_NULL_ID = "legacy-null-result";
const RECORDED_RESULT_ID = "recorded-result";
const LATE_NULL_ID = "late-null-result";

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set");

  adminPool = new pg.Pool({
    connectionString: originalDatabaseUrl,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 90_000,
  });
  adminPool.on("error", () => {});
  testDbName = `helium_heal_results_int_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  const push = spawnSync(
    "pnpm",
    ["--filter", "@workspace/db", "run", "push-force"],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: testUrlStr },
      encoding: "utf8",
      timeout: 90_000,
      killSignal: "SIGTERM",
    },
  );
  if (push.status !== 0) {
    const reason =
      (push.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ||
      push.signal
        ? "timed out after 90 seconds"
        : `exited with status ${push.status}`;
    throw new Error(
      `drizzle push-force ${reason}:\n${push.stdout}\n${push.stderr}`,
    );
  }

  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  db = dbMod.db;
  pool = dbMod.pool;
  dataHealsTable = dbMod.dataHealsTable;
  runDataHeals = (await import("./dataHeals")).runDataHeals;
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(
        `DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`,
      );
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

describe("historical data-heal result backfill", () => {
  it("annotates only legacy NULL results and claims its marker exactly once", async () => {
    const appliedAt = new Date("2026-08-01T12:00:00.000Z");
    const recordedResult = { scanned: 4, updated: 2 };
    await db.insert(dataHealsTable).values([
      { id: LEGACY_NULL_ID, appliedAt, result: null },
      { id: RECORDED_RESULT_ID, appliedAt, result: recordedResult },
    ]);

    await runDataHeals();

    const afterFirstBoot = await db.select().from(dataHealsTable);
    const legacy = afterFirstBoot.find((row) => row.id === LEGACY_NULL_ID);
    const recorded = afterFirstBoot.find(
      (row) => row.id === RECORDED_RESULT_ID,
    );
    const marker = afterFirstBoot.find((row) => row.id === BACKFILL_ID);

    expect(legacy?.result).toMatchObject({
      backfilled: true,
      approximate: true,
      method: "current rows updated within 10 minutes before applied_at",
      currentStateCounts: {
        brandProfiles: 0,
        cheeseRecipes: 0,
        mixes: 0,
        doughRecipes: 0,
        sauceRecipes: 0,
        dailySyncRows: 0,
      },
    });
    expect(recorded?.result).toEqual(recordedResult);
    expect(marker?.result).toMatchObject({ annotated: 1, bufferMinutes: 10 });
    const markerAppliedAt = marker?.appliedAt.getTime();

    // A newly visible NULL row is the strongest second-boot guard: if the
    // marker were claimed again, this row would be annotated too.
    await db.insert(dataHealsTable).values({
      id: LATE_NULL_ID,
      appliedAt: new Date("2026-08-02T12:00:00.000Z"),
      result: null,
    });
    await runDataHeals();

    const afterSecondBoot = await db.select().from(dataHealsTable);
    const markerRows = afterSecondBoot.filter((row) => row.id === BACKFILL_ID);
    expect(
      afterSecondBoot.find((row) => row.id === LEGACY_NULL_ID)?.result,
    ).toEqual(legacy?.result);
    expect(
      afterSecondBoot.find((row) => row.id === RECORDED_RESULT_ID)?.result,
    ).toEqual(recordedResult);
    expect(
      afterSecondBoot.find((row) => row.id === LATE_NULL_ID)?.result,
    ).toBeNull();
    expect(markerRows).toHaveLength(1);
    expect(markerRows[0]?.appliedAt.getTime()).toBe(markerAppliedAt);
  });
});
