import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { backgroundOperationEventsTable, db, pool } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import {
  BACKGROUND_OPERATION_FAILURE_MAX_EVENTS,
  BACKGROUND_OPERATION_FAILURE_THRESHOLD,
  clearBackgroundOperationDiagnosticsForTests,
  getBackgroundOperationDiagnostics,
  recordBackgroundOperationFailure,
  runBackgroundOperation,
} from "./backgroundOperations";

const killer = new pg.Client({ connectionString: process.env.DATABASE_URL });

describe("background operation PostgreSQL reconnection", () => {
  beforeEach(async () => {
    await clearBackgroundOperationDiagnosticsForTests();
  });

  afterAll(async () => {
    await clearBackgroundOperationDiagnosticsForTests();
    await killer.end().catch(() => {});
  });

  it("retries a terminated client through a different pooled backend connection", async () => {
    await killer.connect();
    const doomed = await pool.connect();
    doomed.on("error", () => {});
    const first = await doomed.query<{ pid: number }>("select pg_backend_pid()::int as pid");
    const firstPid = first.rows[0]!.pid;
    await killer.query("select pg_terminate_backend($1)", [firstPid]);

    let attempt = 0;
    const recoveredPid = await runBackgroundOperation("server-job-prune", async () => {
      attempt += 1;
      if (attempt === 1) {
        await doomed.query("select 1");
        throw new Error("terminated client unexpectedly accepted a query");
      }
      const recovered = await pool.query<{ pid: number }>("select pg_backend_pid()::int as pid");
      return recovered.rows[0]!.pid;
    }, { delay: async () => {} });

    doomed.release(true);
    expect(attempt).toBe(2);
    expect(recoveredPid).not.toBe(firstPid);
  });

  it("keeps concurrent shared failure retention capped and visible after local state loss", async () => {
    await db.insert(backgroundOperationEventsTable).values(Array.from(
      { length: BACKGROUND_OPERATION_FAILURE_MAX_EVENTS },
      (_, index) => ({
        operation: "daily-rollover",
        errorCode: `SEED${index}`,
        occurredAt: new Date(Date.now() - index),
      }),
    ));
    await Promise.all(Array.from(
      { length: 10 },
      (_, index) => recordBackgroundOperationFailure(
        "daily-rollover",
        Object.assign(new Error("failed"), { code: `E${index}` }),
      ),
    ));

    await clearBackgroundOperationDiagnosticsForTests({ preserveShared: true });
    const [row] = await db
      .select({ value: count() })
      .from(backgroundOperationEventsTable)
      .where(eq(backgroundOperationEventsTable.operation, "daily-rollover"));
    expect(row?.value).toBe(BACKGROUND_OPERATION_FAILURE_MAX_EVENTS);
    expect((await getBackgroundOperationDiagnostics())["daily-rollover"]).toMatchObject({
      status: "warning",
      recentFailureCount: BACKGROUND_OPERATION_FAILURE_MAX_EVENTS,
    });
  });

  it("bounds shared lock waits and preserves local degradation when persistence times out", async () => {
    const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await locker.connect();
    await locker.query(
      "select pg_advisory_lock(hashtextextended($1, 0))",
      ["background-operation:web-push-schedule"],
    );
    try {
      const startedAt = performance.now();
      for (let index = 0; index < BACKGROUND_OPERATION_FAILURE_THRESHOLD; index += 1) {
        await recordBackgroundOperationFailure(
          "web-push-schedule",
          Object.assign(new Error("unavailable"), { code: "57P03" }),
        );
      }
      expect(performance.now() - startedAt).toBeLessThan(4_000);
      expect((await getBackgroundOperationDiagnostics())["web-push-schedule"]).toMatchObject({
        status: "warning",
        recentFailureCount: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      });
    } finally {
      await locker.query(
        "select pg_advisory_unlock(hashtextextended($1, 0))",
        ["background-operation:web-push-schedule"],
      ).catch(() => {});
      await locker.end();
    }
  });
});