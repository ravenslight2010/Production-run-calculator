import assert from "node:assert/strict";
import { startV2Server } from "./main.mjs";

const MANAGER_PASSWORD = "v2-test-manager-password";
const OPERATOR_PASSWORD = "v2-test-operator-password";
const BOOTSTRAP_CODE = "v2-test-initial-manager-bootstrap-code";

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

async function bootstrap(baseUrl, bootstrapCode) {
  const response = await fetch(`${baseUrl}/api/v2/auth/bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({
      bootstrapCode,
      username: "V2IntegrationManager",
      password: MANAGER_PASSWORD,
    }),
  });
  return response;
}

async function main() {
  const adminConnectionString = process.env.V2_TEST_ADMIN_URL;
  const apiConnectionString = process.env.V2_DATABASE_URL;
  if (!adminConnectionString || !apiConnectionString) {
    throw new Error("The disposable V2 PostgreSQL URLs are required for this integration check.");
  }

  let serverInstance;
  try {
    const logs = [];
    serverInstance = await startV2Server({
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        V2_DATABASE_URL: apiConnectionString,
        V2_INITIAL_MANAGER_BOOTSTRAP_CODE: BOOTSTRAP_CODE,
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

    const bootstrapStatus = await fetch(`${baseUrl}/api/v2/auth/bootstrap-status`);
    assert.equal(bootstrapStatus.status, 200);
    assert.deepEqual(await jsonResponse(bootstrapStatus), { available: true });

    const rejectedBootstrap = await bootstrap(baseUrl, "incorrect-v2-bootstrap-code");
    assert.equal(rejectedBootstrap.status, 401);
    assert.equal((await jsonResponse(rejectedBootstrap)).error, "First-manager setup could not be completed.");

    const bootstrapResponse = await bootstrap(baseUrl, BOOTSTRAP_CODE);
    assert.equal(bootstrapResponse.status, 201);
    const bootstrapBody = await jsonResponse(bootstrapResponse);
    assert.equal(bootstrapBody.staff.role, "manager");
    assert.doesNotMatch(JSON.stringify(bootstrapBody), /v2-test-initial-manager-bootstrap-code|v2-test-manager-password|argon2id|v2_session/);
    const managerCookies = bootstrapResponse.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
    const manager = {
      cookieHeader: managerCookies.join("; "),
      csrfToken: managerCookies.find((cookie) => cookie.startsWith("v2_csrf="))?.slice("v2_csrf=".length),
    };
    assert.match(manager.csrfToken ?? "", /^[A-Za-z0-9_-]{43}$/);

    const bootstrapClosed = await fetch(`${baseUrl}/api/v2/auth/bootstrap-status`);
    assert.deepEqual(await jsonResponse(bootstrapClosed), { available: false });
    const duplicateBootstrap = await bootstrap(baseUrl, BOOTSTRAP_CODE);
    assert.equal(duplicateBootstrap.status, 409);

    const createStaff = await fetch(`${baseUrl}/api/v2/auth/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        username: "V2IntegrationOperator",
        password: OPERATOR_PASSWORD,
        roleName: "operator",
      }),
    });
    assert.equal(createStaff.status, 201);
    const directory = await jsonResponse(createStaff);
    assert.equal(directory.staff.length, 2);
    assert.equal(directory.roles.length, 2);
    assert.doesNotMatch(JSON.stringify(directory), /v2-test-operator-password|argon2id|v2_session/);

    const operatorDeniedRead = await fetch(`${baseUrl}/api/v2/auth/staff`);
    assert.equal(operatorDeniedRead.status, 401);

    const operator = await signIn(baseUrl, "V2IntegrationOperator", OPERATOR_PASSWORD);
    const managerRoster = await fetch(`${baseUrl}/api/v2/auth/staff`, {
      headers: { Cookie: manager.cookieHeader },
    });
    assert.equal(managerRoster.status, 200);
    assert.equal((await jsonResponse(managerRoster)).staff.length, 2);
    const operatorRoster = await fetch(`${baseUrl}/api/v2/auth/staff`, {
      headers: { Cookie: operator.cookieHeader },
    });
    assert.equal(operatorRoster.status, 403);

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

    const roleChange = await fetch(`${baseUrl}/api/v2/auth/staff/${directory.staff.find((staff) => staff.username === "v2integrationoperator").userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ roleName: "manager" }),
    });
    assert.equal(roleChange.status, 200);
    const changedDirectory = await jsonResponse(roleChange);
    assert.equal(changedDirectory.staff.find((staff) => staff.username === "v2integrationoperator").role, "manager");

    const oldOperatorSession = await fetch(`${baseUrl}/api/v2/auth/session`, {
      headers: { Cookie: operator.cookieHeader },
    });
    assert.equal(oldOperatorSession.status, 401);
    const promotedOperator = await signIn(baseUrl, "V2IntegrationOperator", OPERATOR_PASSWORD);
    assert.equal((await fetch(`${baseUrl}/api/v2/auth/session`, {
      headers: { Cookie: promotedOperator.cookieHeader },
    })).status, 200);

    const demoteOperator = await fetch(`${baseUrl}/api/v2/auth/staff/${directory.staff.find((staff) => staff.username === "v2integrationoperator").userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ roleName: "operator" }),
    });
    assert.equal(demoteOperator.status, 200);
    const demotedOperator = await signIn(baseUrl, "V2IntegrationOperator", OPERATOR_PASSWORD);

    const disableOperator = await fetch(`${baseUrl}/api/v2/auth/staff/${directory.staff.find((staff) => staff.username === "v2integrationoperator").userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(disableOperator.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/v2/auth/session`, {
      headers: { Cookie: demotedOperator.cookieHeader },
    })).status, 401);
    const disabledSignIn = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ username: "V2IntegrationOperator", password: OPERATOR_PASSWORD }),
    });
    assert.equal(disabledSignIn.status, 401);

    const lastManagerChange = await fetch(`${baseUrl}/api/v2/auth/staff/${bootstrapBody.staff.userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(lastManagerChange.status, 409);

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

    const disabledOperatorSession = await fetch(`${baseUrl}/api/v2/auth/session`, {
      headers: { Cookie: operator.cookieHeader },
    });
    assert.equal(disabledOperatorSession.status, 401);
    assert.equal(JSON.stringify(logs).includes(MANAGER_PASSWORD), false);
    assert.equal(JSON.stringify(logs).includes(OPERATOR_PASSWORD), false);
    assert.equal(JSON.stringify(logs).includes(BOOTSTRAP_CODE), false);
    for (const cookie of [manager.cookieHeader, operator.cookieHeader, promotedOperator.cookieHeader, demotedOperator.cookieHeader]) {
      assert.equal(JSON.stringify(logs).includes(cookie), false);
    }
    console.log("V2 HTTP/PostgreSQL check passed: guarded bootstrap, manager staff control, session revocation, and shared run state.");
  } finally {
    if (serverInstance) await serverInstance.close();
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
