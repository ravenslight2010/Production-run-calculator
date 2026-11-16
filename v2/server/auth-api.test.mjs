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
