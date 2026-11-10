import assert from "node:assert/strict";
import test from "node:test";
import { createRunService, RunServiceError } from "./run-service.mjs";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const REQUEST_ID = "00000000-0000-4000-8000-000000000003";
const RUN_ID = "00000000-0000-4000-8000-000000000004";
const AUTH = { verified: true, facilityId: FACILITY_ID, actorId: ACTOR_ID };
const SETUP = { label: "Line A / five cheese", targetCases: 105 };
const RUN = {
  id: RUN_ID,
  status: "planned",
  revision: 0,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  startedAt: null,
  pausedAt: null,
  resumedAt: null,
  completedAt: null,
  setupSnapshot: SETUP,
  pauseIntervals: [],
};

function makeService({ query, authorize = async () => true } = {}) {
  return createRunService({
    query: query ?? (async () => ({ rows: [{ result: null }] })),
    authorize,
  });
}

test("creates a server-owned run using verified identity and a canonical idempotency hash", async () => {
  let call;
  const service = makeService({
    query: async (sql, params) => {
      call = { sql, params };
      return { rows: [{ result: { outcome: "created", replayed: false, run: RUN } }] };
    },
  });

  const result = await service.create({ auth: AUTH, requestId: REQUEST_ID, setupSnapshot: SETUP });

  assert.equal(result.outcome, "created");
  assert.equal(result.run.id, RUN_ID);
  assert.match(call.sql, /v2\.create_planned_run/);
  assert.deepEqual(call.params.slice(0, 3), [FACILITY_ID, ACTOR_ID, REQUEST_ID]);
  assert.match(call.params[3], /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(call.params[4]), SETUP);
});

test("trims a run label before hashing and persistence", async () => {
  let storedSetup;
  const service = makeService({
    query: async (_sql, params) => {
      storedSetup = JSON.parse(params[4]);
      return {
        rows: [{
          result: {
            outcome: "created",
            replayed: false,
            run: { ...RUN, setupSnapshot: storedSetup },
          },
        }],
      };
    },
  });

  const result = await service.create({
    auth: AUTH,
    requestId: REQUEST_ID,
    setupSnapshot: { label: "  Morning run  ", targetCases: 12 },
  });

  assert.deepEqual(storedSetup, { label: "Morning run", targetCases: 12 });
  assert.equal(result.run.setupSnapshot.label, "Morning run");
});

test("rejects unsupported setup fields and invalid values before database work", async () => {
  let queryCount = 0;
  const service = makeService({
    query: async () => {
      queryCount += 1;
      return { rows: [{ result: null }] };
    },
  });

  const invalidSetups = [
    null,
    { label: "Run", targetCases: 1, facilityId: FACILITY_ID },
    { label: " ", targetCases: 1 },
    { label: "x".repeat(121), targetCases: 1 },
    { label: "Run", targetCases: 0 },
    { label: "Run", targetCases: 1.5 },
    { label: "Run", targetCases: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const setupSnapshot of invalidSetups) {
    await assert.rejects(
      service.create({ auth: AUTH, requestId: REQUEST_ID, setupSnapshot }),
      (error) => error instanceof RunServiceError && error.status === 400,
    );
  }
  assert.equal(queryCount, 0);
});

test("rejects invalid request IDs, missing verified identity, and denied authorization", async () => {
  let queryCount = 0;
  const service = makeService({
    query: async () => {
      queryCount += 1;
      return { rows: [{ result: { outcome: "created", replayed: false, run: RUN } }] };
    },
    authorize: async () => false,
  });

  await assert.rejects(
    service.create({ auth: AUTH, requestId: "not-a-uuid", setupSnapshot: SETUP }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    service.create({ auth: { facilityId: FACILITY_ID, actorId: ACTOR_ID }, requestId: REQUEST_ID, setupSnapshot: SETUP }),
    (error) => error.status === 401,
  );
  await assert.rejects(
    service.create({ auth: AUTH, requestId: REQUEST_ID, setupSnapshot: SETUP }),
    (error) => error.status === 403,
  );
  assert.equal(queryCount, 0);
});

test("returns idempotent creation replay and maps reused request IDs to conflict", async () => {
  const service = makeService({
    query: async () => ({ rows: [{ result: { outcome: "created", replayed: true, run: RUN } }] }),
  });
  const result = await service.create({ auth: AUTH, requestId: REQUEST_ID, setupSnapshot: SETUP });
  assert.equal(result.replayed, true);

  const conflict = makeService({
    query: async () => {
      const error = new Error("sensitive database detail");
      error.code = "22023";
      throw error;
    },
  });
  await assert.rejects(
    conflict.create({ auth: AUTH, requestId: REQUEST_ID, setupSnapshot: SETUP }),
    (error) => error.status === 409 && !error.message.includes("sensitive"),
  );
});

test("reads runs only in the authenticated facility scope and enforces bounded list limits", async () => {
  const calls = [];
  const service = makeService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("v2.get_run")) return { rows: [{ result: RUN }] };
      return { rows: [{ result: [RUN] }] };
    },
  });

  assert.deepEqual(await service.get({ auth: AUTH, runId: RUN_ID }), RUN);
  assert.deepEqual(await service.list({ auth: AUTH, limit: 25 }), [RUN]);
  assert.deepEqual(calls[0].params, [FACILITY_ID, RUN_ID]);
  assert.deepEqual(calls[1].params, [FACILITY_ID, 25]);
  assert.match(calls[0].sql, /v2\.get_run/);
  assert.match(calls[1].sql, /v2\.list_runs/);

  await assert.rejects(service.list({ auth: AUTH, limit: 101 }), (error) => error.status === 400);
  assert.equal(calls.length, 2);
});

test("fails explicitly on malformed canonical storage results", async () => {
  const service = makeService({
    query: async () => ({ rows: [{ result: { ...RUN, createdAt: "2026-11-10T12:00:00+00:00" } }] }),
  });
  await assert.rejects(
    service.get({ auth: AUTH, runId: RUN_ID }),
    (error) => error.status === 502 && error.code === "INVALID_STORAGE_RESPONSE",
  );
});
