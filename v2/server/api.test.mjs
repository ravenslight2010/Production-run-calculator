import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createV2Api } from "./api.mjs";

function fakeAuthAdapter({ session = null } = {}) {
  return {
    async authenticate() {
      return session;
    },
    async verifyCsrf() {
      return false;
    },
    async authorizeRun() {
      return false;
    },
    async signIn() {
      throw new Error("not used");
    },
    async signOut() {},
    async bootstrapAvailable() {
      return false;
    },
    async bootstrapManager() {
      throw new Error("not used");
    },
    async listStaff() {
      return { staff: [], roles: [] };
    },
    async createStaffAccount() {
      throw new Error("not used");
    },
    async updateStaffAccount() {
      throw new Error("not used");
    },
    sessionCookie() {
      return "v2_session=test";
    },
    csrfCookie() {
      return "v2_csrf=test";
    },
    clearSessionCookie() {
      return "v2_session=; Max-Age=0";
    },
    clearCsrfCookie() {
      return "v2_csrf=; Max-Age=0";
    },
  };
}

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint performs a bounded database probe and emits request identity", async () => {
  const queries = [];
  const logs = [];
  const handler = createV2Api({
    pool: { async query(query) { queries.push(query); return { rows: [{ "?column?": 1 }] }; } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: (entry) => logs.push(entry),
    healthTimeoutMs: 1200,
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.deepEqual(queries, [{ text: "SELECT 1", query_timeout: 1200 }]);
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "v2.http.request");
  assert.equal(logs[0].route, "health");
  assert.equal(logs[0].status, 200);
  assert.equal("url" in logs[0], false);
});

test("health endpoint reports a healthy station worker without leaking worker identifiers", async () => {
  const workerHealth = {
    status: "active",
    lastCycleAt: "2026-11-16T12:00:00.000Z",
    lastSuccessAt: "2026-11-16T11:59:00.000Z",
    consecutiveFailures: 0,
    lastErrorName: null,
    processedLastCycle: 2,
  };
  const handler = createV2Api({
    pool: { async query() { return { rows: [{ "?column?": 1 }] }; } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: () => {},
    workerHealth: () => workerHealth,
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", stationWorker: workerHealth });
    assert.doesNotMatch(response.headers.get("cache-control"), /public/i);
  });
});

test("health endpoint is not ready when the external worker is degraded or unreachable", async () => {
  for (const workerHealth of [
    { status: "degraded" },
    null,
  ]) {
    const handler = createV2Api({
      pool: { async query() { return { rows: [{ "?column?": 1 }] }; } },
      authAdapter: fakeAuthAdapter(),
      getClientKey: () => "test-client",
      logger: () => {},
      workerHealth: async () => workerHealth,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/healthz`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "The service is temporarily unavailable." });
    });
  }
});

test("serves the V2 sign-in page and local assets with restrictive browser headers", async () => {
  const handler = createV2Api({
    pool: { async query() { throw new Error("static requests should not query the database"); } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: () => {},
  });

  await withServer(handler, async (baseUrl) => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.match(await page.text(), /Sign in to the floor/);

    const favicon = await fetch(`${baseUrl}/favicon.ico`);
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get("content-type"), /image\/svg\+xml/);

    const versionedShell = await fetch(`${baseUrl}/v2/web/app-shell.html`);
    assert.equal(versionedShell.status, 200);
    assert.match(await versionedShell.text(), /Sign in to the floor/);

    const versionedManifest = await fetch(`${baseUrl}/v2/web/manifest.webmanifest`);
    assert.equal(versionedManifest.status, 200);
    assert.match(await versionedManifest.text(), /Fieldline Production Floor/);

    const versionedFavicon = await fetch(`${baseUrl}/v2/web/favicon.svg`);
    assert.equal(versionedFavicon.status, 200);
    assert.match(versionedFavicon.headers.get("content-type"), /image\/svg\+xml/);

    const appScript = await fetch(`${baseUrl}/v2/web/app.js`);
    assert.equal(appScript.status, 200);
    assert.match(appScript.headers.get("content-type"), /javascript/);
    assert.match(await appScript.text(), /\/api\/v2\/auth/);

    const writeGate = await fetch(`${baseUrl}/v2/web/write-gate.mjs`);
    assert.equal(writeGate.status, 200);
    assert.match(await writeGate.text(), /canWriteRunState/);

    const csvTemplates = await fetch(`${baseUrl}/v2/core/import-csv-templates.mjs`);
    assert.equal(csvTemplates.status, 200);
    assert.match(csvTemplates.headers.get("content-type"), /javascript/);
    assert.match(await csvTemplates.text(), /openingCountCsvTemplate/);

    const styles = await fetch(`${baseUrl}/v2/web/styles.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get("content-type"), /text\/css/);
  });
});

test("database outage fails health checks without leaking database errors", async () => {
  const logs = [];
  const handler = createV2Api({
    pool: { async query() { throw Object.assign(new Error("secret connection detail"), { name: "ConnectionError" }); } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: (entry) => logs.push(entry),
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "The service is temporarily unavailable." });
    assert.doesNotMatch(JSON.stringify(logs), /secret connection detail/);
  });
});

test("session route is composed before run routes and returns authorization state", async () => {
  const session = {
    verified: true,
    actorId: "10000000-0000-4000-8000-000000000001",
    username: "manager",
    role: "manager",
    capabilities: ["run.read"],
    sessionExpiresAt: "2026-11-17T00:00:00.000Z",
  };
  const handler = createV2Api({
    pool: { async query() { throw new Error("run SQL should not be called"); } },
    authAdapter: fakeAuthAdapter({ session }),
    getClientKey: () => "test-client",
    logger: () => {},
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v2/auth/session`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      staff: {
        userId: session.actorId,
        username: "manager",
        role: "manager",
        capabilities: ["run.read"],
      },
      expiresAt: session.sessionExpiresAt,
    });
  });
});

test("run routes reject unauthenticated requests before accessing run data", async () => {
  let queryCount = 0;
  const handler = createV2Api({
    pool: { async query() { queryCount += 1; return { rows: [] }; } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: () => {},
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v2/runs`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Sign in to access runs." });
    assert.equal(queryCount, 0);
  });
});
