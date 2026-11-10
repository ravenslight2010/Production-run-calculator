import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createRunApi, createRunApiForDatabase } from "./run-api.mjs";

const RUN_ID = "00000000-0000-4000-8000-000000000004";
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
  setupSnapshot: { label: "Run A", targetCases: 12 },
  pauseIntervals: [],
};
const AUTH = { verified: true, facilityId: "00000000-0000-4000-8000-000000000001", actorId: "00000000-0000-4000-8000-000000000002" };

async function listenHandler(t, handler, calls = []) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

async function withApi(t, overrides = {}, options = {}) {
  const calls = [];
  const runs = {
    list: async (input) => {
      calls.push(["list", input]);
      return [RUN];
    },
    get: async (input) => {
      calls.push(["get", input]);
      return input.runId === RUN_ID ? RUN : null;
    },
    create: async (input) => {
      calls.push(["create", input]);
      const replayed = input.requestId === "00000000-0000-4000-8000-000000000099";
      return { outcome: "created", replayed, run: { ...RUN, setupSnapshot: input.setupSnapshot } };
    },
  };
  const commands = {
    execute: async (input) => {
      calls.push(["command", input]);
      return input.command.commandType === "start"
        ? { outcome: "accepted", replayed: false, commandId: input.command.commandId, run: { ...RUN, status: "running", revision: 1 } }
        : { outcome: "conflict", expectedRevision: 0, currentRun: { ...RUN, status: "running", revision: 1 } };
    },
  };
  const handler = createRunApi({
    runs: { ...runs, ...overrides.runs },
    commands: { ...commands, ...overrides.commands },
    authenticate: overrides.authenticate ?? (async () => AUTH),
    verifyCsrf: overrides.verifyCsrf ?? (async (request, auth) => auth === AUTH && request.headers["x-csrf-token"] === "ok"),
    maxBodyBytes: options.maxBodyBytes ?? 16 * 1024,
  });
  return listenHandler(t, handler, calls);
}

async function send(baseUrl, path, { method = "GET", body, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", "x-csrf-token": "ok", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("serves facility-scoped list and detail reads with no-store JSON responses", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const listResponse = await send(baseUrl, "/api/v2/runs?limit=25");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("cache-control"), "no-store");
  assert.match(listResponse.headers.get("content-type"), /application\/json/);
  assert.deepEqual((await listResponse.json()).runs, [RUN]);
  assert.deepEqual(calls[0], ["list", { auth: AUTH, limit: 25 }]);

  const detailResponse = await send(baseUrl, `/api/v2/runs/${RUN_ID}`);
  assert.equal(detailResponse.status, 200);
  assert.deepEqual((await detailResponse.json()).run, RUN);
  assert.deepEqual(calls[1], ["get", { auth: AUTH, runId: RUN_ID }]);
});

test("creates runs with server authorization and returns replay status", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const input = {
    requestId: "00000000-0000-4000-8000-000000000005",
    setupSnapshot: { label: "Night shift", targetCases: 48 },
  };
  const created = await send(baseUrl, "/api/v2/runs", { method: "POST", body: input });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { outcome: "created", replayed: false, run: { ...RUN, setupSnapshot: input.setupSnapshot } });
  assert.equal(calls[0][0], "create");
  assert.deepEqual(calls[0][1], { auth: AUTH, ...input });

  const replay = await send(baseUrl, "/api/v2/runs", {
    method: "POST",
    body: { ...input, requestId: "00000000-0000-4000-8000-000000000099" },
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
});

test("returns accepted lifecycle commands and preserves conflicts as 409 outcomes", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const accepted = await send(baseUrl, `/api/v2/runs/${RUN_ID}/commands`, {
    method: "POST",
    body: { commandId: "start-once", commandType: "start", expectedRevision: 0 },
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).outcome, "accepted");
  assert.deepEqual(calls[0][1].command, {
    commandId: "start-once",
    commandType: "start",
    expectedRevision: 0,
    runId: RUN_ID,
  });

  const conflict = await send(baseUrl, `/api/v2/runs/${RUN_ID}/commands`, {
    method: "POST",
    body: { commandId: "pause-once", commandType: "pause", expectedRevision: 0 },
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).outcome, "conflict");
});

