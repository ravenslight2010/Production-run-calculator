import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAuthApi } from "./auth-api.mjs";
import { V2AuthError } from "./auth-adapter.mjs";

const token = "a".repeat(43);
const csrfToken = "b".repeat(43);

function makeAuth() {
  let signedIn = false;
  let signOutCount = 0;
  const staff = {
    verified: true,
    actorId: "10000000-0000-4000-8000-000000000001",
    facilityId: "10000000-0000-4000-8000-000000000002",
    username: "operator",
    role: "operator",
    capabilities: ["run.read", "run.lifecycle.command"],
    sessionExpiresAt: "2026-11-17T00:00:00.000Z",
  };
  const auth = {
    async signIn(input) {
      auth.lastSignInInput = input;
      if (input.password !== "correct horse battery staple") {
        throw new V2AuthError(401, "Username or password is incorrect.");
      }
      signedIn = true;
      return {
        token,
        csrfToken,
        expiresAt: staff.sessionExpiresAt,
        staff: {
          userId: staff.actorId,
          username: staff.username,
          role: staff.role,
          capabilities: staff.capabilities,
        },
      };
    },
    async authenticate(request) {
      return signedIn && request.headers.cookie?.includes(`v2_session=${token}`)
        ? { ...staff }
        : null;
    },
    async verifyCsrf(request) {
      return request.headers.cookie?.includes(`v2_csrf=${csrfToken}`)
        && request.headers["x-csrf-token"] === csrfToken;
    },
    async signOut() {
      signOutCount += 1;
      signedIn = false;
    },
    async bootstrapAvailable() {
      return false;
    },
    async bootstrapManager() {
      throw new V2AuthError(409, "First-manager setup has already been completed.");
    },
    async listStaff() {
      return { staff: [], roles: [] };
    },
    async createStaffAccount() {
      throw new V2AuthError(403, "Staff management is not authorized.");
    },
    async updateStaffAccount() {
      throw new V2AuthError(403, "Staff management is not authorized.");
    },
    sessionCookie(value, options) {
      return `v2_session=${value}; Path=/; HttpOnly; SameSite=Lax${options.secure ? "; Secure" : ""}`;
    },
    csrfCookie(value, options) {
      return `v2_csrf=${value}; Path=/; SameSite=Lax${options.secure ? "; Secure" : ""}`;
    },
    clearSessionCookie(options) {
      return `v2_session=; Path=/; HttpOnly; Max-Age=0${options.secure ? "; Secure" : ""}`;
    },
    clearCsrfCookie(options) {
      return `v2_csrf=; Path=/; Max-Age=0${options.secure ? "; Secure" : ""}`;
    },
    get signOutCount() {
      return signOutCount;
    },
  };
  return auth;
}

async function withServer(handler, run) {
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("sign-in sets separate secure session and readable CSRF cookies without returning tokens", async () => {
  const auth = makeAuth();
  const observedLogs = [];
  const handler = createAuthApi({
    auth,
    getClientKey: () => "127.0.0.1",
    secureCookies: true,
    logger: (entry) => observedLogs.push(entry),
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ username: "operator", password: "correct horse battery staple" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.staff.username, "operator");
    assert.equal(body.staff.role, "operator");
    assert.equal(body.expiresAt, "2026-11-17T00:00:00.000Z");
    assert.equal(JSON.stringify(body).includes(token), false);
    assert.equal(JSON.stringify(body).includes("correct horse"), false);

    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.match(cookies[0], /^v2_session=/);
    assert.match(cookies[0], /HttpOnly/);
    assert.match(cookies[0], /Secure/);
    assert.match(cookies[1], /^v2_csrf=/);
    assert.doesNotMatch(cookies[1], /HttpOnly/);
    assert.match(cookies[1], /Secure/);
    assert.equal(auth.lastSignInInput.clientKey, "127.0.0.1");
    assert.deepEqual(observedLogs, []);
  });
});

