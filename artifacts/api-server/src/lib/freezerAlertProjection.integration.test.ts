import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let dailySyncTable: DbModule["dailySyncTable"];
let freezerAlertProjectionStatusTable: DbModule["freezerAlertProjectionStatusTable"];
let freezerAlertRunProjectionTable: DbModule["freezerAlertRunProjectionTable"];
let replaceFreezerAlertProjection: typeof import("./freezerAlertProjection")["replaceFreezerAlertProjection"];
let deleteFreezerAlertProjection: typeof import("./freezerAlertProjection")["deleteFreezerAlertProjection"];
let backfillFreezerAlertProjection: typeof import("./freezerAlertProjection")["backfillFreezerAlertProjection"];
let readScheduledAlertSnapshotRows: typeof import("./webPush")["readScheduledAlertSnapshotRows"];
let freezerCandidates: typeof import("./webPush")["freezerCandidates"];
let pendingFreezerArms: typeof import("./webPush")["pendingFreezerArms"];

let adminPool: pg.Pool;
let testDbName = "";
let originalDatabaseUrl: string | undefined;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const NOW = Date.parse("2031-01-20T18:00:00.000Z");
const TODAY = "2031-01-20";

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_freezer_projection_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlString = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlString },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push-force failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlString;
  const dbMod = await import("@workspace/db");
  const projectionMod = await import("./freezerAlertProjection");
  const webPushMod = await import("./webPush");
  db = dbMod.db;
  dailySyncTable = dbMod.dailySyncTable;
  freezerAlertProjectionStatusTable = dbMod.freezerAlertProjectionStatusTable;
  freezerAlertRunProjectionTable = dbMod.freezerAlertRunProjectionTable;
  replaceFreezerAlertProjection = projectionMod.replaceFreezerAlertProjection;
  deleteFreezerAlertProjection = projectionMod.deleteFreezerAlertProjection;
  backfillFreezerAlertProjection = projectionMod.backfillFreezerAlertProjection;
  readScheduledAlertSnapshotRows = webPushMod.readScheduledAlertSnapshotRows;
  freezerCandidates = webPushMod.freezerCandidates;
  pendingFreezerArms = webPushMod.pendingFreezerArms;
}, 120_000);

