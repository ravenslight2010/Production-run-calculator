import test from "node:test";
import assert from "node:assert/strict";
import { createStationCommandService } from "./station-command-service.mjs";

const AUTH = {
  verified: true,
  facilityId: "10000000-0000-4000-8000-000000000001",
  actorId: "10000000-0000-4000-8000-000000000002",
};
const BASE = {
  runId: "20000000-0000-4000-8000-000000000001",
  commandId: "30000000-0000-4000-8000-000000000001",
  expectedRevision: 4,
  stationKey: "packaging",
  mode: "manual",
  changes: { casesPacked: 8 },
};

test("validates station commands, hashes normalized input, and uses server identity", async () => {
  const calls = [];
  const service = createStationCommandService({
    authorize: async (input) => input.action === "station.command",
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ result: { outcome: "accepted", run: { id: BASE.runId } } }] };
    },
  });
  const result = await service.execute({ auth: AUTH, command: BASE });
  assert.equal(result.outcome, "accepted");
  assert.match(calls[0].sql, /apply_station_command/);
  assert.equal(calls[0].params[0], AUTH.facilityId);
  assert.equal(calls[0].params[1], BASE.runId);
  assert.equal(calls[0].params[2], AUTH.actorId);
  assert.equal(calls[0].params[6], "packaging");
  assert.equal(calls[0].params[7], "manual");
  assert.deepEqual(JSON.parse(calls[0].params[9]), { casesPacked: 8 });
  assert.equal(calls[0].params[10], "casesPacked");
});

test("rejects unsupported fields and mismatched station modes before database access", async () => {
  let calls = 0;
  const service = createStationCommandService({
    authorize: async () => true,
    query: async () => { calls += 1; return { rows: [] }; },
  });
  await assert.rejects(
    service.execute({ auth: AUTH, command: { ...BASE, changes: { casesCompleted: 8 } } }),
    /not used by the Packaging station/,
  );
  await assert.rejects(
    service.execute({ auth: AUTH, command: { ...BASE, mode: "auto_track", changes: { casesPacked: 8 } } }),
    /does not accept client-supplied progress/,
  );
  assert.equal(calls, 0);
});

test("enforces station permission and requires verified facility and actor identity", async () => {
  const service = createStationCommandService({
    authorize: async () => false,
    query: async () => assert.fail("unauthorized command must not reach storage"),
  });
  await assert.rejects(
    service.execute({ auth: AUTH, command: BASE }),
    (error) => error.status === 403,
  );
  await assert.rejects(
    service.execute({ auth: { verified: true }, command: BASE }),
    (error) => error.status === 401,
  );
});

test("preserves stale revision conflicts as canonical outcomes", async () => {
  const canonical = { id: BASE.runId, revision: 5, stationProgress: {} };
  const service = createStationCommandService({
    authorize: async () => true,
    query: async () => ({ rows: [{ result: { outcome: "conflict", currentRun: canonical } }] }),
  });
  const result = await service.execute({ auth: AUTH, command: BASE });
  assert.equal(result.outcome, "conflict");
  assert.equal(result.currentRun.revision, 5);
});