test("session read returns only public staff fields and sign-out enforces CSRF", async () => {
  const auth = makeAuth();
  const handler = createAuthApi({ auth, getClientKey: () => "test-client", secureCookies: false });

  await withServer(handler, async (baseUrl) => {
    const signIn = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "correct horse battery staple" }),
    });
    const cookies = signIn.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");

    const session = await fetch(`${baseUrl}/api/v2/auth/session`, { headers: { cookie: cookies } });
    assert.equal(session.status, 200);
    const sessionBody = await session.json();
    assert.deepEqual(sessionBody.staff.capabilities, ["run.read", "run.lifecycle.command"]);
    assert.equal("facilityId" in sessionBody.staff, false);
    assert.equal("csrfHash" in sessionBody, false);

    const denied = await fetch(`${baseUrl}/api/v2/auth/sign-out`, {
      method: "POST",
      headers: { cookie: cookies },
    });
    assert.equal(denied.status, 403);
    assert.equal(auth.signOutCount, 0);

    const signedOut = await fetch(`${baseUrl}/api/v2/auth/sign-out`, {
      method: "POST",
      headers: { cookie: cookies, "x-csrf-token": csrfToken },
    });
    assert.equal(signedOut.status, 204);
    assert.equal(auth.signOutCount, 1);
    assert.equal(signedOut.headers.getSetCookie().length, 2);
  });
});

test("sign-in rejects unsupported fields, non-JSON payloads, and wrong methods", async () => {
  const handler = createAuthApi({ auth: makeAuth(), getClientKey: () => "test-client" });
  await withServer(handler, async (baseUrl) => {
    const wrongMethod = await fetch(`${baseUrl}/api/v2/auth/sign-in`);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");

    const unsupported = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "example", extra: "not allowed" }),
    });
    assert.equal(unsupported.status, 400);

    const wrongType = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "username=operator",
    });
    assert.equal(wrongType.status, 415);

    const oversized = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "x".repeat(4100) }),
    });
    assert.equal(oversized.status, 413);
  });
});

test("sign-in and sign-out reject cross-origin browser requests", async () => {
  const auth = makeAuth();
  auth.bootstrapManager = async () => {
    throw new Error("cross-origin bootstrap must not reach the adapter");
  };
  const handler = createAuthApi({ auth, getClientKey: () => "test-client" });
  await withServer(handler, async (baseUrl) => {
    const signIn = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ username: "operator", password: "correct horse battery staple" }),
    });
    assert.equal(signIn.status, 403);

    const signOut = await fetch(`${baseUrl}/api/v2/auth/sign-out`, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    });
    assert.equal(signOut.status, 403);
    assert.equal(auth.signOutCount, 0);

    const bootstrap = await fetch(`${baseUrl}/api/v2/auth/bootstrap`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({
        bootstrapCode: "test-only-initial-manager-code-123456",
        username: "InitialManager",
        password: "strong-test-password",
      }),
    });
    assert.equal(bootstrap.status, 403);
  });
});

test("sign-in failures are generic and rate limits include Retry-After", async () => {
  const auth = makeAuth();
  auth.signIn = async () => {
    throw new V2AuthError(429, "Try again later.", 30);
  };
  const handler = createAuthApi({ auth, getClientKey: () => "test-client" });
  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v2/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "wrong" }),
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "30");
    assert.deepEqual(await response.json(), { error: "Try again later." });
  });
});

