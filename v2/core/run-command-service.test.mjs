import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createRunCommandService,
  RunCommandServiceError,
} from "./run-command-service.mjs";

const AUTH = {
  verified: true,
  facilityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

const COMMAND = {
  runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  commandId: "cmd-start-01",
  commandType: "start",
  expectedRevision: 0,
};

function createService({ queryResult, authorizeResult = true } = {}) {
  const calls = [];
  const authorizations = [];
  const service = createRunCommandService({
    query: async (text, values) => {
      calls.push({ text, values });
      return queryResult ?? {
        rows: [{
          result: {
            outcome: "accepted",
            replayed: false,
            run: { id: COMMAND.runId, status: "running", revision: 1 },
          },
        }],
      };
    },
    authorize: async (context) => {
      authorizations.push(context);
      return authorizeResult;
    },
  });
  return { service, calls, authorizations };
}

test("uses verified server identity and a parameterized database command", async () => {
  const { service, calls, authorizations } = createService();
  const result = await service.execute({ auth: AUTH, command: COMMAND });

  assert.equal(result.outcome, "accepted");
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /v2\.apply_run_lifecycle_command/);
  assert.match(calls[0].text, /\$1::uuid/);
  assert.equal(calls[0].text.includes(COMMAND.runId), false);
  assert.deepEqual(calls[0].values.slice(0, 4), [
    AUTH.facilityId,
    COMMAND.runId,
    AUTH.actorId,
    COMMAND.commandId,
  ]);
  assert.equal(
    calls[0].values[4],
    createHash("sha256")
      .update(JSON.stringify({
        facilityId: AUTH.facilityId,
        actorId: AUTH.actorId,
        runId: COMMAND.runId,
        commandId: COMMAND.commandId,
        commandType: COMMAND.commandType,
        expectedRevision: COMMAND.expectedRevision,
      }))
      .digest("hex"),
  );
  assert.deepEqual(authorizations, [{
    auth: AUTH,
    action: "run.lifecycle.command",
    commandType: "start",
  }]);
});

test("normalizes UUID casing before hashing and database use", async () => {
  const { service, calls } = createService();
  await service.execute({
    auth: {
      ...AUTH,
      facilityId: AUTH.facilityId.toUpperCase(),
      actorId: AUTH.actorId.toUpperCase(),
    },
    command: { ...COMMAND, runId: COMMAND.runId.toUpperCase() },
  });

  assert.deepEqual(calls[0].values.slice(0, 3), [
    AUTH.facilityId,
    COMMAND.runId,
    AUTH.actorId,
  ]);
});

test("rejects missing verified identity before authorization or database access", async () => {
  const { service, calls, authorizations } = createService();
  await assert.rejects(
    service.execute({ auth: { ...AUTH, verified: false }, command: COMMAND }),
    (error) => error instanceof RunCommandServiceError
      && error.code === "UNAUTHENTICATED"
      && error.status === 401,
  );
  assert.equal(authorizations.length, 0);
  assert.equal(calls.length, 0);
});

test("fails closed when the server policy denies the command", async () => {
  const { service, calls, authorizations } = createService({ authorizeResult: false });
  await assert.rejects(
    service.execute({ auth: AUTH, command: COMMAND }),
    (error) => error instanceof RunCommandServiceError
      && error.code === "FORBIDDEN"
      && error.status === 403,
  );
  assert.equal(authorizations.length, 1);
  assert.equal(calls.length, 0);
});

test("rejects client-supplied actor, facility, and other unsupported fields", async () => {
  const { service, calls } = createService();
  await assert.rejects(
    service.execute({
      auth: AUTH,
      command: { ...COMMAND, facilityId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    }),
    (error) => error.code === "INVALID_COMMAND" && error.status === 400,
  );
  assert.equal(calls.length, 0);
});

test("validates command identity, type, and revision", async (t) => {
  const { service, calls } = createService();
  const invalidCommands = [
    { ...COMMAND, commandId: " cmd-start-01" },
    { ...COMMAND, commandId: "" },
    { ...COMMAND, commandType: "delete" },
    { ...COMMAND, expectedRevision: -1 },
    { ...COMMAND, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...COMMAND, runId: "not-a-uuid" },
    { runId: COMMAND.runId, commandId: COMMAND.commandId, commandType: "start" },
  ];

  for (const [index, command] of invalidCommands.entries()) {
    await t.test(`invalid command ${index + 1}`, async () => {
      await assert.rejects(
        service.execute({ auth: AUTH, command }),
        (error) => error.code === "INVALID_COMMAND" && error.status === 400,
      );
    });
  }
  assert.equal(calls.length, 0);
});

test("returns canonical conflict and invalid-transition outcomes unchanged", async () => {
  for (const outcome of ["conflict", "invalid_transition"]) {
    const value = { outcome, currentRun: { revision: 2, status: "running" } };
    const { service } = createService({ queryResult: { rows: [{ result: value }] } });
    assert.deepEqual(await service.execute({ auth: AUTH, command: COMMAND }), value);
  }
});

test("rejects an unexpected database result instead of silently accepting it", async () => {
  const { service } = createService({ queryResult: { rows: [{ result: { ok: true } }] } });
  await assert.rejects(
    service.execute({ auth: AUTH, command: COMMAND }),
    (error) => error.code === "INVALID_STORAGE_RESPONSE" && error.status === 502,
  );
});
