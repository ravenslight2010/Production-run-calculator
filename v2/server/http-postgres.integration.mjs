import assert from "node:assert/strict";
import pg from "pg";
import { hashPassword } from "./auth-adapter.mjs";
import { startV2Server } from "./main.mjs";

const { Pool } = pg;
const MANAGER_ID = "73000000-0000-4000-8000-000000000001";
const OPERATOR_ID = "73000000-0000-4000-8000-000000000002";
const MANAGER_PASSWORD = "v2-test-manager-password";
const OPERATOR_PASSWORD = "v2-test-operator-password";

async function jsonResponse(response) {
  return response.json();
}

async function signIn(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, "staff sign-in should return success");
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
  const cookieHeader = cookies.join("; ");
  const csrfToken = cookies
    .find((cookie) => cookie.startsWith("v2_csrf="))
    ?.slice("v2_csrf=".length);
  assert.match(cookieHeader, /v2_session=/);
  assert.match(csrfToken ?? "", /^[A-Za-z0-9_-]{43}$/);
  return { cookieHeader, csrfToken };
}

async function main() {
  const adminConnectionString = process.env.V2_TEST_ADMIN_URL;
  const apiConnectionString = process.env.V2_DATABASE_URL;
  if (!adminConnectionString || !apiConnectionString) {
    throw new Error("The disposable V2 PostgreSQL URLs are required for this integration check.");
  }

  const admin = new Pool({ connectionString: adminConnectionString, max: 1 });
  let serverInstance;
  try {
    const managerHash = await hashPassword(MANAGER_PASSWORD);
    const operatorHash = await hashPassword(OPERATOR_PASSWORD);
    await admin.query(
      `INSERT INTO v2.staff_accounts (id, username, password_hash, disabled)
       VALUES ($1::uuid, $2::text, $3::text, false),
              ($4::uuid, $5::text, $6::text, false)`,
      [MANAGER_ID, "V2IntegrationManager", managerHash, OPERATOR_ID, "V2IntegrationOperator", operatorHash],
    );
    await admin.query(
      `INSERT INTO v2.user_roles (user_id, role_name)
       VALUES ($1::uuid, 'manager'), ($2::uuid, 'operator')`,
      [MANAGER_ID, OPERATOR_ID],
    );

    const logs = [];
    serverInstance = await startV2Server({
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        V2_DATABASE_URL: apiConnectionString,
      },
      logger: (entry) => logs.push(entry),
    });
    const address = serverInstance.server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Sign in to the floor/);

    const unauthenticated = await fetch(`${baseUrl}/api/v2/auth/session`);
    assert.equal(unauthenticated.status, 401);

    const manager = await signIn(baseUrl, "V2IntegrationManager", MANAGER_PASSWORD);
    const operator = await signIn(baseUrl, "V2IntegrationOperator", OPERATOR_PASSWORD);

    const createdResponse = await fetch(`${baseUrl}/api/v2/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
      },
      body: JSON.stringify({
        requestId: "73000000-0000-4000-8000-000000000101",
        setupSnapshot: { label: "Two-session check", targetCases: 5 },
      }),
    });
    if (createdResponse.status !== 201) {
      throw new Error(`run creation failed (${createdResponse.status}): ${(await createdResponse.text()).slice(0, 500)}`);
    }
    const created = await jsonResponse(createdResponse);
    assert.equal(created.run.status, "planned");
    assert.equal(created.run.revision, 0);

    const operatorList = await fetch(`${baseUrl}/api/v2/runs`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(operatorList.status, 200);
    const listed = await jsonResponse(operatorList);
    assert.equal(listed.runs.length, 1);
    assert.equal(listed.runs[0].id, created.run.id);

    const startResponse = await fetch(`${baseUrl}/api/v2/runs/${created.run.id}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: operator.cookieHeader,
        "X-CSRF-Token": operator.csrfToken,
      },
      body: JSON.stringify({
        commandId: "73000000-0000-4000-8000-000000000102",
        commandType: "start",
        expectedRevision: 0,
      }),
    });
    assert.equal(startResponse.status, 200);
    const started = await jsonResponse(startResponse);
    assert.equal(started.run.status, "running");
    assert.equal(started.run.revision, 1);

    const managerRead = await fetch(`${baseUrl}/api/v2/runs/${created.run.id}`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(managerRead.status, 200);
    assert.equal((await jsonResponse(managerRead)).run.revision, 1);

    const staleCommand = await fetch(`${baseUrl}/api/v2/runs/${created.run.id}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
      },
      body: JSON.stringify({
        commandId: "73000000-0000-4000-8000-000000000103",
        commandType: "pause",
        expectedRevision: 0,
      }),
    });
    assert.equal(staleCommand.status, 409);
    const conflict = await jsonResponse(staleCommand);
    assert.equal(conflict.outcome, "conflict");
    assert.equal(conflict.currentRun.revision, 1);

    const signOut = await fetch(`${baseUrl}/api/v2/auth/sign-out`, {
      method: "POST",
      headers: {
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    assert.equal(signOut.status, 204);

    const operatorStillValid = await fetch(`${baseUrl}/api/v2/auth/session`, {
      headers: { Cookie: operator.cookieHeader },
    });
    assert.equal(operatorStillValid.status, 200);
    assert.equal(JSON.stringify(logs).includes(MANAGER_PASSWORD), false);
    assert.equal(JSON.stringify(logs).includes(OPERATOR_PASSWORD), false);
    console.log("V2 HTTP/PostgreSQL check passed: separate staff sessions share run revisions and detect stale actions.");
  } finally {
    if (serverInstance) await serverInstance.close();
    await admin.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "v2.http_postgres_integration.failed",
    errorName: typeof error?.name === "string" ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Integration assertion failed.",
  }));
  process.exitCode = 1;
});