afterAll(async () => {
  if (db) await db.$client.end();
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE ${freezerAlertProjectionStatusTable},
      ${freezerAlertRunProjectionTable},
      ${dailySyncTable}
    RESTART IDENTITY CASCADE
  `);
});

function snapshot(
  id: string,
  endedAt: number,
  freezerTime: number,
  startedAt = endedAt - 60_000,
) {
  return {
    dayState: { runs: [{ id, startedAt, endedAt }] },
    runValues: { [id]: { freezerTime } },
  };
}

async function writeSnapshot(scope: string, date: string, data: unknown): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(dailySyncTable).values({ scope, date, data: data as any });
    await replaceFreezerAlertProjection(tx, scope, date, data);
  });
}

describe("freezer alert run projection", () => {
  it("backfills old snapshots and selects pending/due milestones without unrelated history", async () => {
    const dueAt = NOW - 30 * 60_000;
    const pendingAt = NOW + 45 * 60_000;
    await writeSnapshot("live", "2031-01-16", snapshot("due", dueAt - 60_000, 1));
    await writeSnapshot("live", "2031-01-17", snapshot("pending", pendingAt - 60_000, 1));
    await writeSnapshot("live", "2031-01-18", snapshot("expired", NOW - 15 * 24 * 60 * 60_000 - 60_000, 1));
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: "2031-01-19",
      data: {
        dayState: { runs: [{ id: "active", startedAt: NOW - 20_000 }] },
        runValues: { active: { freezerTime: 2 } },
        marker: "preserve-full-active-snapshot",
      },
    });
    await db.insert(dailySyncTable).values({
      scope: "sandbox",
      date: "2031-01-16",
      data: snapshot("sandbox-due", dueAt - 60_000, 1),
    });

    await expect(backfillFreezerAlertProjection("live")).resolves.toMatchObject({
      examinedDays: 4,
      projectedRuns: 4,
    });
    await backfillFreezerAlertProjection("sandbox");

    const rows = await readScheduledAlertSnapshotRows("live", TODAY, NOW);
    expect(rows.map((row) => row.date)).toEqual(["2031-01-16", "2031-01-17", "2031-01-19"]);
    expect(freezerCandidates(rows[0]!.data, "2031-01-16", NOW)).toHaveLength(1);
    expect(pendingFreezerArms(rows[1]!.data, NOW)).toHaveLength(1);
    expect(rows[2]!.data).toMatchObject({ marker: "preserve-full-active-snapshot" });
    expect((await readScheduledAlertSnapshotRows("sandbox", TODAY, NOW)).map((row) => row.date))
      .toEqual(["2031-01-16"]);
  });

  it("replaces changed run generations and removes stale milestones transactionally", async () => {
    const date = "2031-01-19";
    const original = snapshot("reused-run", NOW - 60_000, 1, NOW - 120_000);
    await writeSnapshot("live", date, original);
    await backfillFreezerAlertProjection("live");

    const before = await readScheduledAlertSnapshotRows("live", TODAY, NOW);
    const beforeCandidate = freezerCandidates(before[0]!.data, date, NOW)[0]!;
    const changedGeneration = snapshot("reused-run", NOW - 60_000, 1, NOW - 90_000);
    await db.transaction(async (tx) => {
      await tx.update(dailySyncTable).set({ data: changedGeneration })
        .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, date)));
      await replaceFreezerAlertProjection(tx, "live", date, changedGeneration);
    });

    const after = await readScheduledAlertSnapshotRows("live", TODAY, NOW);
    const afterCandidate = freezerCandidates(after[0]!.data, date, NOW)[0]!;
    expect(afterCandidate.id).not.toBe(beforeCandidate.id);
    expect(await db.select().from(freezerAlertRunProjectionTable)).toHaveLength(1);

    const disabled = snapshot("reused-run", NOW - 60_000, 0, NOW - 90_000);
    await expect(db.transaction(async (tx) => {
      await tx.update(dailySyncTable).set({ data: disabled })
        .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, date)));
      await replaceFreezerAlertProjection(tx, "live", date, disabled);
      throw new Error("rollback projection and canonical snapshot together");
    })).rejects.toThrow("rollback projection");
    expect(await db.select().from(freezerAlertRunProjectionTable)).toHaveLength(1);

    await db.transaction(async (tx) => {
      await tx.update(dailySyncTable).set({ data: disabled })
        .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, date)));
      await replaceFreezerAlertProjection(tx, "live", date, disabled);
    });
    expect(await db.select().from(freezerAlertRunProjectionTable)).toHaveLength(0);
    expect(await readScheduledAlertSnapshotRows("live", TODAY, NOW)).toEqual([]);
  });

  it("keeps date moves, reset deletes, and scope isolation aligned", async () => {
    const originalDate = "2031-01-18";
    const movedDate = "2031-01-19";
    await writeSnapshot("live", originalDate, snapshot("move-me", NOW - 20_000, 1));
    await backfillFreezerAlertProjection("live");
    await db.transaction(async (tx) => {
      const [source] = await tx.select().from(dailySyncTable)
        .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, originalDate)));
      await deleteFreezerAlertProjection(tx, "live", originalDate);
      await tx.delete(dailySyncTable)
        .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, originalDate)));
      const moved = snapshot("move-me-new-id", NOW - 20_000, 1);
      await tx.insert(dailySyncTable).values({ scope: "live", date: movedDate, data: moved });
      await replaceFreezerAlertProjection(tx, "live", movedDate, moved);
      expect(source).toBeDefined();
    });
    expect(await db.select({ date: freezerAlertRunProjectionTable.date })
      .from(freezerAlertRunProjectionTable)).toEqual([{ date: movedDate }]);

    await writeSnapshot("sandbox", movedDate, snapshot("sandbox-only", NOW - 20_000, 1));
    await backfillFreezerAlertProjection("sandbox");
    expect((await readScheduledAlertSnapshotRows("live", TODAY, NOW)).map((row) => row.date))
      .toEqual([movedDate]);
    expect((await readScheduledAlertSnapshotRows("sandbox", TODAY, NOW)).map((row) => row.date))
      .toEqual([movedDate]);

    await db.delete(freezerAlertRunProjectionTable)
      .where(eq(freezerAlertRunProjectionTable.scope, "live"));
    await db.delete(dailySyncTable).where(eq(dailySyncTable.scope, "live"));
    expect(await db.select().from(freezerAlertRunProjectionTable)
      .where(eq(freezerAlertRunProjectionTable.scope, "live"))).toHaveLength(0);
    expect((await readScheduledAlertSnapshotRows("live", TODAY, NOW)).map((row) => row.date)).toEqual([]);
    expect((await readScheduledAlertSnapshotRows("sandbox", TODAY, NOW)).map((row) => row.date))
      .toEqual([movedDate]);
  });

  it("measures no-run and active-run reads across 97 and 512 historical snapshots", async () => {
    const padding = "x".repeat(34_700);
    const measurements: Array<Record<string, number | string>> = [];

    for (const rowCount of [97, 512]) {
      await db.execute(sql`
        TRUNCATE ${freezerAlertProjectionStatusTable},
          ${freezerAlertRunProjectionTable},
          ${dailySyncTable}
        RESTART IDENTITY CASCADE
      `);
      const values = Array.from({ length: rowCount }, (_, index) => {
        const date = new Date(Date.parse(`${TODAY}T00:00:00.000Z`) - (index + 1) * 86_400_000)
          .toISOString().slice(0, 10);
        return {
          scope: "live",
          date,
          data: { dayState: { runs: [] }, padding },
        };
      });
      await db.insert(dailySyncTable).values(values);

      const startedLegacyIdle = performance.now();
      const legacyIdle = await readScheduledAlertSnapshotRows("live", TODAY, NOW);
      const legacyIdleMs = performance.now() - startedLegacyIdle;
      const backfill = await backfillFreezerAlertProjection("live");
      const startedProjectedIdle = performance.now();
      const projectedIdle = await readScheduledAlertSnapshotRows("live", TODAY, NOW);
      const projectedIdleMs = performance.now() - startedProjectedIdle;

      const activeDate = values[0]!.date;
      const activeData = {
        dayState: { runs: [{ id: "active-history", startedAt: NOW - 60_000 }] },
        runValues: { "active-history": { freezerTime: 1 } },
        padding,
      };
      await db.transaction(async (tx) => {
        await tx.update(dailySyncTable).set({ data: activeData })
          .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, activeDate)));
        await replaceFreezerAlertProjection(tx, "live", activeDate, activeData);
      });
      await db.delete(freezerAlertProjectionStatusTable)
        .where(eq(freezerAlertProjectionStatusTable.scope, "live"));
      const startedLegacyActive = performance.now();
      const legacyActive = await readScheduledAlertSnapshotRows("live", TODAY, NOW);
      const legacyActiveMs = performance.now() - startedLegacyActive;
      await backfillFreezerAlertProjection("live");
      const startedProjectedActive = performance.now();
      const projectedActive = await readScheduledAlertSnapshotRows("live", TODAY, NOW);
      const projectedActiveMs = performance.now() - startedProjectedActive;

      expect(legacyIdle).toEqual(projectedIdle);
      expect(legacyActive.map((row) => row.date)).toEqual(projectedActive.map((row) => row.date));
      expect(projectedActive[0]!.data).toMatchObject({
        dayState: { runs: [{ id: "active-history" }] },
      });
      expect(backfill.examinedDays).toBe(rowCount);
      measurements.push({
        rows: rowCount,
        legacyIdleMs: Number(legacyIdleMs.toFixed(2)),
        projectedIdleMs: Number(projectedIdleMs.toFixed(2)),
        legacyActiveMs: Number(legacyActiveMs.toFixed(2)),
        projectedActiveMs: Number(projectedActiveMs.toFixed(2)),
      });
    }

    process.stderr.write(`freezer-alert-projection-benchmark ${JSON.stringify(measurements)}\n`);
  }, 180_000);
});
