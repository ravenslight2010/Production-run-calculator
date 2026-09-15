import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { runBackgroundOperation } from "./backgroundOperations";

const killer = new pg.Client({ connectionString: process.env.DATABASE_URL });

describe("background operation PostgreSQL reconnection", () => {
  afterAll(async () => {
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
});