test("missing session is cleared idempotently on sign-out", async () => {
  const auth = makeAuth();
  const handler = createAuthApi({ auth, getClientKey: () => "test-client", secureCookies: true });
  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v2/auth/sign-out`, { method: "POST" });
    assert.equal(response.status, 204);
    assert.equal(auth.signOutCount, 0);
    assert.equal(response.headers.getSetCookie().length, 2);
  });
});

test("first-manager setup status and response never expose the bootstrap code or password", async () => {
  const observedLogs = [];
  const auth = makeAuth();
  let available = true;
  auth.bootstrapAvailable = async () => available;
  auth.bootstrapManager = async ({ username, password, bootstrapCode }) => {
    assert.equal(username, "InitialManager");
    assert.equal(password, "strong-test-password");
    assert.equal(bootstrapCode, "test-only-initial-manager-code-123456");
    available = false;
    return {
      token,
      csrfToken,
      expiresAt: "2026-11-17T00:00:00.000Z",
      staff: { userId: "10000000-0000-4000-8000-000000000001", username, role: "manager", capabilities: ["manage-staff"] },
    };
  };
  const handler = createAuthApi({
    auth,
    getClientKey: () => "test-client",
    logger: (entry) => observedLogs.push(entry),
  });

  await withServer(handler, async (baseUrl) => {
    const status = await fetch(`${baseUrl}/api/v2/auth/bootstrap-status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { available: true });

    const setup = await fetch(`${baseUrl}/api/v2/auth/bootstrap`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({
        bootstrapCode: "test-only-initial-manager-code-123456",
        username: "InitialManager",
        password: "strong-test-password",
      }),
    });
    assert.equal(setup.status, 201);
    const body = await setup.json();
    assert.equal(body.staff.role, "manager");
    assert.equal(JSON.stringify(body).includes("test-only-initial-manager-code-123456"), false);
    assert.equal(JSON.stringify(body).includes("strong-test-password"), false);
    assert.equal(JSON.stringify(body).includes(token), false);
    assert.equal(setup.headers.getSetCookie().length, 2);

    const closed = await fetch(`${baseUrl}/api/v2/auth/bootstrap-status`);
    assert.deepEqual(await closed.json(), { available: false });
    assert.deepEqual(observedLogs, []);
  });
});

test("manager staff routes require authorization and CSRF and accept only known input fields", async () => {
  const auth = makeAuth();
  const manager = {
    verified: true,
    actorId: "10000000-0000-4000-8000-000000000011",
    facilityId: "10000000-0000-4000-8000-000000000002",
    username: "manager",
    role: "manager",
    capabilities: ["manage-staff"],
    sessionExpiresAt: "2026-11-17T00:00:00.000Z",
  };
  let current = manager;
  auth.authenticate = async () => current;
  auth.verifyCsrf = async (request) => request.headers["x-csrf-token"] === csrfToken;
  auth.listStaff = async () => ({
    staff: [{ userId: manager.actorId, username: "manager", role: "manager", disabled: false, createdAt: "2026-11-16T00:00:00.000Z" }],
    roles: [{ name: "manager", capabilities: ["manage-staff"] }, { name: "operator", capabilities: [] }],
  });
  auth.createStaffAccount = async (input) => {
    assert.deepEqual(input, {
      actorId: manager.actorId,
      username: "NewOperator",
      password: "strong-test-password",
      roleName: "operator",
      clientKey: "test-client",
    });
    return true;
  };
  const handler = createAuthApi({ auth, getClientKey: () => "test-client" });

  await withServer(handler, async (baseUrl) => {
    const managerList = await fetch(`${baseUrl}/api/v2/auth/staff`, {
      headers: { cookie: `v2_session=${token}` },
    });
    assert.equal(managerList.status, 200);
    assert.equal((await managerList.json()).roles.length, 2);

    const missingCsrf = await fetch(`${baseUrl}/api/v2/auth/staff`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `v2_session=${token}` },
      body: JSON.stringify({ username: "NewOperator", password: "strong-test-password", roleName: "operator" }),
    });
    assert.equal(missingCsrf.status, 403);

    const unsupported = await fetch(`${baseUrl}/api/v2/auth/staff`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `v2_session=${token}; v2_csrf=${csrfToken}`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        username: "NewOperator",
        password: "strong-test-password",
        roleName: "operator",
        passwordHash: "not-allowed",
      }),
    });
    assert.equal(unsupported.status, 400);

    const created = await fetch(`${baseUrl}/api/v2/auth/staff`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `v2_session=${token}; v2_csrf=${csrfToken}`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ username: "NewOperator", password: "strong-test-password", roleName: "operator" }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).staff[0].username, "manager");

    current = { ...manager, capabilities: [] };
    const forbidden = await fetch(`${baseUrl}/api/v2/auth/staff`);
    assert.equal(forbidden.status, 403);
  });
});
