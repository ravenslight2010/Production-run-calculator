import assert from "node:assert/strict";
import test from "node:test";
import { createStationAutoTrackWorker } from "./station-auto-track-worker.mjs";

const LEASE_ID_A = "81000000-0000-4000-8000-000000000001";
const LEASE_ID_B = "81000000-0000-4000-8000-000000000002";
const FACILITY_ID = "82000000-0000-4000-8000-000000000001";
const RUN_ID = "83000000-0000-4000-8000-000000000001";

function createFakeDatabase() {
  const state = {
    lease: { ownerId: null, generation: 0, expiresAt: 0 },
    runStatus: "running",
    revision: 3,
    due: true,
    commands: [],
    failDueOnce: false,
  };
  const query = async (sql, values = []) => {
    if (sql.includes("claim_worker_lease")) {
      const [, ownerId, leaseSeconds] = values;
      if (state.lease.ownerId && state.lease.expiresAt > Date.now()) {
        return { rows: [{ generation: null }] };
      }
      state.lease = {
        ownerId,
        generation: state.lease.generation + 1,
        expiresAt: Date.now() + leaseSeconds * 1000,
      };
      return { rows: [{ generation: state.lease.generation }] };
    }
    if (sql.includes("heartbeat_worker_lease")) {
      const [, ownerId, generation, leaseSeconds] = values;
      const renewed = state.lease.ownerId === ownerId
        && state.lease.generation === Number(generation)
        && state.lease.expiresAt > Date.now();
      if (renewed) state.lease.expiresAt = Date.now() + leaseSeconds * 1000;
      return { rows: [{ renewed }] };
    }
    if (sql.includes("release_worker_lease")) {
      const [, ownerId, generation] = values;
      const released = state.lease.ownerId === ownerId
        && state.lease.generation === Number(generation);
      if (released) {
        state.lease.ownerId = null;
        state.lease.expiresAt = 0;
      }
      return { rows: [{ released }] };
    }
    if (sql.includes("list_due_station_auto_track")) {
      if (state.failDueOnce) {
        state.failDueOnce = false;
        throw Object.assign(new Error("database unavailable"), { name: "ConnectionError" });
      }
      return {
        rows: state.runStatus === "running" && state.due
          ? [{
            facilityId: FACILITY_ID,
            runId: RUN_ID,
            expectedRevision: String(state.revision),
            stationKey: "line",
          }]
          : [],
      };
    }
    if (sql.includes("apply_station_command")) {
      const [, runId, , commandId, , expectedRevision, stationKey] = values;
      assert.equal(runId, RUN_ID);
      state.commands.push({ commandId, expectedRevision, stationKey });
      if (state.runStatus !== "running") {
        return { rows: [{ result: { outcome: "invalid_transition" } }] };
      }
      if (state.revision !== Number(expectedRevision)) {
        return { rows: [{ result: { outcome: "conflict" } }] };
      }
      state.revision += 1;
      state.due = false;
      return { rows: [{ result: { outcome: "accepted" } }] };
    }
    assert.fail(`Unexpected SQL: ${sql}`);
  };
  return { state, query };
}

function workerFor(query, ownerId, options = {}) {
  return createStationAutoTrackWorker({
    query,
    ownerId,
    pollIntervalMs: 10,
    leaseSeconds: 10,
    ...options,
  });
}

async function until(assertion, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(assertion(), "expected worker state was not reached");
}

test("two competing workers cannot tick the same due station", async () => {
  const db = createFakeDatabase();
  const first = workerFor(db.query, LEASE_ID_A);
  const second = workerFor(db.query, LEASE_ID_B);

  const results = await Promise.all([first.runOnce(), second.runOnce()]);

  assert.equal(db.state.commands.length, 1);
  assert.equal(results.filter((result) => result.processed === 1).length, 1);
  assert.equal(db.state.revision, 4);
  await Promise.all([first.stop(), second.stop()]);
});

test("paused runs are skipped and due work advances without a browser session", async () => {
  const db = createFakeDatabase();
  db.state.runStatus = "paused";
  const worker = workerFor(db.query, LEASE_ID_A);

  await worker.runOnce();
  assert.equal(db.state.commands.length, 0);

  db.state.runStatus = "running";
  worker.start();
  await until(() => worker.getHealth().processedLastCycle === 1);
  await worker.stop();
  assert.equal(db.state.commands.length, 1);
  assert.equal(db.state.revision, 4);
});

test("a restarted worker resumes from persisted station state without replaying a completed tick", async () => {
  const db = createFakeDatabase();
  const first = workerFor(db.query, LEASE_ID_A);
  await first.runOnce();
  await first.stop();
  assert.equal(db.state.commands.length, 1);
  assert.equal(db.state.due, false);

  const restarted = workerFor(db.query, LEASE_ID_B);
  const idleResult = await restarted.runOnce();
  assert.equal(idleResult.processed, 0);
  assert.equal(db.state.commands.length, 1);

  db.state.due = true;
  const resumedResult = await restarted.runOnce();
  assert.equal(resumedResult.processed, 1);
  assert.equal(db.state.commands.length, 2);
  assert.equal(db.state.commands[1].expectedRevision, 4);
  await restarted.stop();
});

test("stale lease generations are fenced after another worker takes over", async () => {
  const db = createFakeDatabase();
  const oldWorker = workerFor(db.query, LEASE_ID_A);
  const newWorker = workerFor(db.query, LEASE_ID_B);

  await oldWorker.runOnce();
  db.state.due = true;
  db.state.lease.expiresAt = Date.now() - 1;
  const takeover = await newWorker.runOnce();
  const staleAttempt = await oldWorker.runOnce();

  assert.equal(takeover.processed, 1);
  assert.equal(staleAttempt.status, "standby");
  assert.equal(db.state.lease.ownerId, LEASE_ID_B);
  assert.equal(db.state.lease.generation, 2);
  assert.equal(db.state.commands.length, 2);
  await Promise.all([oldWorker.stop(), newWorker.stop()]);
});

test("worker failures are visible, retried, and clear after a successful cycle", async () => {
  const db = createFakeDatabase();
  db.state.failDueOnce = true;
  const worker = workerFor(db.query, LEASE_ID_A);

  const failed = await worker.runOnce();
  assert.equal(failed.status, "degraded");
  assert.equal(worker.getHealth().consecutiveFailures, 1);
  assert.equal(worker.getHealth().lastErrorName, "ConnectionError");

  const recovered = await worker.runOnce();
  assert.equal(recovered.processed, 1);
  assert.equal(worker.getHealth().status, "active");
  assert.equal(worker.getHealth().consecutiveFailures, 0);
  assert.equal(worker.getHealth().lastErrorName, null);
  await worker.stop();
});