test("rejects unauthenticated requests and mutations without CSRF verification", async (t) => {
  const noAuth = await withApi(t, { authenticate: async () => null });
  const unauthenticated = await send(noAuth.baseUrl, "/api/v2/runs");
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "Sign in to access runs." });

  const csrfDenied = await withApi(t, { verifyCsrf: async () => false });
  const response = await send(csrfDenied.baseUrl, "/api/v2/runs", {
    method: "POST",
    body: { requestId: "00000000-0000-4000-8000-000000000005", setupSnapshot: { label: "Run", targetCases: 1 } },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Refresh your session before changing run state." });
});

test("bounds request bodies and validates query, content type, and JSON shape", async (t) => {
  const smallLimit = await withApi(t, {}, { maxBodyBytes: 8 });
  const tooLarge = await send(smallLimit.baseUrl, "/api/v2/runs", {
    method: "POST",
    body: { requestId: "1234567890" },
  });
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { error: "The request is too large." });

  const { baseUrl } = await withApi(t);
  assert.equal((await send(baseUrl, "/api/v2/runs?limit=101")).status, 400);
  assert.equal((await send(baseUrl, "/api/v2/runs?unexpected=x")).status, 400);
  const noContentType = await fetch(`${baseUrl}/api/v2/runs`, {
    method: "POST",
    headers: { "x-csrf-token": "ok" },
    body: "{}",
  });
  assert.equal(noContentType.status, 415);
  const malformed = await fetch(`${baseUrl}/api/v2/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "ok" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
});

test("uses safe JSON errors for missing runs and unexpected service failures", async (t) => {
  const missing = await withApi(t, { runs: { get: async () => null } });
  const missingResponse = await send(missing.baseUrl, `/api/v2/runs/${RUN_ID}`);
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "Run not found." });

  const failing = await withApi(t, { runs: { list: async () => { throw new Error("database password leaked"); } } });
  const failureResponse = await send(failing.baseUrl, "/api/v2/runs");
  assert.equal(failureResponse.status, 500);
  assert.deepEqual(await failureResponse.json(), { error: "The run request could not be completed. Refresh and try again." });
});

test("composes the HTTP API with server services and a parameterized PostgreSQL pool", async (t) => {
  const queries = [];
  const authorizations = [];
  const handler = createRunApiForDatabase({
    pool: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("v2.list_runs")) return { rows: [{ result: [RUN] }] };
        if (sql.includes("v2.create_planned_run")) {
          const setupSnapshot = JSON.parse(params[4]);
          return { rows: [{ result: { outcome: "created", replayed: false, run: { ...RUN, setupSnapshot } } }] };
        }
        if (sql.includes("v2.apply_run_lifecycle_command")) {
          return {
            rows: [{
              result: {
                outcome: "accepted",
                replayed: false,
                commandId: "start-from-db",
                run: { ...RUN, status: "running", revision: 1 },
              },
            }],
          };
        }
        throw new Error("Unexpected query");
      },
    },
    authorize: async ({ auth, action, commandType }) => {
      authorizations.push({ auth, action, commandType });
      return true;
    },
    authenticate: async () => AUTH,
    verifyCsrf: async (request, auth) => auth === AUTH && request.headers["x-csrf-token"] === "ok",
  });
  const { baseUrl } = await listenHandler(t, handler);

  const listResponse = await send(baseUrl, "/api/v2/runs");
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json()).runs, [RUN]);

  const createResponse = await send(baseUrl, "/api/v2/runs", {
    method: "POST",
    body: {
      requestId: "00000000-0000-4000-8000-000000000005",
      setupSnapshot: { label: "Integrated run", targetCases: 24 },
    },
  });
  assert.equal(createResponse.status, 201);

  const commandResponse = await send(baseUrl, `/api/v2/runs/${RUN_ID}/commands`, {
    method: "POST",
    body: { commandId: "start-integrated", commandType: "start", expectedRevision: 0 },
  });
  assert.equal(commandResponse.status, 200);
  assert.equal((await commandResponse.json()).run.status, "running");

  assert.equal(queries.length, 3);
  assert.ok(queries.every(({ sql, params }) => sql.includes("$1") && Array.isArray(params)));
  assert.deepEqual(authorizations.map(({ action }) => action), ["run.read", "run.create", "run.lifecycle.command"]);
  assert.equal(authorizations[2].commandType, "start");
  assert.ok(authorizations.every(({ auth }) => auth === AUTH));
});
